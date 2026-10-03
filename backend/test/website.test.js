import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLoader, createKeyedLoader, downsample } from '../src/cache.js';
import { fetchMarket, fetchRates } from '../src/marketData.js';
import { createApiHandler, createRateLimiter, clientIp, loadHistory, HISTORY_RANGES } from '../src/api.js';

// ---- cache helpers ----------------------------------------------------------

test('loader: shares one load, reuses it inside the ttl, refreshes after', async () => {
  let t = 0, loads = 0;
  const get = createLoader({ load: async () => ++loads, ttlMs: 1000, now: () => t });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a.value, 1); assert.equal(b.value, 1);
  t = 999; assert.equal((await get()).value, 1);
  t = 1001; assert.equal((await get()).value, 2);
});

test('loader: after a failure it serves the old value as stale and does not retry for failTtl', async () => {
  let t = 0, loads = 0, fail = false;
  const get = createLoader({ load: async () => { loads++; if (fail) throw new Error('x'); return 'ok'; }, ttlMs: 1000, failTtlMs: 5000, now: () => t });
  await get();
  fail = true; t = 2000;
  assert.deepEqual(await get(), { value: 'ok', stale: true });
  const before = loads;
  t = 4000; await get(); t = 6000; await get();
  assert.equal(loads, before, 'no new attempts inside failTtl');
  t = 7001; await get();
  assert.equal(loads, before + 1);
});

test('loader: with nothing cached the error is thrown, and also remembered briefly', async () => {
  let t = 0, loads = 0;
  const get = createLoader({ load: async () => { loads++; throw new Error('down'); }, ttlMs: 1000, failTtlMs: 5000, now: () => t });
  await assert.rejects(get(), /down/);
  await assert.rejects(get(), /down/);
  assert.equal(loads, 1);
});

test('keyed loader keeps keys independent; downsample keeps ends', async () => {
  const get = createKeyedLoader({ load: async k => k.toUpperCase(), ttlMs: 1000 });
  assert.equal((await get('a')).value, 'A');
  assert.equal((await get('b')).value, 'B');
  const d = downsample(Array.from({ length: 1000 }, (_, i) => i), 50);
  assert.equal(d.length, 50); assert.equal(d[0], 0); assert.equal(d.at(-1), 999);
  assert.deepEqual(downsample([1, 2, 3], 50), [1, 2, 3]);
});

// ---- market + rates parsing -----------------------------------------------------

const okJson = body => async () => ({ res: { ok: true, status: 200, json: async () => body } });

test('fetchMarket maps CoinGecko rows to tickers and thins the sparkline', async () => {
  const spark = Array.from({ length: 168 }, (_, i) => 80000 + i);
  const m = await fetchMarket({ get: okJson([
    { id: 'bitcoin', market_cap: 1.6e12, total_volume: 3e10, high_24h: 87000, low_24h: 85000, price_change_percentage_7d_in_currency: 2.5, sparkline_in_7d: { price: spark } },
    { id: 'unknown-coin', market_cap: 1 },
  ]) });
  assert.deepEqual(Object.keys(m.coins), ['BTC']);
  assert.equal(m.coins.BTC.marketCap, 1.6e12);
  assert.equal(m.coins.BTC.change7d, 2.5);
  assert.equal(m.coins.BTC.spark.length, 56);
  assert.equal(m.coins.BTC.spark.at(-1), 80167);
});

test('fetchMarket rejects on HTTP errors and empty answers', async () => {
  await assert.rejects(fetchMarket({ get: async () => ({ res: { ok: false, status: 429 } }) }), /429/);
  await assert.rejects(fetchMarket({ get: okJson([]) }), /no usable/);
});

test('fetchRates converts per-BTC quotes into units per US dollar and skips junk', async () => {
  const r = await fetchRates({ get: okJson({ rates: {
    usd: { value: 100000, type: 'fiat' }, kes: { value: 12900000, type: 'fiat' },
    eur: { value: 90000, type: 'fiat' }, eth: { value: 40, type: 'crypto' }, gbp: { value: 0, type: 'fiat' },
  } }) });
  assert.equal(r.rates.USD, 1);
  assert.equal(r.rates.KES, 129);
  assert.equal(r.rates.EUR, 0.9);
  assert.equal(r.rates.GBP, undefined);
  assert.equal(r.rates.ETH, undefined);
  await assert.rejects(fetchRates({ get: okJson({ rates: {} }) }), /unexpected/);
});

// ---- history -------------------------------------------------------------------

test('loadHistory returns thinned [t, price] pairs and the change over the range', async () => {
  const data = { points: Array.from({ length: 1000 }, (_, i) => ({ t: i * 1000, price: 100 + i / 10 })) };
  const h = await loadHistory('BTC', '7d', async (coin, days) => { assert.equal(coin.ticker, 'BTC'); assert.equal(days, 7); return data; });
  assert.ok(h.points.length <= 220);
  assert.deepEqual(h.points[0], [0, 100]);
  assert.ok(Math.abs(h.changePct - 99.9) < 0.01);
  assert.ok(HISTORY_RANGES['1y'].ttlMs > HISTORY_RANGES['24h'].ttlMs);
});

// ---- client address / limiter ----------------------------------------------------

test('clientIp ignores what a visitor writes at the start of X-Forwarded-For', () => {
  const req = h => ({ headers: h, socket: { remoteAddress: '10.0.0.9' } });
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }), 1), '203.0.113.7');
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7, 10.1.1.1' }), 2), '203.0.113.7');
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.1.1.1' }), 0), '10.0.0.9');
  assert.equal(clientIp(req({}), 1), '10.0.0.9');
});

test('rate limiter sweeps idle visitors but still limits', () => {
  let t = 0;
  const allow = createRateLimiter({ limit: 1, now: () => t });
  assert.ok(allow('a')); assert.ok(!allow('a'));
  t = 120_000;
  assert.ok(allow('b'));
  assert.ok(allow('a'));
});

// ---- HTTP routes ---------------------------------------------------------------

async function withApi(opts, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-'));
  const handler = createApiHandler({ getSnapshot: async () => ({ coins: [] }), logosDir: dir, allowedOrigins: ['*'], ...opts });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test('/api/market and /api/rates return the cached value plus a stale flag', async () => {
  await withApi({
    getMarket: async () => ({ value: { coins: { BTC: { marketCap: 1 } } }, stale: false }),
    getRates: async () => ({ value: { base: 'USD', rates: { USD: 1, KES: 129 } }, stale: true }),
  }, async base => {
    const m = await (await fetch(`${base}/api/market`)).json();
    assert.equal(m.coins.BTC.marketCap, 1); assert.equal(m.stale, false);
    const r = await (await fetch(`${base}/api/rates`)).json();
    assert.equal(r.rates.KES, 129); assert.equal(r.stale, true);
  });
});

test('/api/market is a 503 (not a crash) when the loader fails', async () => {
  await withApi({ getMarket: async () => { throw new Error('boom'); } }, async base => {
    assert.equal((await fetch(`${base}/api/market`)).status, 503);
  });
});

test('/api/history validates coin and range, and passes them through', async () => {
  const seen = [];
  await withApi({ getHistory: async (t, r) => { seen.push([t, r]); return { value: { points: [[1, 2]], changePct: 0 }, stale: false }; } }, async base => {
    const ok = await (await fetch(`${base}/api/history/btc?range=30d`)).json();
    assert.equal(ok.ticker, 'BTC'); assert.equal(ok.range, '30d'); assert.deepEqual(ok.points, [[1, 2]]);
    assert.deepEqual(seen, [['BTC', '30d']]);
    assert.equal((await fetch(`${base}/api/history/btc`)).status, 200); // default range
    assert.equal((await fetch(`${base}/api/history/btc?range=5y`)).status, 400);
    assert.equal((await fetch(`${base}/api/history/NOPE?range=7d`)).status, 404);
    assert.equal(seen.length, 2);
  });
});

test('/api/alerts shapes rows, clamps the limit and validates the ticker', async () => {
  let args;
  await withApi({ getAlerts: async a => { args = a; return [{ id: '7', ticker: 'BTC', direction: 'up', price: '86500', posted_at: new Date('2026-10-03T08:00:00Z') }, { id: 6, ticker: 'ETH', direction: null, price: 1, posted_at: '2026-10-03T07:00:00Z' }]; } }, async base => {
    const body = await (await fetch(`${base}/api/alerts?limit=9999&ticker=btc`)).json();
    assert.deepEqual(args, { limit: 50, ticker: 'BTC' });
    assert.deepEqual(body.alerts[0], { id: 7, ticker: 'BTC', direction: 'up', price: 86500, at: '2026-10-03T08:00:00.000Z' });
    assert.equal(body.alerts[1].direction, null);
    await fetch(`${base}/api/alerts?limit=abc`);
    assert.deepEqual(args, { limit: 20, ticker: null });
    assert.equal((await fetch(`${base}/api/alerts?ticker=NOPE`)).status, 404);
  });
});

test('the new routes stay 404 when their data source is not wired up', async () => {
  await withApi({}, async base => {
    for (const p of ['/api/market', '/api/rates', '/api/alerts', '/api/history/BTC']) assert.equal((await fetch(base + p)).status, 404);
  });
});
