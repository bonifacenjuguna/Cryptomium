import { COINS, SOURCE_MODES, DEFAULT_SOURCE_MODE, coingeckoHeaders } from './config.js';

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
// Binance's main API is blocked (HTTP 451) from some regions/servers; the
// "data-api" host serves the same public market data and is more permissive.
const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

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
  const url = `${COINGECKO_URL}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

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
  let lastError;
  for (const host of BINANCE_HOSTS) {
    try {
      return await fetchBinanceFrom(host, coins);
    } catch (err) {
      lastError = err;
    }
  }
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

const PROVIDERS = {
  coingecko: { label: 'CoinGecko', fetch: fetchFromCoinGecko, expected: () => COINS.length },
  binance: { label: 'Binance', fetch: fetchFromBinance, expected: () => COINS.filter(c => c.binanceSymbol && !c.stable).length },
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

/** Providers to try, in order, for a given mode. */
export function providerOrder(mode) {
  if (mode === 'coingecko') return ['coingecko'];
  if (mode === 'binance') return ['binance', 'coingecko'];
  return ['coingecko', 'binance'];
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
 * Returns Map<ticker, price>. Tries the preferred provider first and the other
 * one as backup (unless the mode is "CoinGecko only"). Any coin the winning
 * provider doesn't supply (e.g. stablecoins from Binance) is filled in from the
 * other provider. Throws only if every provider fails.
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
 * cache (but is still throttled to one real fetch per 3 seconds).
 */
export async function getLatestPrices({ maxAgeMs = 20_000, force = false } = {}) {
  const age = Date.now() - latest.at;
  if (latest.prices && (force ? age < 3_000 : age < maxAgeMs)) return latest;
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
      results.push({ key, label: provider.label, ok: true, ms: Date.now() - started, count: r.prices.size, expected: provider.expected(), host: r.host });
    } catch (err) {
      results.push({ key, label: provider.label, ok: false, ms: Date.now() - started, error: describeError(err) });
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
