// Read-only HTTP API for the website dashboard.
//
//   GET /api/prices            live prices + 24h change for every coin
//   GET /api/market            market cap, volume, 24h range, 7d change, 7d sparkline
//   GET /api/global            whole-market totals, dominance and breadth of the tracked coins
//   GET /api/news              latest headlines from publishers' public RSS feeds (links to the originals)
//   GET /api/sentiment         Fear & Greed: overall market (alternative.me) and a reading per coin
//   GET /api/stream            the same prices, pushed every couple of seconds (server-sent events)
//   GET /api/history/BTC?range=7d   price history for one coin (24h|7d|30d|90d|1y);
//                              add &style=candles for open/high/low/close candles
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
import { getLatestPrices, getChanges24h, fetchExchangeReading, fetchBinanceKlines } from './priceService.js';
import { createLiveFeed } from './liveFeed.js';
import { fetchChartData } from './chartData.js';
import { fetchMarket, fetchRates } from './marketData.js';
import { createLoader, createKeyedLoader, downsample } from './cache.js';
import { buildSentiment } from './sentiment.js';
import { fetchGlobal, buildBreadth } from './globalData.js';
import { fetchNews } from './news.js';

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

// Candles per range: Binance interval, how many, and how long a reading is reused.
export const CANDLE_SPEC = {
  '24h': { interval: '30m', limit: 48, ttlMs: 60_000 },
  '7d': { interval: '2h', limit: 84, ttlMs: 5 * 60_000 },
  '30d': { interval: '8h', limit: 90, ttlMs: 15 * 60_000 },
  '90d': { interval: '1d', limit: 90, ttlMs: 30 * 60_000 },
  '1y': { interval: '3d', limit: 122, ttlMs: 2 * 60 * 60_000 },
};

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
  ensureLogo = null, // optional: fetch a missing logo on demand, resolves true when it is now on disk
  allowedOrigins,
  allow = () => true,
  getMarket = null,
  getRates = null,
  getSentiment = null,
  getGlobal = null,
  getNews = null,
  getHistory = null, // (ticker, rangeKey) -> { value, stale }
  getAlerts = null, //  ({ limit, ticker }) -> rows
  proxyHops = 1,
  maxStreams = 1_500,
  streamLifetimeMs = 20 * 60_000,
}) {
  const streams = new Set();
  let streamTimer = null;
  let lastSent = null;
  let lastJson = '';
  let ticksSincePing = 0;

  async function pushToStreams() {
    if (streams.size === 0) return;
    try {
      const snap = await getSnapshot();
      const key = snap.updatedAt + '|' + (snap.stale ? 's' : '');
      if (key !== lastSent) {
        lastSent = key;
        lastJson = JSON.stringify(snap);
        for (const r of streams) r.write(`data: ${lastJson}\n\n`);
        ticksSincePing = 0;
      } else if (++ticksSincePing >= 12) {
        for (const r of streams) r.write(': keep-alive\n\n');
        ticksSincePing = 0;
      }
    } catch { /* clients keep the last prices; they reconnect on their own if the stream drops */ }
  }
  function stopStreams() {
    clearInterval(streamTimer);
    streamTimer = null;
    for (const r of streams) r.end();
    streams.clear();
  }

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

  async function handle(req, res) {
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

    if (url.pathname === '/api/stream') {
      if (streams.size >= maxStreams) return json(res, 503, { error: 'Too many live viewers right now. Try again shortly.' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      streams.add(res);
      const drop = () => { streams.delete(res); clearTimeout(lifetime); if (streams.size === 0) { clearInterval(streamTimer); streamTimer = null; } };
      const lifetime = setTimeout(() => res.end(), streamLifetimeMs);
      lifetime.unref?.();
      req.on('close', drop);
      res.on('error', drop);
      try {
        const snap = await getSnapshot();
        res.write(`data: ${JSON.stringify(snap)}\n\n`);
      } catch { /* the loop below sends one as soon as prices exist */ }
      if (!streamTimer) {
        streamTimer = setInterval(pushToStreams, 1000);
        streamTimer.unref?.();
      }
      return;
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

    if (url.pathname === '/api/global' && getGlobal) {
      return cached(getGlobal, (v, stale) => ({ ...v, stale }), 'public, max-age=120');
    }

    if (url.pathname === '/api/news' && getNews) {
      return cached(getNews, (v, stale) => ({ ...v, stale }), 'public, max-age=300');
    }

    if (url.pathname === '/api/sentiment' && getSentiment) {
      return cached(getSentiment, (v, stale) => ({ ...v, stale }), 'public, max-age=300');
    }

    if (url.pathname === '/api/rates' && getRates) {
      return cached(getRates, (v, stale) => ({ ...v, stale }), 'public, max-age=600');
    }

    const history = url.pathname.match(/^\/api\/history\/([A-Za-z0-9]+)$/);
    if (history && getHistory) {
      const ticker = history[1].toUpperCase();
      const rangeKey = (url.searchParams.get('range') || '7d').toLowerCase();
      const style = url.searchParams.get('style') === 'candles' ? 'candles' : 'line';
      if (!tickerSet.has(ticker)) return json(res, 404, { error: 'Unknown coin.' });
      if (!HISTORY_RANGES[rangeKey]) return json(res, 400, { error: `range must be one of ${Object.keys(HISTORY_RANGES).join(', ')}.` });
      return cached(
        () => getHistory(ticker, rangeKey, style),
        (v, stale) => ({ ticker, range: rangeKey, style, ...v, stale }),
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
        const logoFile = path.join(logosDir, `${ticker}.png`);
        let file;
        try {
          file = await fs.readFile(logoFile);
        } catch (err) {
          if (!ensureLogo || !(await ensureLogo(ticker))) throw err;
          file = await fs.readFile(logoFile);
        }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' });
        return res.end(file);
      } catch {
        return json(res, 404, { error: 'No logo for this coin yet.' });
      }
    }

    return json(res, 404, { error: 'Not found.' });
  };
  handle.stop = stopStreams;
  return handle;
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

/**
 * Candles for one coin: [[timeMs, open, high, low, close], ...].
 * Binance first (fine candles, current up to the minute), then CoinGecko's OHLC,
 * and as a last resort the price line itself grouped into candles, so the chart
 * always has something honest to draw.
 */
export async function loadCandles(ticker, rangeKey, { klines = fetchBinanceKlines, fetchData = fetchChartData } = {}) {
  const coin = coinByTicker(ticker);
  const spec = CANDLE_SPEC[rangeKey];
  const days = HISTORY_RANGES[rangeKey].days;
  let candles = null;
  let source = null;

  if (coin.binanceSymbol && !coin.stable) {
    try {
      candles = await klines(coin.binanceSymbol, spec.interval, spec.limit);
      source = 'exchange';
    } catch { /* try the next source */ }
  }
  if (!candles) {
    try {
      const data = await fetchData(coin, days, 'candles');
      if (data.style === 'candles') {
        candles = data.points.map(p => [p.t, p.o, p.h, p.l, p.c]);
        source = 'aggregator';
      }
    } catch { /* fall back to the line */ }
  }
  if (!candles) {
    const data = await fetchData(coin, days, 'line');
    candles = groupIntoCandles(data.points.map(p => [p.t, p.price]), spec.limit);
    source = 'derived';
  }
  candles = candles.filter(c => c.every(Number.isFinite));
  if (candles.length === 0) throw new Error(`No candles for ${ticker}`);
  const first = candles[0][1];
  const last = candles[candles.length - 1][4];
  return {
    candles: candles.map(c => [c[0], ...c.slice(1).map(v => Number(v.toPrecision(8)))]),
    changePct: first > 0 ? ((last - first) / first) * 100 : null,
    source,
    updatedAt: new Date().toISOString(),
  };
}

/** Groups [[t, price], ...] into at most `count` candles. */
export function groupIntoCandles(points, count) {
  if (!points.length) return [];
  const size = Math.max(1, Math.ceil(points.length / count));
  const out = [];
  for (let i = 0; i < points.length; i += size) {
    const chunk = points.slice(i, i + size + (i + size < points.length ? 1 : 0)); // overlap one point so candles join up
    const prices = chunk.map(p => p[1]);
    out.push([chunk[0][0], prices[0], Math.max(...prices), Math.min(...prices), prices[prices.length - 1]]);
  }
  return out;
}

/** Starts the API on CONFIG.port. Returns the server (call .close() to stop). */
export function startApi({ recentAlerts }) {
  // Loaded on first use so the API module itself stays light (the logo code needs the canvas library).
  const ensureLogo = async ticker => (await import('./logoService.js')).ensureLogo(ticker);
  const hasLogo = async ticker => {
    try {
      return (await fs.stat(path.join(LOGOS_DIR, `${ticker}.png`))).size > 500;
    } catch {
      return false;
    }
  };
  // The website has its own fast feed (an exchange, read every couple of seconds
  // while visitors are here), independent of whichever source the bot follows.
  const liveFeed = createLiveFeed({
    intervalMs: CONFIG.apiLiveRefreshMs,
    readExchange: fetchExchangeReading,
    readReference: async () => {
      // Website visitors must not count towards the bot's "price source failing" alerts.
      const r = await getLatestPrices({ maxAgeMs: 45_000, track: false });
      const changes = r.changes?.size > 0 ? r.changes : await getChanges24h();
      return { prices: r.prices, changes, source: r.source, at: r.at };
    },
  });
  const getSnapshot = createSnapshotProvider({
    coins: COINS,
    getPrices: () => liveFeed(),
    getChanges: getChanges24h,
    hasLogo,
    // Rebuilt every second at most; the live feed behind it re-reads the exchange
    // every apiLiveRefreshMs. If no exchange is reachable the feed serves the
    // aggregator's reading, which only changes about once a minute, so slow down.
    ttlMs: () => (liveFeed.isLive() ? 1_000 : CONFIG.apiSlowRefreshMs),
  });
  const market = createLoader({ load: fetchMarket, ttlMs: 5 * 60_000, failTtlMs: 60_000 });
  const sentiment = createLoader({
    load: async () => {
      const mk = (await market()).value;
      let prices = {};
      try { prices = Object.fromEntries((await getSnapshot()).coins.map(c => [c.ticker, c.price])); } catch { /* fine */ }
      return buildSentiment({ market: mk, prices });
    },
    ttlMs: 10 * 60_000,
    failTtlMs: 60_000,
  });
  // Global totals and breadth share the market loader, so this adds one CoinGecko call per window.
  const globalLoader = createLoader({
    load: async () => {
      const mk = (await market()).value;
      let g = null;
      try { g = await fetchGlobal(); } catch { /* breadth and tracked totals still work */ }
      if (!g && !mk) throw new Error('No global data');
      return { ...(g ?? { updatedAt: new Date().toISOString() }), breadth: buildBreadth(mk, g), complete: Boolean(g) };
    },
    ttlMs: 3 * 60_000,
    failTtlMs: 60_000,
  });
  const news = createLoader({ load: fetchNews, ttlMs: 10 * 60_000, failTtlMs: 2 * 60_000 });
  const rates = createLoader({ load: fetchRates, ttlMs: 60 * 60_000, failTtlMs: 5 * 60_000 });
  const history = createKeyedLoader({
    load: key => {
      const [ticker, rangeKey, style] = key.split(':');
      return style === 'candles' ? loadCandles(ticker, rangeKey) : loadHistory(ticker, rangeKey);
    },
    ttlMs: key => {
      const [, rangeKey, style] = key.split(':');
      return (style === 'candles' ? CANDLE_SPEC : HISTORY_RANGES)[rangeKey].ttlMs;
    },
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
    ensureLogo,
    allowedOrigins: CONFIG.allowedOrigins,
    allow: createRateLimiter({ limit: CONFIG.apiRateLimitPerMin }),
    proxyHops: CONFIG.trustedProxyHops,
    getMarket: market,
    getRates: rates,
    getSentiment: sentiment,
    getGlobal: globalLoader,
    getNews: news,
    getHistory: (ticker, rangeKey, style) => history(`${ticker}:${rangeKey}:${style}`),
    maxStreams: CONFIG.apiMaxStreams,
    getAlerts: async ({ ticker, limit }) => (await alerts(`${ticker ?? '*'}:${limit}`)).value,
  });
  const server = http.createServer((req, res) => {
    handler(req, res).catch(err => {
      console.error('[api] Unhandled error:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error.' }));
    });
  });
  server.on('close', () => handler.stop());
  server.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`[api] Website API listening on port ${CONFIG.port} (origins: ${CONFIG.allowedOrigins.join(', ')}).`);
  });
  return server;
}
