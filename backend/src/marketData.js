// Market details the website shows next to the live price: market cap, volume,
// 24h range, 7-day change and a small 7-day sparkline for every coin (one
// CoinGecko request for all coins), plus fiat exchange rates for the currency
// switcher. Both are cached by the API for minutes/hours, so they cost almost
// nothing.
import { COINS } from './config.js';
import { coingeckoFetch, ProviderError } from './priceService.js';
import { downsample } from './cache.js';

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round6 = v => Number(v.toPrecision(6));

export async function fetchMarket({ get = coingeckoFetch } = {}) {
  const ids = COINS.map(c => c.coingeckoId).join(',');
  const { res } = await get(
    `/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=7d`,
    { timeoutMs: 20_000 }
  );
  if (!res.ok) throw new ProviderError(`CoinGecko markets responded ${res.status}`, res.status);
  const data = await res.json();
  if (!Array.isArray(data)) throw new ProviderError('CoinGecko markets returned an unexpected response');

  const byId = new Map(data.map(item => [item.id, item]));
  const coins = {};
  for (const coin of COINS) {
    const item = byId.get(coin.coingeckoId);
    if (!item) continue;
    const raw = item.sparkline_in_7d?.price;
    const spark = Array.isArray(raw)
      ? downsample(raw.filter(v => typeof v === 'number' && Number.isFinite(v)), 56).map(round6)
      : [];
    coins[coin.ticker] = {
      marketCap: num(item.market_cap),
      volume24h: num(item.total_volume),
      high24h: num(item.high_24h),
      low24h: num(item.low_24h),
      change7d: num(item.price_change_percentage_7d_in_currency),
      spark,
    };
  }
  if (Object.keys(coins).length === 0) throw new ProviderError('CoinGecko markets returned no usable coins');
  return { updatedAt: new Date().toISOString(), coins };
}

// Currencies offered in the website's switcher (only those CoinGecko returns are used).
export const RATE_CODES = ['usd', 'eur', 'gbp', 'kes', 'ngn', 'zar', 'ghs', 'ugx', 'tzs', 'inr', 'aed', 'cad', 'aud', 'jpy', 'brl'];

/** { base: 'USD', rates: { USD: 1, KES: 129.1, ... } } — units of each currency per 1 US dollar. */
export async function fetchRates({ get = coingeckoFetch } = {}) {
  const { res } = await get('/exchange_rates', { timeoutMs: 15_000 });
  if (!res.ok) throw new ProviderError(`CoinGecko exchange rates responded ${res.status}`, res.status);
  const body = await res.json();
  const table = body?.rates;
  const usd = table?.usd?.value;
  if (!table || !(usd > 0)) throw new ProviderError('CoinGecko exchange rates returned an unexpected response');

  // CoinGecko quotes every unit per 1 BTC, so units per 1 USD = unit / usd.
  const rates = { USD: 1 };
  for (const code of RATE_CODES) {
    const entry = table[code];
    if (code === 'usd' || !entry || entry.type !== 'fiat' || !(entry.value > 0)) continue;
    rates[code.toUpperCase()] = Number((entry.value / usd).toPrecision(8));
  }
  return { base: 'USD', updatedAt: new Date().toISOString(), rates };
}
