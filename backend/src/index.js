import { CONFIG } from './config.js';
import { initDb, unmute, recentAlerts } from './db.js';
import { initMuteExpiryListener } from './redisClient.js';
import { createBot } from './bot.js';
import { startScheduler } from './scheduler.js';
import { startLogoHealer } from './logoService.js';
import { setSourceListener } from './priceService.js';
import { createSourceAlerter } from './sourceAlerts.js';
import { loadSavedPreferences } from './handlers/source.js';
import { startApi } from './api.js';

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

  // Owner-chosen price source and logo style, saved from the Settings screens.
  await loadSavedPreferences();

  // Private heads-up when a price source starts failing, and when it recovers.
  setSourceListener(
    createSourceAlerter({
      cooldownMs: CONFIG.sourceAlertCooldownMin * 60_000,
      send: async text => {
        try {
          await bot.telegram.sendMessage(CONFIG.ownerId, text);
        } catch (err) {
          console.warn('[index] Could not send price-source alert:', err.message);
        }
      },
    })
  );

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

  const stopScheduler = startScheduler(bot);
  console.log(`[index] Scheduler started (every ${CONFIG.pollIntervalMs}ms).`);

  // Private liveness DM to the owner only — the channel stays untouched
  // on ordinary deploys/restarts.
  try {
    await bot.telegram.sendMessage(CONFIG.ownerId, 'Cryptomium bot is back online.');
  } catch (err) {
    console.warn('[index] Could not send startup DM to owner (has the owner started a chat with the bot yet?):', err.message);
  }

  // Fetch any coin logos the build step missed (rate limits etc.) in the
  // background. Banners work meanwhile — a missing logo draws a monogram badge.
  startLogoHealer({
    intervalMs: CONFIG.logoRetryMin * 60_000,
    onStillMissing: async tickers => {
      console.warn(`[index] Logos still missing after retry: ${tickers.join(', ')}`);
      try {
        await bot.telegram.sendMessage(
          CONFIG.ownerId,
          `⚠️ Couldn't download logos for: ${tickers.join(', ')}.\n` +
          `Banners use a text badge for those until they download (I keep retrying every ${CONFIG.logoRetryMin} minutes).`
        );
      } catch {
        /* owner may not have started a chat yet */
      }
    },
  });

  // Read-only price API for the website dashboard.
  const api = CONFIG.apiEnabled ? startApi({ recentAlerts }) : null;

  const shutdown = signal => {
    stopScheduler();
    api?.close();
    bot.stop(signal);
    // Database/Redis connections can keep the process alive; do not wait for them forever.
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', err => console.error('[index] Unhandled rejection:', err));

main().catch(err => {
  console.error('[index] Fatal startup error:', err);
  process.exit(1);
});
