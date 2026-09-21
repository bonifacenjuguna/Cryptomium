import { COINS, coingeckoHeaders } from './config.js';

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/price';

/**
 * Fetches current USD prices for every tracked coin from CoinGecko in a
 * single batched request. Returns a Map<ticker, price> or throws.
 */
async function fetchFromCoinGecko() {
  const ids = COINS.map(c => c.coingeckoId).join(',');
  const url = `${COINGECKO_URL}?ids=${ids}&vs_currencies=usd`;

  const res = await fetch(url, { headers: coingeckoHeaders(), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
  const data = await res.json();

  const prices = new Map();
  for (const coin of COINS) {
    const price = data[coin.coingeckoId]?.usd;
    if (typeof price === 'number') prices.set(coin.ticker, price);
  }
  if (prices.size === 0) throw new Error('CoinGecko returned no usable prices');
  return prices;
}

/**
 * Binance fallback — requests only the specific symbols we need via the
 * `symbols` query param (Binance's default endpoint returns every symbol,
 * which is unnecessary overhead here).
 */
async function fetchFromBinance() {
  const symbols = JSON.stringify(COINS.filter(c => c.binanceSymbol).map(c => c.binanceSymbol));
  const url = `${BINANCE_URL}?symbols=${encodeURIComponent(symbols)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Binance responded ${res.status}`);
  const data = await res.json();

  const bySymbol = new Map(data.map(entry => [entry.symbol, Number(entry.price)]));
  const prices = new Map();
  for (const coin of COINS) {
    if (!coin.binanceSymbol) continue;
    const price = bySymbol.get(coin.binanceSymbol);
    if (typeof price === 'number' && !Number.isNaN(price)) prices.set(coin.ticker, price);
  }
  if (prices.size === 0) throw new Error('Binance returned no usable prices');
  return prices;
}

// Most recent successful reading, shared by the scheduler and the admin
// screens (Prices, Test banner) so they don't each hit the price APIs.
let latest = { prices: null, at: 0, source: null };

/**
 * Returns Map<ticker, price>. Tries CoinGecko first; on any failure
 * (network error, rate limit, bad response) falls back to Binance.
 */
export async function fetchAllPrices() {
  let prices;
  let source;
  try {
    prices = await fetchFromCoinGecko();
    source = 'CoinGecko';
  } catch (err) {
    console.warn(`[priceService] CoinGecko failed (${err.message}), falling back to Binance.`);
    prices = await fetchFromBinance();
    source = 'Binance';
  }
  latest = { prices, at: Date.now(), source };
  return prices;
}

/**
 * Admin-side helper: returns { prices, at, source } from the shared cache if
 * it is fresh enough, otherwise fetches. `force` bypasses the cache (but is
 * still throttled to one real fetch per 3 seconds to stay polite to the APIs).
 */
export async function getLatestPrices({ maxAgeMs = 20_000, force = false } = {}) {
  const age = Date.now() - latest.at;
  if (latest.prices && (force ? age < 3_000 : age < maxAgeMs)) return latest;
  await fetchAllPrices();
  return latest;
}
