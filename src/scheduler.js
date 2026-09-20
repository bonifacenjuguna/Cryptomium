import { COINS, CONFIG } from './config.js';
import { fetchAllPrices } from './priceService.js';
import { checkMilestone } from './milestoneEngine.js';
import { getCoinSettings, setLastMilestone, getState } from './db.js';
import { generateBannerImage } from './imageGenerator.js';

function isCurrentlyMuted(settings) {
  if (settings.muted_indefinitely) return true;
  if (settings.muted_until && new Date(settings.muted_until) > new Date()) return true;
  return false;
}

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
    if (isCurrentlyMuted(settings)) continue;
    if (!channelId) continue; // no channel connected yet

    try {
      const image = await generateBannerImage({
        ticker: coin.ticker,
        price: result.price,
        direction: result.direction,
      });
      const arrow = result.direction === 'up' ? '▲' : '▼';
      const caption = `${arrow} ${coin.ticker} ${formatCaptionPrice(result.price)} ${CONFIG.watermark}`;

      await bot.telegram.sendPhoto(channelId, { source: image }, { caption });
    } catch (err) {
      console.error(`[scheduler] Failed to post milestone for ${coin.ticker}:`, err);
    }
  }
}

function formatCaptionPrice(price) {
  let decimals;
  if (price >= 100) decimals = 0;
  else if (price >= 1) decimals = 2;
  else decimals = 3;
  const fixed = Number(price.toFixed(decimals));
  return `$${fixed.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
