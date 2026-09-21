import { CONFIG } from './config.js';
import { initDb, unmute } from './db.js';
import { initMuteExpiryListener } from './redisClient.js';
import { createBot } from './bot.js';
import { startScheduler } from './scheduler.js';

async function main() {
  await initDb();

  const bot = createBot({
    onChannelConnected: async channelId => {
      // One-time confirmation posted to the channel itself — only fires
      // right after a (re)connect, never on ordinary redeploys/restarts.
      try {
        await bot.telegram.sendMessage(channelId, 'Connected.');
      } catch (err) {
        console.error('[index] Failed to post channel connect confirmation:', err);
      }
    },
  });

  // Real-time auto-unmute: when a scheduled mute's Redis TTL expires, lift
  // the mute in Postgres immediately rather than waiting for the next
  // price-poll cycle to notice the time has passed.
  await initMuteExpiryListener(async ticker => {
    await unmute(ticker);
  });

  // Defensive cleanup before polling starts: if a previous instance's
  // shutdown didn't fully release its long-poll connection yet (common
  // during a Railway rolling deploy, where the old container can take a
  // moment to die after the new one starts), Telegram will reject our
  // getUpdates call with a 409 Conflict. Explicitly dropping any pending
  // webhook/session and retrying with backoff handles that handoff window
  // instead of crashing the whole process.
  await launchWithRetry(bot);
  console.log('[index] Bot launched.');

  startScheduler(bot);

  // Private liveness DM to the owner only — the channel stays untouched
  // on ordinary deploys/restarts.
  try {
    await bot.telegram.sendMessage(CONFIG.ownerId, 'priceping is back online.');
  } catch (err) {
    console.warn('[index] Could not send startup DM to owner (has the owner started a chat with the bot yet?):', err.message);
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

/**
 * Launches the bot's long-polling loop. On a Railway rolling deploy, the
 * old container can take a moment to fully release its getUpdates
 * connection after the new one starts — Telegram rejects the new
 * connection with a 409 Conflict during that brief handoff window. This
 * retries with backoff instead of crashing the whole process over what is
 * usually a transient few-second overlap.
 */
async function launchWithRetry(bot, attempt = 1) {
  const MAX_ATTEMPTS = 6;
  const DELAY_MS = 5000;

  try {
    // Clear out any stuck webhook/session before polling starts.
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch();
  } catch (err) {
    const isConflict = err?.response?.error_code === 409;
    if (isConflict && attempt < MAX_ATTEMPTS) {
      console.warn(`[index] 409 conflict on launch (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${DELAY_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, DELAY_MS));
      return launchWithRetry(bot, attempt + 1);
    }
    throw err;
  }
}

main().catch(err => {
  console.error('[index] Fatal startup error:', err);
  process.exit(1);
});
