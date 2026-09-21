import { COINS, CONFIG } from './config.js';
import { fetchAllPrices } from './priceService.js';
import { checkMilestone } from './milestoneEngine.js';
import { getCoinSettings, setLastMilestone, getState } from './db.js';
import { generateBannerImage } from './imageGenerator.js';
import { isMuted } from './coinView.js';
import { buildCaption } from './caption.js';

export function startScheduler(bot) {
  const tick = async () => {
    try {
      await runOnce(bot);
    } catch (err) {
      console.error('[scheduler] Tick failed:', err);
    }
  };

  tick(); // run immediately on boot, then on the configured interval
  setInterval(tick, CONFIG.pollIntervalMs);
}

async function runOnce(bot) {
  const channelId = await getState('channel_id');
  const prices = await fetchAllPrices();
  console.log(`[scheduler] Tick: fetched ${prices.size}/${COINS.length} prices, channel ${channelId ? 'connected' : 'NOT connected'}.`);

  for (const coin of COINS) {
    const price = prices.get(coin.ticker);
    if (price === undefined) continue;

    const settings = await getCoinSettings(coin.ticker);
    const result = checkMilestone(coin, settings, price);
    if (!result) continue;

    // Always persist the updated ladder position / re-arm state, even
    // when muted — otherwise unmuting later would trigger a flood of
    // "missed" milestones all at once.
    await setLastMilestone(coin.ticker, result.newLastMilestone);

    if (result.direction === null) continue; // baseline set or re-armed, nothing to post
    if (isMuted(settings)) continue;
    if (!channelId) continue; // no channel connected yet

    try {
      const image = await generateBannerImage({
        ticker: coin.ticker,
        price: result.price,
        direction: result.direction,
      });
      const caption = buildCaption({ ticker: coin.ticker, price: result.price, direction: result.direction });

      await bot.telegram.sendPhoto(channelId, { source: image }, { caption });
    } catch (err) {
      console.error(`[scheduler] Failed to post milestone for ${coin.ticker}:`, err);
    }
  }
}
