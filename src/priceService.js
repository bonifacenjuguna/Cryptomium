import { COINS } from './config.js';

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/price';

/**
 * Fetches current USD prices for every tracked coin from CoinGecko in a
 * single batched request. Returns a Map<ticker, price> or throws.
 */
async function fetchFromCoinGecko() {
  const ids = COINS.map(c => c.coingeckoId).join(',');
  const url = `${COINGECKO_URL}?ids=${ids}&vs_currencies=usd`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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

/**
 * Returns Map<ticker, price>. Tries CoinGecko first; on any failure
 * (network error, rate limit, bad response) falls back to Binance.
 */
export async function fetchAllPrices() {
  try {
    return await fetchFromCoinGecko();
  } catch (err) {
    console.warn(`[priceService] CoinGecko failed (${err.message}), falling back to Binance.`);
    return await fetchFromBinance();
  }
}
