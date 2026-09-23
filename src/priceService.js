import { COINS, CONFIG, SOURCE_MODES, DEFAULT_SOURCE_MODE, coingeckoHeaders, coingeckoBaseUrl } from './config.js';

// Binance's main API is blocked (HTTP 451) from some regions/servers; the
// "data-api" host serves the same public market data and is more permissive.
const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const KRAKEN_URL = 'https://api.kraken.com/0/public/Ticker';
const COINPAPRIKA_URL = 'https://api.coinpaprika.com/v1/tickers';
const COINMARKETCAP_URL = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest';
const DEXSCREENER_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search';
// Below this, a DexScreener pool is too thin to trust for a price that could
// trigger a real alert — a shallow pool can swing well past the actual market
// price on a single trade. DexScreener is a last-resort source, so this floor
// matters more for it than for anything else here.
const DEXSCREENER_MIN_LIQUIDITY_USD = 50_000;

/** An HTTP/provider failure that keeps its status code so it can be explained to the owner. */
export class ProviderError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

/** Plain-English reason for the owner, e.g. "blocked from this server's region". */
export function describeError(err) {
  const status = err?.status;
  if (status === 451 || status === 403) return `blocked from this server's region (HTTP ${status})`;
  if (status === 429) return 'rate-limited (HTTP 429)';
  if (status) return `HTTP ${status}`;
  if (err?.name === 'TimeoutError' || /timeout|aborted/i.test(err?.message || '')) return 'timed out';
  return err?.message || 'unknown error';
}

// ---------------------------------------------------------------------
// Providers. Each returns { prices: Map<ticker, number>, changes: Map<ticker, pct24h>, host }
// or throws a ProviderError.
// ---------------------------------------------------------------------

/** One batched CoinGecko request for every coin (also returns 24h change for free). */
async function fetchFromCoinGecko() {
  const ids = COINS.map(c => c.coingeckoId).join(',');
  const url = `${coingeckoBaseUrl()}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

  const res = await fetch(url, { headers: coingeckoHeaders(), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new ProviderError(`CoinGecko responded ${res.status}`, res.status);
  const data = await res.json();
  if (!data || typeof data !== 'object') throw new ProviderError('CoinGecko returned an unexpected response');

  const prices = new Map();
  const changes = new Map();
  for (const coin of COINS) {
    const entry = data[coin.coingeckoId];
    const price = entry?.usd;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      prices.set(coin.ticker, price);
      const change = entry.usd_24h_change;
      if (typeof change === 'number' && Number.isFinite(change)) changes.set(coin.ticker, change);
    }
  }
  if (prices.size === 0) throw new ProviderError('CoinGecko returned no usable prices');
  return { prices, changes, host: 'api.coingecko.com' };
}

/**
 * Binance spot prices. Tries each Binance host in turn. Stablecoins are never
 * taken from Binance (see config.js), so they are simply absent from the result.
 */
async function fetchFromBinance() {
  const coins = COINS.filter(c => c.binanceSymbol && !c.stable);
  const attempts = []; // what happened on each host, for the "Test sources" screen
  let lastError;
  for (const host of BINANCE_HOSTS) {
    const hostName = new URL(host).host;
    try {
      const result = await fetchBinanceFrom(host, coins);
      attempts.push({ host: hostName, ok: true });
      return { ...result, attempts };
    } catch (err) {
      attempts.push({ host: hostName, ok: false, reason: describeError(err) });
      lastError = err;
    }
  }
  lastError.attempts = attempts;
  throw lastError;
}

async function fetchBinanceFrom(host, coins) {
  const hostName = new URL(host).host;
  const symbols = JSON.stringify(coins.map(c => c.binanceSymbol));
  const get = url => fetch(url, { signal: AbortSignal.timeout(10_000) });

  let res = await get(`${host}/api/v3/ticker/price?symbols=${encodeURIComponent(symbols)}`);
  // One unknown/delisted symbol makes Binance reject the WHOLE request with 400,
  // so fall back to the full price list and pick our coins out of it.
  if (res.status === 400) res = await get(`${host}/api/v3/ticker/price`);
  if (!res.ok) throw new ProviderError(`Binance (${hostName}) responded ${res.status}`, res.status);

  const data = await res.json();
  if (!Array.isArray(data)) throw new ProviderError(`Binance (${hostName}) returned an unexpected response`);
  const bySymbol = new Map(data.map(item => [item.symbol, Number(item.price)]));

  const prices = new Map();
  for (const coin of coins) {
    const price = bySymbol.get(coin.binanceSymbol);
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) prices.set(coin.ticker, price);
  }
  if (prices.size === 0) throw new ProviderError(`Binance (${hostName}) returned no usable prices`);
  return { prices, changes: new Map(), host: hostName };
}

// Kraken predates its own 2019 naming cleanup for a handful of legacy assets,
// so its response keys for those still carry the old prefixed codes (e.g.
// "XXBTZUSD") instead of the plain ticker. Rather than hard-code every
// response key (undocumented, and has drifted before), match loosely: a
// coin's Kraken code (below) must appear in the key, and the key must be a
// USD market — that survives both the legacy and modern naming styles.
const KRAKEN_LEGACY_CODE = { BTC: 'XBT', DOGE: 'XDG' };

/** Kraken spot prices, one request for every coin listed on Kraken. */
async function fetchFromKraken() {
  const coins = COINS.filter(c => c.krakenPair);
  const url = `${KRAKEN_URL}?pair=${coins.map(c => c.krakenPair).join(',')}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new ProviderError(`Kraken responded ${res.status}`, res.status);
  const data = await res.json();
  if (Array.isArray(data?.error) && data.error.length > 0) throw new ProviderError(`Kraken: ${data.error.join('; ')}`);
  const result = data?.result;
  if (!result || typeof result !== 'object') throw new ProviderError('Kraken returned an unexpected response');

  const entries = Object.entries(result); // [rawKey, tickerBody][]
  const prices = new Map();
  for (const coin of coins) {
    const code = KRAKEN_LEGACY_CODE[coin.ticker] || coin.ticker;
    const match = entries.find(([key]) => key.toUpperCase().includes(code) && key.toUpperCase().endsWith('USD'));
    const price = Number(match?.[1]?.c?.[0]); // 'c' = last trade closed [price, lot volume]
    if (Number.isFinite(price) && price > 0) prices.set(coin.ticker, price);
  }
  if (prices.size === 0) throw new ProviderError('Kraken returned no usable prices');
  return { prices, changes: new Map(), host: 'api.kraken.com' };
}

/** CoinPaprika: one bulk (keyless) request, filtered down to our coins. Also gives 24h change. */
async function fetchFromCoinPaprika() {
  const coins = COINS.filter(c => c.coinpaprikaId);
  const res = await fetch(`${COINPAPRIKA_URL}?quotes=USD`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new ProviderError(`CoinPaprika responded ${res.status}`, res.status);
  const data = await res.json();
  if (!Array.isArray(data)) throw new ProviderError('CoinPaprika returned an unexpected response');

  const byId = new Map(data.map(item => [item.id, item]));
  const prices = new Map();
  const changes = new Map();
  for (const coin of coins) {
    const quote = byId.get(coin.coinpaprikaId)?.quotes?.USD;
    const price = quote?.price;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      prices.set(coin.ticker, price);
      if (typeof quote.percent_change_24h === 'number' && Number.isFinite(quote.percent_change_24h)) {
        changes.set(coin.ticker, quote.percent_change_24h);
      }
    }
  }
  if (prices.size === 0) throw new ProviderError('CoinPaprika returned no usable prices');
  return { prices, changes, host: 'api.coinpaprika.com' };
}

/**
 * CoinMarketCap: a tertiary backup, used only when COINMARKETCAP_API_KEY is
 * set (CMC has no keyless tier). Looked up by ticker symbol; when CMC has more
 * than one listing for a symbol it returns them ranked by market cap, and we
 * take the top one — the same default CMC's own docs describe.
 */
async function fetchFromCoinMarketCap() {
  if (!CONFIG.coinmarketcapApiKey) throw new ProviderError('API key not configured (optional — see .env.example)');
  const symbols = COINS.map(c => c.ticker).join(',');
  const res = await fetch(`${COINMARKETCAP_URL}?symbol=${symbols}&convert=USD`, {
    headers: { 'X-CMC_PRO_API_KEY': CONFIG.coinmarketcapApiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new ProviderError(`CoinMarketCap responded ${res.status}`, res.status);
  const body = await res.json();
  const data = body?.data;
  if (!data || typeof data !== 'object') throw new ProviderError('CoinMarketCap returned an unexpected response');

  const prices = new Map();
  const changes = new Map();
  for (const coin of COINS) {
    const raw = data[coin.ticker];
    const entry = Array.isArray(raw) ? raw[0] : raw;
    const quote = entry?.quote?.USD;
    const price = quote?.price;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      prices.set(coin.ticker, price);
      if (typeof quote.percent_change_24h === 'number' && Number.isFinite(quote.percent_change_24h)) {
        changes.set(coin.ticker, quote.percent_change_24h);
      }
    }
  }
  if (prices.size === 0) throw new ProviderError('CoinMarketCap returned no usable prices');
  return { prices, changes, host: 'pro-api.coinmarketcap.com' };
}

/**
 * DexScreener: the absolute last resort. It has no notion of "BTC" or "ETH"
 * as such — only on-chain trading pairs — so a coin is only trusted here if a
 * pool is found whose base token symbol matches exactly AND clears a minimum
 * liquidity bar (see DEXSCREENER_MIN_LIQUIDITY_USD). That rules out shallow
 * or impostor-token pools rather than trusting whatever the search returns.
 * Stablecoins are skipped entirely — a depeg check needs a precise price, and
 * DEX pool pricing is noisier than a centralized quote for exactly that case.
 */
async function fetchDexScreenerMatch(coin, { fetchFn = fetch } = {}) {
  try {
    const res = await fetchFn(`${DEXSCREENER_SEARCH_URL}?q=${encodeURIComponent(coin.name)}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const body = await res.json();
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
    const candidates = pairs.filter(p =>
      p?.baseToken?.symbol?.toUpperCase() === coin.ticker &&
      Number(p?.liquidity?.usd) >= DEXSCREENER_MIN_LIQUIDITY_USD &&
      Number(p?.priceUsd) > 0
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => Number(b.liquidity.usd) - Number(a.liquidity.usd));
    const best = candidates[0];
    return { price: Number(best.priceUsd), imageUrl: best.info?.imageUrl || null };
  } catch {
    return null;
  }
}

async function fetchFromDexScreener() {
  const coins = COINS.filter(c => !c.stable);
  const matches = await Promise.all(coins.map(coin => fetchDexScreenerMatch(coin)));
  const prices = new Map();
  matches.forEach((match, i) => {
    if (match) prices.set(coins[i].ticker, match.price);
  });
  if (prices.size === 0) throw new ProviderError('DexScreener found no confident matches');
  return { prices, changes: new Map(), host: 'api.dexscreener.com' };
}

const PROVIDERS = {
  coingecko: { label: 'CoinGecko', fetch: fetchFromCoinGecko, expected: () => COINS.length },
  binance: { label: 'Binance', fetch: fetchFromBinance, expected: () => COINS.filter(c => c.binanceSymbol && !c.stable).length },
  kraken: { label: 'Kraken', fetch: fetchFromKraken, expected: () => COINS.filter(c => c.krakenPair).length },
  coinpaprika: { label: 'CoinPaprika', fetch: fetchFromCoinPaprika, expected: () => COINS.filter(c => c.coinpaprikaId).length },
  coinmarketcap: { label: 'CoinMarketCap', fetch: fetchFromCoinMarketCap, expected: () => COINS.length },
  dexscreener: { label: 'DexScreener', fetch: fetchFromDexScreener, expected: () => COINS.filter(c => !c.stable).length },
};

// ---------------------------------------------------------------------
// Source selection (owner-configurable) + health tracking
// ---------------------------------------------------------------------

let preferred = DEFAULT_SOURCE_MODE;
let listener = null;

const health = { primaryFails: 0, primaryOks: 0, allFails: 0, fallbackActive: false, outageActive: false };

export function setPreferredSource(mode) {
  if (!SOURCE_MODES.some(m => m.key === mode)) throw new Error(`Unknown source mode: ${mode}`);
  if (mode !== preferred) {
    resetHealth();
    latest = { ...latest, at: 0 }; // the cached reading came from the old source; fetch fresh
  }
  preferred = mode;
}

export function getPreferredSource() {
  return preferred;
}

/** Receives { type: 'fallback' | 'outage' | 'recovered', ... } when provider health changes. */
export function setSourceListener(fn) {
  listener = fn;
}

/**
 * "CoinMarketCap" is only ever tried when a key is configured (it has no
 * keyless tier) — everything else here is keyless and always available.
 */
function isProviderAvailable(key) {
  return key !== 'coinmarketcap' || Boolean(CONFIG.coinmarketcapApiKey);
}

/**
 * Providers to try, in order, for a given mode.
 *
 * "CoinGecko only" and "Binance first" keep their original, exact two-source
 * chain (unchanged since 1.2.0) — an owner who picked one of those wants
 * precisely the behavior its name promises. "Auto" and "Kraken first" are the
 * two chains hardened with the newer secondary/tertiary sources: an exchange
 * backup, then two independent keyless aggregators, then CoinMarketCap if
 * configured, then DexScreener as the very last resort before giving up.
 */
export function providerOrder(mode) {
  if (mode === 'coingecko') return ['coingecko'];
  if (mode === 'binance') return ['binance', 'coingecko'];
  const chain = mode === 'kraken'
    ? ['kraken', 'binance', 'coingecko', 'coinpaprika', 'coinmarketcap', 'dexscreener']
    : ['coingecko', 'binance', 'kraken', 'coinpaprika', 'coinmarketcap', 'dexscreener'];
  return chain.filter(isProviderAvailable);
}

function resetHealth() {
  Object.assign(health, { primaryFails: 0, primaryOks: 0, allFails: 0, fallbackActive: false, outageActive: false });
}

export function getSourceHealth() {
  return { preferred, ...health, primary: PROVIDERS[providerOrder(preferred)[0]].label };
}

function emit(event) {
  try {
    // The listener may be async; never let its failure break price fetching.
    Promise.resolve(listener?.(event)).catch(err => console.error('[priceService] Source listener failed:', err));
  } catch (err) {
    console.error('[priceService] Source listener failed:', err);
  }
}

// Alerts are deliberately not instant, so one blip doesn't page the owner:
// 2 failed readings in a row = "using backup", 3 in a row from every source =
// "outage", and 3 good readings in a row from the primary = "recovered".
function recordHealth({ primaryKey, primaryOk, anyOk, usedKey, error }) {
  const primary = PROVIDERS[primaryKey].label;

  if (primaryOk) { health.primaryOks++; health.primaryFails = 0; }
  else { health.primaryFails++; health.primaryOks = 0; }
  if (anyOk) health.allFails = 0;
  else health.allFails++;

  if (!anyOk && health.allFails >= 3 && !health.outageActive) {
    health.outageActive = true;
    emit({ type: 'outage', primary, error });
  }
  if (anyOk && health.outageActive && !primaryOk) health.outageActive = false;
  if (!primaryOk && anyOk && health.primaryFails >= 2 && !health.fallbackActive) {
    health.fallbackActive = true;
    emit({ type: 'fallback', primary, used: PROVIDERS[usedKey].label, usedKey, error });
  }
  if (primaryOk && (health.fallbackActive || health.outageActive) && health.primaryOks >= 3) {
    health.fallbackActive = false;
    health.outageActive = false;
    emit({ type: 'recovered', primary });
  }
}

// Most recent successful reading, shared by the scheduler and the admin
// screens (Prices, Test banner, Post prices) so they don't each hit the APIs.
let latest = { prices: null, changes: new Map(), at: 0, source: null, backup: false };

/**
 * Returns Map<ticker, price>. Tries each provider in the current mode's chain
 * (see providerOrder) in order, stopping at the first success. Any coin the
 * winning provider doesn't supply (e.g. stablecoins from Binance) is filled in
 * from the next providers in the chain. Throws only if every provider fails.
 */
export async function fetchAllPrices() {
  const order = providerOrder(preferred);
  const primaryKey = order[0];

  let result = null;
  let usedKey = null;
  let lastError = null;
  for (const key of order) {
    try {
      result = await PROVIDERS[key].fetch();
      usedKey = key;
      break;
    } catch (err) {
      lastError = err;
      console.warn(`[priceService] ${PROVIDERS[key].label} failed (${describeError(err)}).`);
    }
  }

  if (!result) {
    recordHealth({ primaryKey, primaryOk: false, anyOk: false, error: lastError });
    throw lastError ?? new Error('No price source available');
  }

  const prices = new Map(result.prices);
  const changes = new Map(result.changes);
  let fillLabel = null;

  // Fill gaps (stablecoins on Binance, or a coin one provider lacks) from the others.
  const missing = () => COINS.filter(c => !prices.has(c.ticker));
  for (const key of order) {
    if (key === usedKey || missing().length === 0) continue;
    try {
      const extra = await PROVIDERS[key].fetch();
      let filled = false;
      for (const coin of missing()) {
        if (extra.prices.has(coin.ticker)) {
          prices.set(coin.ticker, extra.prices.get(coin.ticker));
          if (extra.changes.has(coin.ticker)) changes.set(coin.ticker, extra.changes.get(coin.ticker));
          filled = true;
        }
      }
      if (filled) fillLabel = PROVIDERS[key].label;
    } catch {
      /* a failed gap-fill is not an outage */
    }
  }

  const backup = usedKey !== primaryKey;
  const label = PROVIDERS[usedKey].label + (backup ? ' (backup)' : '') + (fillLabel ? ` + ${fillLabel}` : '');
  latest = { prices, changes, at: Date.now(), source: label, backup };

  recordHealth({ primaryKey, primaryOk: !backup, anyOk: true, usedKey, error: lastError });
  return prices;
}

/**
 * Admin-side helper: returns { prices, changes, at, source, backup } from the
 * shared cache if it is fresh enough, otherwise fetches. `force` bypasses the
 * cache (but is still throttled to one real fetch per 2 seconds).
 */
export async function getLatestPrices({ maxAgeMs = 20_000, force = false } = {}) {
  const age = Date.now() - latest.at;
  if (latest.prices && (force ? age < 2_000 : age < maxAgeMs)) return latest;
  await fetchAllPrices();
  return latest;
}

/**
 * 24h change (percent) per ticker. Uses the shared reading when it has them
 * (CoinGecko readings do); otherwise asks CoinGecko directly. Returns an empty
 * Map if that fails, so callers can simply omit the direction.
 */
export async function getChanges24h() {
  if (latest.changes?.size > 0 && Date.now() - latest.at < 60_000) return latest.changes;
  try {
    return (await fetchFromCoinGecko()).changes;
  } catch {
    return new Map();
  }
}

/**
 * Checks each provider on its own (without touching the shared cache or the
 * health tracking) for the "Test sources" screen.
 */
export async function testProviders() {
  const results = [];
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const started = Date.now();
    try {
      const r = await provider.fetch();
      results.push({ key, label: provider.label, ok: true, ms: Date.now() - started, count: r.prices.size, expected: provider.expected(), host: r.host, attempts: r.attempts ?? [] });
    } catch (err) {
      results.push({ key, label: provider.label, ok: false, ms: Date.now() - started, error: describeError(err), attempts: err.attempts ?? [] });
    }
  }
  return results;
}

/** Test helper: back to a clean slate. */
export function _resetForTests() {
  preferred = DEFAULT_SOURCE_MODE;
  listener = null;
  resetHealth();
  latest = { prices: null, changes: new Map(), at: 0, source: null, backup: false };
}
