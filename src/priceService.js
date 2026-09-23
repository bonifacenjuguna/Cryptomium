import { COINS, CONFIG, SOURCE_MODES, DEFAULT_SOURCE_MODE, DEXSCREENER_PAIRS, coingeckoHeaders } from './config.js';

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
// Binance's main API is blocked (HTTP 451) from some regions/servers; the
// "data-api" host serves the same public market data and is more permissive.
const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const KRAKEN_URL = 'https://api.kraken.com/0/public/Ticker';
const COINPAPRIKA_URL = 'https://api.coinpaprika.com/v1/tickers';
const CMC_URL = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest';

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
    const key = resultKeys.find(k => k.toUpperCase().includes(baseCode) && k.toUpperCase().endsWith('USD'));
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
 * CoinMarketCap. Deliberately requires COINMARKETCAP_API_KEY — CMC's key-free
 * "trial" endpoint is explicitly not meant for production use and can be
 * withdrawn without notice, so the bot never depends on it. Without a key,
 * this fails fast (no network call) with a clear "not configured" reason.
 * Even the cheapest keyed tier (10-15k calls/month) can't sustain this bot's
 * default 30-second polling as a steady source, so — like CoinPaprika — Auto
 * never picks it; it's for an explicit "CoinMarketCap first" choice or
 * 🔍 Test sources only.
 */
async function fetchFromCoinMarketCap() {
  if (!CONFIG.coinMarketCapApiKey) {
    throw new ProviderError('CoinMarketCap needs COINMARKETCAP_API_KEY (not set)');
  }
  const ids = COINS.map(c => c.cmcId).join(',');
  const res = await fetch(`${CMC_URL}?id=${ids}&convert=USD`, {
    headers: { 'X-CMC_PRO_API_KEY': CONFIG.coinMarketCapApiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new ProviderError(`CoinMarketCap responded ${res.status}`, res.status);
  const data = await res.json();
  if (!data?.data || typeof data.data !== 'object') throw new ProviderError('CoinMarketCap returned an unexpected response');

  const prices = new Map();
  const changes = new Map();
  for (const coin of COINS) {
    const usd = data.data[String(coin.cmcId)]?.quote?.USD;
    const price = usd?.price;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      prices.set(coin.ticker, price);
      const change = usd.percent_change_24h;
      if (typeof change === 'number' && Number.isFinite(change)) changes.set(coin.ticker, change);
    }
  }
  if (prices.size === 0) throw new ProviderError('CoinMarketCap returned no usable prices');
  return { prices, changes, host: 'pro-api.coinmarketcap.com' };
}

/**
 * DexScreener prices a specific on-chain liquidity pool, not "the" price of a
 * coin — there's no safe generic way to derive which pool to read for a given
 * ticker (a wrong address, or a copy-cat token sharing the same symbol, would
 * silently return a completely different asset's price). So this only ever
 * covers coins explicitly configured in DEXSCREENER_PAIRS (config.js), which
 * is empty by default. With nothing configured it fails fast with a clear
 * message rather than making a network call.
 */
async function fetchFromDexScreener() {
  const entries = Object.entries(DEXSCREENER_PAIRS);
  if (entries.length === 0) {
    throw new ProviderError('DexScreener has no coins configured (see DEXSCREENER_PAIRS in config.js)');
  }
  const prices = new Map();
  for (const [ticker, pair] of entries) {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/pairs/${pair.chainId}/${pair.pairAddress}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const price = Number(data?.pair?.priceUsd);
      if (Number.isFinite(price) && price > 0) prices.set(ticker, price);
    } catch {
      // One bad pair shouldn't fail the whole source.
    }
  }
  if (prices.size === 0) throw new ProviderError('DexScreener returned no usable prices');
  return { prices, changes: new Map(), host: 'api.dexscreener.com' };
}

const PROVIDERS = {
  coingecko: { label: 'CoinGecko', fetch: fetchFromCoinGecko, expected: () => COINS.length },
  binance: { label: 'Binance', fetch: fetchFromBinance, expected: () => COINS.filter(c => c.binanceSymbol && !c.stable).length },
  kraken: { label: 'Kraken', fetch: fetchFromKraken, expected: () => COINS.filter(c => c.krakenSymbol).length },
  coinpaprika: { label: 'CoinPaprika', fetch: fetchFromCoinPaprika, expected: () => COINS.length },
  coinmarketcap: { label: 'CoinMarketCap', fetch: fetchFromCoinMarketCap, expected: () => COINS.length },
  dexscreener: { label: 'DexScreener', fetch: fetchFromDexScreener, expected: () => Object.keys(DEXSCREENER_PAIRS).length },
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
  if (mode === 'coinmarketcap') return ['coinmarketcap', 'coingecko'];
  if (mode === 'dexscreener') return ['dexscreener', 'coingecko'];
  // Auto: the free, no-key, sustainable-as-a-live-feed sources only. See the
  // long comment above SOURCE_MODES (config.js) for why CoinMarketCap and
  // DexScreener are deliberately excluded here.
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
