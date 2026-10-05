import { COINS, CONFIG, SOURCE_MODES, DEFAULT_SOURCE_MODE } from './config.js';

// Demo keys only work on api.coingecko.com with the x-cg-demo-api-key header;
// Pro (paid) keys only work on pro-api.coingecko.com with x-cg-pro-api-key —
// the two hosts/headers are not interchangeable. Rather than require the
// owner to tell the bot which kind of key they have (and remember to change
// anything when they upgrade), the bot tries the Demo host first and, only if
// the key is rejected there, tries the Pro host once and remembers whichever
// one actually worked — so upgrading COINGECKO_API_KEY to a paid Pro key (or
// CoinGecko itself upgrading the same key's tier) just works next tick, no
// config change needed.
const COINGECKO_DEMO = { base: 'https://api.coingecko.com/api/v3', header: 'x-cg-demo-api-key' };
const COINGECKO_PRO = { base: 'https://pro-api.coingecko.com/api/v3', header: 'x-cg-pro-api-key' };
let coingeckoEndpoint = null; // resolved + cached for the process lifetime once a call succeeds

// Binance's main API is blocked (HTTP 451) from some regions/servers; the
// "data-api" host serves the same public market data and is more permissive.
const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const KRAKEN_URL = 'https://api.kraken.com/0/public/Ticker';
const COINPAPRIKA_URL = 'https://api.coinpaprika.com/v1/tickers';

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

/**
 * Fetches a CoinGecko API path (e.g. "/simple/price?...") using whichever
 * host/header currently works for COINGECKO_API_KEY — see the long comment
 * above for why this isn't just "always use one host". Shared by price
 * fetching here and by the logo downloader (logoService.js), so both benefit
 * from the same auto-detection and caching.
 */
export async function coingeckoFetch(path, { timeoutMs = 10_000 } = {}) {
  const call = async endpoint => {
    const headers = CONFIG.coingeckoApiKey ? { [endpoint.header]: CONFIG.coingeckoApiKey } : {};
    return fetch(`${endpoint.base}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  };

  let endpoint = coingeckoEndpoint ?? COINGECKO_DEMO;
  let res = await call(endpoint);

  // Not yet resolved and this is a key that the Demo host rejected (401/403)?
  // It might be a Pro key — try the Pro host once and remember whichever works.
  if (!coingeckoEndpoint && CONFIG.coingeckoApiKey && (res.status === 401 || res.status === 403)) {
    const proRes = await call(COINGECKO_PRO);
    if (proRes.ok) {
      endpoint = COINGECKO_PRO;
      res = proRes;
    }
  }
  if (res.ok) coingeckoEndpoint = coingeckoEndpoint ?? endpoint; // first success locks it in
  return { res, host: new URL(endpoint.base).host };
}

/** One batched CoinGecko request for every coin (also returns 24h change for free). */
async function fetchFromCoinGecko() {
  const ids = COINS.map(c => c.coingeckoId).join(',');
  const { res, host } = await coingeckoFetch(`/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);

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
  return { prices, changes, host };
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

/**
 * Kraken spot prices — genuinely USD-quoted (Kraken is a fiat-rail exchange),
 * so unlike Binance, stablecoins ARE included here.
 *
 * Kraken rejects the whole batched request if even one requested pair name is
 * wrong (same failure mode Binance has for one unknown symbol) — so on error
 * we retry with no `pair` filter (Kraken then returns its whole market) and
 * pick our coins out of that instead, the same resilience pattern used for
 * Binance above.
 */
async function fetchFromKraken() {
  const coins = COINS.filter(c => c.krakenSymbol);
  const pairs = coins.map(c => c.krakenSymbol).join(',');
  const get = url => fetch(url, { signal: AbortSignal.timeout(10_000) });

  let res = await get(`${KRAKEN_URL}?pair=${encodeURIComponent(pairs)}`);
  let data = res.ok ? await res.json() : null;
  if (!res.ok || !data?.result || (Array.isArray(data.error) && data.error.length > 0 && !Object.keys(data.result ?? {}).length)) {
    res = await get(KRAKEN_URL); // no pair filter -> Kraken's whole market
    if (!res.ok) throw new ProviderError(`Kraken responded ${res.status}`, res.status);
    data = await res.json();
  }
  if (!data?.result || typeof data.result !== 'object') {
    throw new ProviderError(`Kraken: ${(data?.error ?? []).join('; ') || 'unexpected response'}`);
  }

  // Kraken's response is keyed by ITS OWN pair name, which for a handful of
  // "original" assets (BTC, ETH, LTC, XRP, XLM) differs from the altname we
  // requested — e.g. requesting XBTUSD can return the key XXBTZUSD, a legacy
  // quirk from before Kraken standardized naming. Rather than hardcode every
  // legacy key (unverifiable without hitting the live API from here), match
  // each coin to whichever returned key contains its base code and ends in
  // "USD" — this works for both the legacy and modern key formats.
  const resultKeys = Object.keys(data.result);
  const prices = new Map();
  for (const coin of coins) {
    const baseCode = coin.ticker === 'BTC' ? 'XBT' : coin.ticker === 'DOGE' ? 'XDG' : coin.ticker;
    // The exact pair we asked for wins; the looser "contains the base code" match is only the fallback.
    const key = resultKeys.find(k => k.toUpperCase() === coin.krakenSymbol)
      ?? resultKeys.find(k => k.toUpperCase().includes(baseCode) && k.toUpperCase().endsWith('USD'));
    const price = key ? Number(data.result[key]?.c?.[0]) : NaN;
    if (Number.isFinite(price) && price > 0) prices.set(coin.ticker, price);
  }
  if (prices.size === 0) throw new ProviderError('Kraken returned no usable prices');
  return { prices, changes: new Map(), host: 'api.kraken.com' };
}

/**
 * CoinPaprika: one call returns every tracked coin (no auth). Matched by its
 * "id" field (e.g. "btc-bitcoin"), not the ticker symbol, since several
 * unrelated coins can share a ticker.
 *
 * Free tier is ~20-25k calls/month with no per-minute cap — comfortably fine
 * as an occasional backup (which is all Auto ever uses it for; see the
 * comment above SOURCE_MODES in config.js), but NOT sustainable as a 30-second
 * primary feed, so the bot never makes it the primary in Auto.
 */
async function fetchFromCoinPaprika() {
  const res = await fetch(COINPAPRIKA_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new ProviderError(`CoinPaprika responded ${res.status}`, res.status);
  const data = await res.json();
  if (!Array.isArray(data)) throw new ProviderError('CoinPaprika returned an unexpected response');

  const byId = new Map(data.map(item => [item.id, item]));
  const prices = new Map();
  const changes = new Map();
  for (const coin of COINS) {
    const usd = byId.get(coin.coinpaprikaId)?.quotes?.USD;
    const price = usd?.price;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      prices.set(coin.ticker, price);
      const change = usd.percent_change_24h;
      if (typeof change === 'number' && Number.isFinite(change)) changes.set(coin.ticker, change);
    }
  }
  if (prices.size === 0) throw new ProviderError('CoinPaprika returned no usable prices');
  return { prices, changes, host: 'api.coinpaprika.com' };
}

/**
 * "Average price": not a single source, but a real-time blend of three that
 * are all cheap enough to call on every tick — CoinGecko, Binance and Kraken
 * (CoinPaprika is left out here specifically because of its monthly quota;
 * see the comment above SOURCE_MODES). Queries all three concurrently, and
 * for each coin reports the RANGE (lowest and highest price any of them
 * returned) and the MIDPOINT of that range — (min + max) / 2 — which is what
 * gets used as "the price" everywhere else in the bot (milestones, banners,
 * captions). Needs at least one source to succeed; a coin missing from every
 * source that responded is simply absent from the result, same as any gap.
 */
async function fetchAverageSpread() {
  const settled = await Promise.allSettled([fetchFromCoinGecko(), fetchFromBinance(), fetchFromKraken()]);
  const oks = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (oks.length === 0) {
    const reasons = settled.map(r => describeError(r.reason)).join('; ');
    throw new ProviderError(`Every source used for the average failed (${reasons})`);
  }

  const byTicker = new Map(); // ticker -> number[]
  for (const result of oks) {
    for (const [ticker, price] of result.prices) {
      if (!byTicker.has(ticker)) byTicker.set(ticker, []);
      byTicker.get(ticker).push(price);
    }
  }

  const prices = new Map();
  const ranges = new Map(); // ticker -> { min, max, sources }
  for (const [ticker, values] of byTicker) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    prices.set(ticker, (min + max) / 2);
    ranges.set(ticker, { min, max, sources: values.length });
  }

  // 24h change, when available, comes from whichever source(s) reported it
  // (only CoinGecko currently does), averaged if more than one did.
  const changesByTicker = new Map();
  for (const result of oks) {
    for (const [ticker, change] of result.changes) {
      if (!changesByTicker.has(ticker)) changesByTicker.set(ticker, []);
      changesByTicker.get(ticker).push(change);
    }
  }
  const changes = new Map();
  for (const [ticker, values] of changesByTicker) {
    changes.set(ticker, values.reduce((a, b) => a + b, 0) / values.length);
  }

  if (prices.size === 0) throw new ProviderError('The average source returned no usable prices');
  const sourceNames = ['CoinGecko', 'Binance', 'Kraken'].filter((_, i) => settled[i].status === 'fulfilled');
  return { prices, changes, ranges, host: `average of ${sourceNames.join(' + ')}` };
}

const PROVIDERS = {
  coingecko: { label: 'CoinGecko', fetch: fetchFromCoinGecko, expected: () => COINS.length },
  binance: { label: 'Binance', fetch: fetchFromBinance, expected: () => COINS.filter(c => c.binanceSymbol && !c.stable).length },
  kraken: { label: 'Kraken', fetch: fetchFromKraken, expected: () => COINS.filter(c => c.krakenSymbol).length },
  coinpaprika: { label: 'CoinPaprika', fetch: fetchFromCoinPaprika, expected: () => COINS.length },
  average: { label: 'Average price', fetch: fetchAverageSpread, expected: () => COINS.length },
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
  if (mode === 'kraken') return ['kraken', 'coingecko'];
  if (mode === 'coinpaprika') return ['coinpaprika', 'coingecko'];
  // 'average' already blends CoinGecko + Binance + Kraken internally (degrading
  // gracefully if one of the three fails), so there's no separate "backup" to
  // chain after it — trying plain CoinGecko again would just repeat a call
  // that already happened as part of the average.
  if (mode === 'average') return ['average'];
  // Auto: the free, no-key, sustainable-as-a-live-feed sources only. See the
  // long comment above SOURCE_MODES (config.js) for why CoinPaprika is last.
  return ['coingecko', 'binance', 'kraken', 'coinpaprika'];
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
// `ranges` is only populated when the source is 🧮 Average price (see
// fetchAverageSpread above) — Map<ticker, { min, max, sources }>.
let latest = { prices: null, changes: new Map(), ranges: null, at: 0, source: null, backup: false };

// Gap-fill readings are reused for a minute (see fetchAllPrices).
const FILL_CACHE_MS = 60_000;
// A failed gap-fill is remembered briefly too, so a rate-limited provider is not
// asked again on every fast refresh (which only makes the rate limit worse).
const FILL_FAIL_CACHE_MS = 30_000;
const fillCache = new Map(); // provider key -> { at, result } or { at, failed, error }

async function fillReading(key) {
  const hit = fillCache.get(key);
  if (hit) {
    const age = Date.now() - hit.at;
    if (hit.failed && age < FILL_FAIL_CACHE_MS) throw hit.error;
    if (!hit.failed && age < FILL_CACHE_MS) return hit.result;
  }
  try {
    const result = await PROVIDERS[key].fetch();
    fillCache.set(key, { at: Date.now(), result });
    return result;
  } catch (err) {
    fillCache.set(key, { at: Date.now(), failed: true, error: err });
    throw err;
  }
}

/**
 * Returns Map<ticker, price>. `track: false` keeps the reading out of the source-health
 * counters (used for website traffic, so visitors never trigger "source failing" alerts).
 * Tries the preferred provider first and the other
 * one as backup (unless the mode is "CoinGecko only"). Any coin the winning
 * provider doesn't supply (e.g. stablecoins from Binance) is filled in from the
 * other provider. Throws only if every provider fails.
 */
export async function fetchAllPrices({ track = true } = {}) {
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
    if (track) recordHealth({ primaryKey, primaryOk: false, anyOk: false, error: lastError });
    throw lastError ?? new Error('No price source available');
  }

  const prices = new Map(result.prices);
  const changes = new Map(result.changes);
  let fillLabel = null;

  // Fill gaps from the other providers: stablecoins on Binance, a coin one
  // provider lacks, and 24h changes (Binance has none). The filler's reading
  // is reused for FILL_CACHE_MS, so a fast-refreshing primary (Binance) does
  // not hammer CoinGecko on every call.
  const missing = () => COINS.filter(c => !prices.has(c.ticker));
  // Only CoinGecko supplies 24h changes, so only it is asked to fill them.
  const needsChanges = key => key === 'coingecko' && changes.size === 0;
  for (const key of order) {
    if (key === usedKey || (missing().length === 0 && !needsChanges(key))) continue;
    try {
      const extra = await fillReading(key);
      let filled = false;
      for (const coin of missing()) {
        if (extra.prices.has(coin.ticker)) {
          prices.set(coin.ticker, extra.prices.get(coin.ticker));
          filled = true;
        }
      }
      // Changes: when the primary supplied none, take the filler's for every coin.
      if (needsChanges(key)) {
        for (const [ticker, change] of extra.changes) if (prices.has(ticker)) { changes.set(ticker, change); filled = true; }
      } else {
        for (const coin of COINS) if (!changes.has(coin.ticker) && extra.changes.has(coin.ticker)) changes.set(coin.ticker, extra.changes.get(coin.ticker));
      }
      if (filled) fillLabel = PROVIDERS[key].label;
    } catch {
      /* a failed gap-fill is not an outage */
    }
  }

  const backup = usedKey !== primaryKey;
  const label = PROVIDERS[usedKey].label + (backup ? ' (backup)' : '') + (fillLabel ? ` + ${fillLabel}` : '');
  latest = { prices, changes, ranges: result.ranges ?? null, at: Date.now(), source: label, backup };

  if (track) recordHealth({ primaryKey, primaryOk: !backup, anyOk: true, usedKey, error: lastError });
  return prices;
}

/**
 * A fast, exchange-only reading for the website's live feed: Binance first, then
 * Kraken, whatever the bot's own source setting is (the bot may prefer an
 * aggregator that only updates once a minute). Never touches the shared cache or
 * the health counters. Coins the exchange lacks (stablecoins on Binance) come from
 * Kraken's cached reading. Throws only if both exchanges fail.
 */
export async function fetchExchangeReading() {
  let result = null;
  let usedKey = null;
  let lastError = null;
  for (const key of ['binance', 'kraken']) {
    try {
      result = await PROVIDERS[key].fetch();
      usedKey = key;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!result) throw lastError ?? new Error('No exchange available');
  const prices = new Map(result.prices);
  if (usedKey !== 'kraken' && COINS.some(c => !prices.has(c.ticker))) {
    try {
      const extra = await fillReading('kraken');
      for (const c of COINS) if (!prices.has(c.ticker) && extra.prices.has(c.ticker)) prices.set(c.ticker, extra.prices.get(c.ticker));
    } catch { /* the reference reading fills any gap */ }
  }
  return { prices, source: PROVIDERS[usedKey].label, at: Date.now() };
}

/**
 * Candles from Binance: [[timeMs, open, high, low, close], ...]. Tries each host.
 * Throws if the coin is not on Binance or every host fails.
 */
export async function fetchBinanceKlines(symbol, interval, limit) {
  let lastError = null;
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await fetch(`${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new ProviderError(`Binance klines responded ${res.status}`, res.status);
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) throw new ProviderError('Binance returned no candles');
      return raw.map(k => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4])]);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Admin-side helper: returns { prices, changes, ranges, at, source, backup }
 * from the shared cache if it is fresh enough, otherwise fetches. `force`
 * bypasses the cache (but is still throttled to one real fetch per 2 seconds).
 */
export async function getLatestPrices({ maxAgeMs = 20_000, force = false, track = true } = {}) {
  const age = Date.now() - latest.at;
  if (latest.prices && (force ? age < 2_000 : age < maxAgeMs)) return latest;
  await fetchAllPrices({ track });
  return latest;
}

/** True when the last reading came from a backup source rather than the chosen one. */
export function isUsingBackup() {
  return Boolean(latest.backup);
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
  fillCache.clear();
  preferred = DEFAULT_SOURCE_MODE;
  listener = null;
  resetHealth();
  latest = { prices: null, changes: new Map(), ranges: null, at: 0, source: null, backup: false };
  coingeckoEndpoint = null;
}
