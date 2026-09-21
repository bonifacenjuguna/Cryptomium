import { CONFIG } from './config.js';
import { initDb, unmute } from './db.js';
import { initMuteExpiryListener } from './redisClient.js';
import { createBot } from './bot.js';
import { startScheduler } from './scheduler.js';
import { startLogoHealer } from './logoService.js';

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

  // NOTE: In Telegraf 4.x, bot.launch() returns a promise that only settles
  // when the bot *stops* (it awaits the long-polling loop). Awaiting it
  // directly meant everything below it — including startScheduler() — never
  // ran, so the bot could answer /start and post "Connected." but never
  // posted any coin data. We resolve on the onLaunch callback instead.
  await new Promise((resolve, reject) => {
    let launched = false;
    bot
      .launch(() => {
        launched = true;
        resolve();
      })
      .catch(err => {
        if (!launched) return reject(err);
        console.error('[index] Polling loop stopped unexpectedly:', err);
        process.exit(1);
      });
  });
  console.log('[index] Bot launched.');

  startScheduler(bot);
  console.log(`[index] Scheduler started (every ${CONFIG.pollIntervalMs}ms).`);

  // Private liveness DM to the owner only — the channel stays untouched
  // on ordinary deploys/restarts.
  try {
    await bot.telegram.sendMessage(CONFIG.ownerId, 'priceping is back online.');
  } catch (err) {
    console.warn('[index] Could not send startup DM to owner (has the owner started a chat with the bot yet?):', err.message);
  }

  // Fetch any coin logos the build step missed (rate limits etc.) in the
  // background. Banners work meanwhile — a missing logo draws a monogram badge.
  startLogoHealer({
    onStillMissing: async tickers => {
      console.warn(`[index] Logos still missing after retry: ${tickers.join(', ')}`);
      try {
        await bot.telegram.sendMessage(
          CONFIG.ownerId,
          `⚠️ Couldn't download logos for: ${tickers.join(', ')}.\n` +
          'Banners use a text badge for those until they download (I keep retrying every 30 minutes).'
        );
      } catch {
        /* owner may not have started a chat yet */
      }
    },
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(err => {
  console.error('[index] Fatal startup error:', err);
  process.exit(1);
});
