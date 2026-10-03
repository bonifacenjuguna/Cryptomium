import { COINS, CONFIG } from './config.js';
import { fetchAllPrices } from './priceService.js';
import { checkMilestone } from './milestoneEngine.js';
import { getCoinSettings, setLastMilestone, getState, logPost, pruneOldPosts } from './db.js';
import { generateBannerImage } from './imageGenerator.js';
import { isMuted } from './coinView.js';
import { buildCaption } from './caption.js';
import { createAlertRunner } from './alertRunner.js';

export function startScheduler(bot) {
  const runTick = createAlertRunner({
    coins: COINS,
    getChannelId: () => getState('channel_id'),
    fetchPrices: fetchAllPrices,
    getSettings: getCoinSettings,
    check: checkMilestone,
    saveMilestone: setLastMilestone,
    isMuted,
    logPost,
    postDelayMs: CONFIG.postDelayMs,
    maxPerHour: CONFIG.maxAutoPostsPerHour,
    minGapSeconds: CONFIG.minPostGapSeconds,
    maxAttempts: CONFIG.alertMaxAttempts,
    sendAlert: async ({ coin, price, direction, channelId }) => {
      const image = await generateBannerImage({ ticker: coin.ticker, price, direction });
      const caption = buildCaption({ ticker: coin.ticker, price, direction });
      await bot.telegram.sendPhoto(channelId, { source: image }, { caption });
    },
  });

  const tick = async () => {
    try {
      await runTick();
    } catch (err) {
      console.error('[scheduler] Tick failed:', err);
    }
  };

  tick(); // run immediately on boot, then on the configured interval
  setInterval(tick, CONFIG.pollIntervalMs);

  // Post history housekeeping: once at boot, then every 6 hours.
  if (CONFIG.postLogRetentionDays > 0) {
    const prune = async () => {
      try {
        const removed = await pruneOldPosts(CONFIG.postLogRetentionDays);
        if (removed > 0) console.log(`[scheduler] Pruned ${removed} post-history rows older than ${CONFIG.postLogRetentionDays} days.`);
      } catch (err) {
        console.error('[scheduler] Post-history pruning failed:', err);
      }
    };
    prune();
    setInterval(prune, 6 * 60 * 60 * 1000).unref?.();
  }
}
