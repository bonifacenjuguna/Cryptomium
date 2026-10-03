// Fetches historical price data for charts, from CoinGecko (the only source
// with free historical data at this depth). Uses the same demo/Pro
// auto-detecting endpoint as live prices (see priceService.js).
import { coingeckoFetch } from './priceService.js';

// CoinGecko's OHLC endpoint only accepts these day counts; anything else is
// silently rejected. The line-chart endpoint (market_chart) is more flexible
// and accepts any day count, so custom ranges always use the line style.
export const CHART_RANGES = [
  { key: '24h', label: '24H', days: 1 },
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
];

export function chartRangeByKey(key) {
  return CHART_RANGES.find(r => r.key === key);
}

const MAX_CUSTOM_DAYS = 365; // CoinGecko's free/Demo tier keeps only the last 365 days of history

/** Parses a typed "custom range" answer like "45" or "45 days" into a day count, or null if invalid. */
export function parseCustomDays(text) {
  const match = String(text).trim().match(/^(\d+)\s*(d|days?)?$/i);
  if (!match) return null;
  const days = Number(match[1]);
  if (!Number.isFinite(days) || days < 1 || days > MAX_CUSTOM_DAYS) return null;
  return days;
}

/**
 * Fetches chart data for one coin. Returns:
 *   { style: 'line', days, points: [{ t: msEpoch, price }] }
 *   { style: 'candles', days, points: [{ t: msEpoch, o, h, l, c }] }
 * `style` is what was asked for, but candles for a day count CoinGecko's OHLC
 * endpoint doesn't accept (i.e. anything from a custom range) silently falls
 * back to a line, since a line has no such restriction — the returned style
 * reflects what was ACTUALLY fetched, so the renderer and caption stay honest.
 */
export async function fetchChartData(coin, days, style) {
  const wantsCandles = style === 'candles' && CHART_RANGES.some(r => r.days === days);
  if (wantsCandles) {
    const { res } = await coingeckoFetch(`/coins/${coin.coingeckoId}/ohlc?vs_currency=usd&days=${days}`, { timeoutMs: 15_000 });
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status} fetching ${coin.ticker} candles`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) throw new Error(`No candle data for ${coin.ticker}`);
    const points = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })).sort((a, b) => a.t - b.t);
    return { style: 'candles', days, points };
  }

  const { res } = await coingeckoFetch(`/coins/${coin.coingeckoId}/market_chart?vs_currency=usd&days=${days}`, { timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`CoinGecko responded ${res.status} fetching ${coin.ticker} history`);
  const raw = await res.json();
  const series = raw?.prices;
  if (!Array.isArray(series) || series.length === 0) throw new Error(`No price history for ${coin.ticker}`);
  const points = series.map(([t, price]) => ({ t, price })).sort((a, b) => a.t - b.t);
  return { style: 'line', days, points };
}
