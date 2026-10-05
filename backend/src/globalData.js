// Whole-market numbers for the Markets page: total market cap, volume, dominance and
// the market-cap history, from CoinGecko's keyless /global endpoint, plus a breadth reading
// (how many tracked coins are up) and the market cap of the tracked stablecoins.
// Everything shown is measured, nothing is estimated or invented.
import { COINS } from './config.js';
import { coingeckoFetch, ProviderError } from './priceService.js';

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function fetchGlobal({ get = coingeckoFetch } = {}) {
  const { res } = await get('/global', { timeoutMs: 15_000 });
  if (!res.ok) throw new ProviderError(`CoinGecko global responded ${res.status}`, res.status);
  const body = (await res.json())?.data;
  if (!body || !body.total_market_cap) throw new ProviderError('CoinGecko global returned an unexpected response');
  const pctOf = k => num(body.market_cap_percentage?.[k]);
  return {
    updatedAt: new Date().toISOString(),
    marketCap: num(body.total_market_cap.usd),
    marketCapChange24h: num(body.market_cap_change_percentage_24h_usd),
    volume24h: num(body.total_volume?.usd),
    btcDominance: pctOf('btc'),
    ethDominance: pctOf('eth'),
    activeAssets: num(body.active_cryptocurrencies),
    markets: num(body.markets),
  };
}

/** Breadth + stablecoin share from the tracked coins' market details (pure, easy to test). */
export function buildBreadth(market, globalReading = null) {
  const tracked = COINS.filter(c => market?.coins?.[c.ticker]);
  let up = 0, down = 0, flat = 0, stableCap = 0, trackedCap = 0, trackedVol = 0;
  for (const c of tracked) {
    const m = market.coins[c.ticker];
    if (c.stable) stableCap += m.marketCap ?? 0;
    trackedCap += m.marketCap ?? 0;
    trackedVol += m.volume24h ?? 0;
    if (c.stable) continue; // a stablecoin staying at $1 says nothing about direction
    const ch = m.change24h;
    if (ch == null) continue;
    if (ch > 0.05) up++; else if (ch < -0.05) down++; else flat++;
  }
  return {
    tracked: tracked.length,
    up, down, flat,
    stableCap,
    stableShare: globalReading?.marketCap > 0 ? (stableCap / globalReading.marketCap) * 100 : null,
    trackedCap,
    trackedVol,
  };
}
