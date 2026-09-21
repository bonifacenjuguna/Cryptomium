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
 * Launches the bot's long-polling loop.
 *
 * IMPORTANT: in Telegraf 4.x, bot.launch() returns a promise that only
 * settles once the bot STOPS — it awaits the entire polling loop, not
 * just the startup handshake. Awaiting it directly (as earlier versions
 * of this file did) means any code after it — including
 * startScheduler(bot) — never runs until the bot is shut down. That was
 * the actual cause of "connects fine, never posts any coin data": the
 * scheduler was unreachable code.
 *
 * The fix is to pass an onLaunch callback to bot.launch() and resolve
 * this wrapper promise from that callback instead, while still handling
 * a genuine startup failure (including Telegram 409 conflicts during a
 * Railway rolling deploy, retried with backoff) versus the polling loop
 * ending later during normal operation.
 */
async function launchWithRetry(bot, attempt = 1) {
  const MAX_ATTEMPTS = 6;
  const DELAY_MS = 5000;

  await bot.telegram.deleteWebhook({ drop_pending_updates: true });

  return new Promise((resolve, reject) => {
    let launched = false;

    bot
      .launch(() => {
        launched = true;
        resolve();
      })
      .catch(async err => {
        if (launched) {
          // The polling loop ended sometime after a successful launch —
          // this is a genuine runtime failure, not a startup race.
          console.error('[index] Polling loop stopped unexpectedly:', err);
          process.exit(1);
          return;
        }

        const isConflict = err?.response?.error_code === 409;
        if (isConflict && attempt < MAX_ATTEMPTS) {
          console.warn(`[index] 409 conflict on launch (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${DELAY_MS / 1000}s...`);
          await new Promise(r => setTimeout(r, DELAY_MS));
          try {
            await launchWithRetry(bot, attempt + 1);
            resolve();
          } catch (retryErr) {
            reject(retryErr);
          }
          return;
        }

        reject(err);
      });
  });
}

main().catch(err => {
  console.error('[index] Fatal startup error:', err);
  process.exit(1);
});
