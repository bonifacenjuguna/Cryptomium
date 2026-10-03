// Read-only HTTP API for the website dashboard.
//
//   GET /api/prices        live prices + 24h change for every coin
//   GET /api/logos/BTC.png coin logo (the same files the banners use)
//   GET /health            "ok" (handy for Railway health checks)
//
// It only READS the price cache the bot already keeps, so any number of
// website visitors costs the same few price-source calls as the bot itself.
// Nothing here can change a setting or post to Telegram.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { COINS, CONFIG, LOGOS_DIR } from './config.js';
import { getLatestPrices, getChanges24h, getPreferredSource } from './priceService.js';

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
    if (!inflight) {
      inflight = build(ttl)
        .then(snap => {
          cached = snap;
          cachedAt = now();
          return snap;
        })
        .catch(err => {
          if (cached) return { ...cached, stale: true };
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
  return function allow(ip) {
    const t = now();
    const recent = (hits.get(ip) ?? []).filter(x => x > t - 60_000);
    if (recent.length >= limit) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(t);
    hits.set(ip, recent);
    if (hits.size > 5_000) {
      for (const [key, list] of hits) if (list.every(x => x <= t - 60_000)) hits.delete(key);
    }
    return true;
  };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

export function createApiHandler({ getSnapshot, logosDir, allowedOrigins, allow = () => true }) {
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

    if (!allow(clientIp(req))) {
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

    const logo = url.pathname.match(/^\/api\/logos\/([A-Za-z0-9]+)\.png$/);
    if (logo) {
      const ticker = logo[1].toUpperCase();
      if (!tickerSet.has(ticker)) return json(res, 404, { error: 'Unknown coin.' });
      try {
        const file = await fs.readFile(path.join(logosDir, `${ticker}.png`));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
        return res.end(file);
      } catch {
        return json(res, 404, { error: 'No logo for this coin yet.' });
      }
    }

    return json(res, 404, { error: 'Not found.' });
  };
}

/** Starts the API on CONFIG.port. Returns the server (call .close() to stop). */
export function startApi() {
  const hasLogo = async ticker => {
    try {
      return (await fs.stat(path.join(LOGOS_DIR, `${ticker}.png`))).size > 500;
    } catch {
      return false;
    }
  };
  const getSnapshot = createSnapshotProvider({
    coins: COINS,
    getPrices: getLatestPrices,
    getChanges: getChanges24h,
    hasLogo,
    // Exchange sources move in real time, so refresh fast. Aggregators
    // (CoinGecko etc.) only update about once a minute and have request
    // limits, so refreshing faster would just repeat the same numbers.
    ttlMs: () => (['binance', 'kraken'].includes(getPreferredSource()) ? CONFIG.apiRefreshMs : CONFIG.apiSlowRefreshMs),
  });
  const handler = createApiHandler({
    getSnapshot,
    logosDir: LOGOS_DIR,
    allowedOrigins: CONFIG.allowedOrigins,
    allow: createRateLimiter({ limit: CONFIG.apiRateLimitPerMin }),
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
