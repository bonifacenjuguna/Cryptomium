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

  await bot.launch();
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

main().catch(err => {
  console.error('[index] Fatal startup error:', err);
  process.exit(1);
});
