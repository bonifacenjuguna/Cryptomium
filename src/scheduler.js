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
      await notifyOwnerOfFailure(bot, err);
    }
  };

  tick(); // run immediately on boot, then on the configured interval
  setInterval(tick, CONFIG.pollIntervalMs);
}

// Avoids spamming the owner's DMs if the price feed stays down for a
// while — only sends one alert, then waits before sending another.
let lastFailureNotifiedAt = 0;
const FAILURE_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

async function notifyOwnerOfFailure(bot, err) {
  const now = Date.now();
  if (now - lastFailureNotifiedAt < FAILURE_NOTIFY_COOLDOWN_MS) return;
  lastFailureNotifiedAt = now;
  try {
    await bot.telegram.sendMessage(
      CONFIG.ownerId,
      `⚠️ priceping couldn't fetch prices (both CoinGecko and Binance failed): ${err.message}\n\n` +
      `Will keep retrying — this is a one-time alert for now to avoid spam.`
    );
  } catch {
    // If even the DM fails, there's nothing more we can do here.
  }
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
