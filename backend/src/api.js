// Read-only HTTP API for the website dashboard.
//
//   GET /api/prices            live prices + 24h change for every coin
//   GET /api/market            market cap, volume, 24h range, 7d change, 7d sparkline
//   GET /api/history/BTC?range=7d   price history for one coin (24h|7d|30d|90d|1y)
//   GET /api/alerts?limit=20&ticker=BTC   latest milestone alerts the bot posted
//   GET /api/rates             fiat exchange rates for the currency switcher
//   GET /api/logos/BTC.png     coin logo (the same files the banners use)
//   GET /health                "ok" (handy for Railway health checks)
//
// It only READS the price cache the bot already keeps, so any number of
// website visitors costs the same few price-source calls as the bot itself.
// Nothing here can change a setting or post to Telegram.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { COINS, CONFIG, LOGOS_DIR, coinByTicker } from './config.js';
import { getLatestPrices, getChanges24h, getPreferredSource, isUsingBackup } from './priceService.js';
import { fetchChartData } from './chartData.js';
import { fetchMarket, fetchRates } from './marketData.js';
import { createLoader, createKeyedLoader, downsample } from './cache.js';

// History ranges offered to the website, with how long each reading is reused.
// Longer ranges change slowly, so they are cached much longer.
export const HISTORY_RANGES = {
  '24h': { days: 1, ttlMs: 2 * 60_000 },
  '7d': { days: 7, ttlMs: 10 * 60_000 },
  '30d': { days: 30, ttlMs: 30 * 60_000 },
  '90d': { days: 90, ttlMs: 60 * 60_000 },
  '1y': { days: 365, ttlMs: 6 * 60 * 60_000 },
};
const HISTORY_MAX_POINTS = 220;

/**
 * One shared snapshot for all visitors: rebuilt at most once per `ttlMs`, and
 * if a rebuild fails the last good snapshot is served (marked stale).
 */
export function createSnapshotProvider({
  coins,
  getPrices,
  getChanges,
  hasLogo,
  ttlMs, // a number, or a function returning the current number
  changesCacheMs = 60_000,
  now = () => Date.now(),
}) {
  let cached = null;
  let cachedAt = 0;
  let inflight = null;
  let retryAt = 0; // after a failed rebuild, serve the last good snapshot until then
  let fallbackChanges = { at: -Infinity, value: new Map() };
  const currentTtl = () => (typeof ttlMs === 'function' ? ttlMs() : ttlMs);

  // Used only when the price reading carries no 24h changes. Cached (even when
  // it fails) so a fast refresh never turns into a flood of extra requests.
  async function changesFallback() {
    if (now() - fallbackChanges.at < changesCacheMs) return fallbackChanges.value;
    let value = new Map();
    try { value = (await getChanges()) ?? new Map(); } catch { /* leave empty */ }
    fallbackChanges = { at: now(), value };
    return value;
  }

  async function build(ttl) {
    const latest = await getPrices({ maxAgeMs: ttl });
    if (!latest?.prices || latest.prices.size === 0) throw new Error('No prices available yet.');
    const changes = latest.changes?.size > 0 ? latest.changes : await changesFallback();

    const list = [];
    for (const coin of coins) {
      const price = latest.prices.get(coin.ticker);
      const change = changes?.get?.(coin.ticker);
      list.push({
        ticker: coin.ticker,
        name: coin.name,
        price: Number.isFinite(price) ? price : null,
        change24h: Number.isFinite(change) ? change : null,
        stable: Boolean(coin.stable),
        color: coin.brandColor ?? coin.color ?? null,
        logo: (await hasLogo(coin.ticker)) ? `/api/logos/${coin.ticker}.png` : null,
      });
    }
    return {
      updatedAt: new Date(latest.at || now()).toISOString(),
      refreshMs: ttl,
      source: latest.source ?? null,
      stale: false,
      coins: list,
    };
  }

  return async function getSnapshot() {
    const ttl = currentTtl();
    if (cached && now() - cachedAt < ttl) return cached;
    if (cached && now() < retryAt) return { ...cached, stale: true };
    if (!inflight) {
      inflight = build(ttl)
        .then(snap => {
          cached = snap;
          cachedAt = now();
          return snap;
        })
        .catch(err => {
          if (cached) {
            retryAt = now() + 10_000; // do not hammer a failing source on every request
            return { ...cached, stale: true };
          }
          throw err;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}

/** Tiny per-IP limiter: `limit` requests per rolling minute. */
export function createRateLimiter({ limit, now = () => Date.now() }) {
  const hits = new Map(); // ip -> timestamps
  let lastSweep = 0;
  return function allow(ip) {
    const t = now();
    const recent = (hits.get(ip) ?? []).filter(x => x > t - 60_000);
    if (recent.length >= limit) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(t);
    hits.set(ip, recent);
    // Drop idle visitors at most once a minute (never a full scan per request).
    if (t - lastSweep >= 60_000) {
      lastSweep = t;
      for (const [key, list] of hits) if (list.every(x => x <= t - 60_000)) hits.delete(key);
    }
    return true;
  };
}

/**
 * The visitor's address. X-Forwarded-For is a comma list that each proxy appends
 * to, so only entries added by OUR proxies can be trusted: count `hops` from the end.
 */
export function clientIp(req, hops = 1) {
  const fwd = req.headers['x-forwarded-for'];
  if (hops > 0 && typeof fwd === 'string' && fwd.length > 0) {
    const list = fwd.split(',').map(x => x.trim()).filter(Boolean);
    const entry = list[list.length - hops];
    if (entry) return entry;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function createApiHandler({
  getSnapshot,
  logosDir,
  allowedOrigins,
  allow = () => true,
  getMarket = null,
  getRates = null,
  getHistory = null, // (ticker, rangeKey) -> { value, stale }
  getAlerts = null, //  ({ limit, ticker }) -> rows
  proxyHops = 1,
}) {
  const anyOrigin = allowedOrigins.includes('*');
  const tickerSet = new Set(COINS.map(c => c.ticker));

  function cors(req, res) {
    const origin = req.headers.origin;
    if (anyOrigin) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  function json(res, status, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  }

  return async function handle(req, res) {
    cors(req, res);
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }

    if (!allow(clientIp(req, proxyHops))) {
      return json(res, 429, { error: 'Too many requests. Try again in a minute.' }, { 'Retry-After': '60' });
    }

    if (url.pathname === '/api/prices') {
      try {
        const snapshot = await getSnapshot();
        return json(res, 200, snapshot, { 'Cache-Control': 'no-cache' });
      } catch (err) {
        console.error('[api] Could not build price snapshot:', err.message);
        return json(res, 503, { error: 'Prices are not available yet. Try again shortly.' });
      }
    }

    // Cached, read-only data endpoints. Each is optional so the handler stays easy to test.
    const cached = async (loaderFn, shape, cacheControl) => {
      try {
        const { value, stale } = await loaderFn();
        return json(res, 200, shape(value, stale), { 'Cache-Control': cacheControl });
      } catch (err) {
        console.error(`[api] ${url.pathname} failed:`, err.message);
        return json(res, 503, { error: 'Not available right now. Try again shortly.' });
      }
    };

    if (url.pathname === '/api/market' && getMarket) {
      return cached(getMarket, (v, stale) => ({ ...v, stale }), 'public, max-age=60');
    }

    if (url.pathname === '/api/rates' && getRates) {
      return cached(getRates, (v, stale) => ({ ...v, stale }), 'public, max-age=600');
    }

    const history = url.pathname.match(/^\/api\/history\/([A-Za-z0-9]+)$/);
    if (history && getHistory) {
      const ticker = history[1].toUpperCase();
      const rangeKey = (url.searchParams.get('range') || '7d').toLowerCase();
      if (!tickerSet.has(ticker)) return json(res, 404, { error: 'Unknown coin.' });
      if (!HISTORY_RANGES[rangeKey]) return json(res, 400, { error: `range must be one of ${Object.keys(HISTORY_RANGES).join(', ')}.` });
      return cached(
        () => getHistory(ticker, rangeKey),
        (v, stale) => ({ ticker, range: rangeKey, ...v, stale }),
        'public, max-age=60'
      );
    }

    if (url.pathname === '/api/alerts' && getAlerts) {
      const ticker = url.searchParams.get('ticker')?.toUpperCase() || null;
      if (ticker && !tickerSet.has(ticker)) return json(res, 404, { error: 'Unknown coin.' });
      const requested = Number(url.searchParams.get('limit') ?? 20);
      const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.floor(requested))) : 20;
      try {
        const rows = await getAlerts({ limit, ticker });
        const alerts = rows.map(r => ({
          id: Number(r.id),
          ticker: r.ticker,
          direction: r.direction === 'up' || r.direction === 'down' ? r.direction : null,
          price: Number(r.price),
          at: new Date(r.posted_at).toISOString(),
        }));
        return json(res, 200, { alerts }, { 'Cache-Control': 'public, max-age=10' });
      } catch (err) {
        console.error('[api] /api/alerts failed:', err.message);
        return json(res, 503, { error: 'Not available right now. Try again shortly.' });
      }
    }

    const logo = url.pathname.match(/^\/api\/logos\/([A-Za-z0-9]+)\.png$/);
    if (logo) {
      const ticker = logo[1].toUpperCase();
      if (!tickerSet.has(ticker)) return json(res, 404, { error: 'Unknown coin.' });
      try {
        const file = await fs.readFile(path.join(logosDir, `${ticker}.png`));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin' });
        return res.end(file);
      } catch {
        return json(res, 404, { error: 'No logo for this coin yet.' });
      }
    }

    return json(res, 404, { error: 'Not found.' });
  };
}

/** One history reading: [[timeMs, price], ...] thinned for the chart, plus the change over the range. */
export async function loadHistory(ticker, rangeKey, fetchData = fetchChartData) {
  const coin = coinByTicker(ticker);
  const data = await fetchData(coin, HISTORY_RANGES[rangeKey].days, 'line');
  const points = downsample(data.points, HISTORY_MAX_POINTS).map(p => [p.t, Number(p.price.toPrecision(8))]);
  const first = points[0][1];
  const last = points[points.length - 1][1];
  return { points, changePct: first > 0 ? ((last - first) / first) * 100 : null, updatedAt: new Date().toISOString() };
}

/** Starts the API on CONFIG.port. Returns the server (call .close() to stop). */
export function startApi({ recentAlerts }) {
  const hasLogo = async ticker => {
    try {
      return (await fs.stat(path.join(LOGOS_DIR, `${ticker}.png`))).size > 500;
    } catch {
      return false;
    }
  };
  const getSnapshot = createSnapshotProvider({
    coins: COINS,
    // Website visitors must not count towards the bot's "price source failing" alerts.
    getPrices: opts => getLatestPrices({ ...opts, track: false }),
    getChanges: getChanges24h,
    hasLogo,
    // Exchange sources move in real time, so refresh fast. Aggregators
    // (CoinGecko etc.) only update about once a minute and have request
    // limits, so refreshing faster would just repeat the same numbers. If the
    // exchange is down and prices come from the backup, slow down too.
    ttlMs: () =>
      ['binance', 'kraken'].includes(getPreferredSource()) && !isUsingBackup() ? CONFIG.apiRefreshMs : CONFIG.apiSlowRefreshMs,
  });
  const market = createLoader({ load: fetchMarket, ttlMs: 5 * 60_000, failTtlMs: 60_000 });
  const rates = createLoader({ load: fetchRates, ttlMs: 60 * 60_000, failTtlMs: 5 * 60_000 });
  const history = createKeyedLoader({
    load: key => {
      const [ticker, rangeKey] = key.split(':');
      return loadHistory(ticker, rangeKey);
    },
    ttlMs: key => HISTORY_RANGES[key.split(':')[1]].ttlMs,
    failTtlMs: 30_000,
  });
  const alerts = createKeyedLoader({
    load: key => {
      const [ticker, limit] = key.split(':');
      return recentAlerts({ ticker: ticker === '*' ? null : ticker, limit: Number(limit) });
    },
    ttlMs: 15_000,
    failTtlMs: 10_000,
  });

  const handler = createApiHandler({
    getSnapshot,
    logosDir: LOGOS_DIR,
    allowedOrigins: CONFIG.allowedOrigins,
    allow: createRateLimiter({ limit: CONFIG.apiRateLimitPerMin }),
    proxyHops: CONFIG.trustedProxyHops,
    getMarket: market,
    getRates: rates,
    getHistory: (ticker, rangeKey) => history(`${ticker}:${rangeKey}`),
    getAlerts: async ({ ticker, limit }) => (await alerts(`${ticker ?? '*'}:${limit}`)).value,
  });
  const server = http.createServer((req, res) => {
    handler(req, res).catch(err => {
      console.error('[api] Unhandled error:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error.' }));
    });
  });
  server.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`[api] Website API listening on port ${CONFIG.port} (origins: ${CONFIG.allowedOrigins.join(', ')}).`);
  });
  return server;
}
