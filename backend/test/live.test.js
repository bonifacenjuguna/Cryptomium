import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLiveFeed } from '../src/liveFeed.js';
import { createApiHandler, loadCandles, groupIntoCandles } from '../src/api.js';

// ---- live feed ---------------------------------------------------------------------

function feedWith({ ex, ref, t = { now: 0 } }) {
  const calls = { ex: 0, ref: 0 };
  const feed = createLiveFeed({
    intervalMs: 2000,
    referenceMs: 60_000,
    exchangeRetryMs: 15_000,
    now: () => t.now,
    readExchange: async () => { calls.ex++; return ex(); },
    readReference: async () => { calls.ref++; return ref(); },
  });
  return { feed, calls, t };
}

test('live feed: price moves with the exchange and the 24h change moves with it', async () => {
  let price = 100;
  const { feed, t } = feedWith({
    ex: () => ({ prices: new Map([['BTC', price]]), source: 'Binance', at: t0() }),
    ref: () => ({ prices: new Map([['BTC', 100]]), changes: new Map([['BTC', 10]]), source: 'CoinGecko' }),
  });
  function t0() { return t.now; }
  let r = await feed();
  assert.equal(r.prices.get('BTC'), 100);
  assert.ok(Math.abs(r.changes.get('BTC') - 10) < 1e-9, 'anchored to the reference change');
  t.now = 2500; price = 110;
  r = await feed();
  assert.equal(r.prices.get('BTC'), 110);
  assert.ok(Math.abs(r.changes.get('BTC') - 21) < 1e-9, '110 against a 24h-ago price of 90.909 is +21%');
  assert.equal(feed.isLive(), true);
});

test('live feed: serves a recent reading without asking again, and shares one request', async () => {
  const { feed, calls, t } = feedWith({
    ex: () => ({ prices: new Map([['ETH', 5]]), source: 'Binance', at: 0 }),
    ref: () => ({ prices: new Map([['ETH', 5]]), changes: new Map(), source: 'CoinGecko' }),
  });
  await Promise.all([feed(), feed(), feed()]);
  assert.equal(calls.ex, 1);
  t.now = 500; await feed();
  assert.equal(calls.ex, 1);
  t.now = 2100; await feed();
  assert.equal(calls.ex, 2);
});

test('live feed: falls back to the reference when the exchange is down, and retries later', async () => {
  let up = false;
  const { feed, calls, t } = feedWith({
    ex: () => { if (!up) throw new Error('451'); return { prices: new Map([['BTC', 120]]), source: 'Binance', at: 0 }; },
    ref: () => ({ prices: new Map([['BTC', 100]]), changes: new Map([['BTC', 5]]), source: 'CoinGecko' }),
  });
  let r = await feed();
  assert.equal(r.prices.get('BTC'), 100);
  assert.equal(r.changes.get('BTC'), 5);
  assert.equal(feed.isLive(), false);
  t.now = 3000; await feed(); // inside the retry pause: exchange not asked again
  assert.equal(calls.ex, 1);
  up = true; t.now = 20_000;
  r = await feed();
  assert.equal(r.prices.get('BTC'), 120);
  assert.equal(feed.isLive(), true);
});

test('live feed: fills coins the exchange lacks from the reference', async () => {
  const { feed } = feedWith({
    ex: () => ({ prices: new Map([['BTC', 100]]), source: 'Binance', at: 0 }),
    ref: () => ({ prices: new Map([['BTC', 99], ['USDT', 1]]), changes: new Map(), source: 'CoinGecko' }),
  });
  const r = await feed();
  assert.equal(r.prices.get('USDT'), 1);
  assert.equal(r.prices.get('BTC'), 100);
});

test('live feed: throws only when nothing at all is available', async () => {
  const { feed } = feedWith({ ex: () => { throw new Error('x'); }, ref: () => { throw new Error('y'); } });
  await assert.rejects(feed(), /No prices/);
});

// ---- candles ---------------------------------------------------------------------

test('loadCandles prefers the exchange, then the aggregator, then the price line', async () => {
  const k = [[1, 10, 12, 9, 11], [2, 11, 13, 10, 12]];
  let r = await loadCandles('BTC', '7d', { klines: async (sym, interval, limit) => { assert.equal(sym, 'BTCUSDT'); assert.equal(interval, '2h'); assert.equal(limit, 84); return k; } });
  assert.equal(r.source, 'exchange');
  assert.deepEqual(r.candles, k);
  assert.ok(Math.abs(r.changePct - 20) < 1e-9);

  r = await loadCandles('BTC', '7d', {
    klines: async () => { throw new Error('451'); },
    fetchData: async (coin, days, style) => { assert.equal(style, 'candles'); return { style: 'candles', points: [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5 }] }; },
  });
  assert.equal(r.source, 'aggregator');

  r = await loadCandles('USDT', '24h', {
    klines: async () => { throw new Error('should not be used for stablecoins'); },
    fetchData: async (coin, days, style) => {
      if (style === 'candles') throw new Error('rate limited');
      return { style: 'line', points: [{ t: 1, price: 1 }, { t: 2, price: 1.001 }, { t: 3, price: 0.999 }, { t: 4, price: 1 }] };
    },
  });
  assert.equal(r.source, 'derived');
  assert.ok(r.candles.length >= 1);
});

test('groupIntoCandles builds joined-up OHLC candles from a line', () => {
  const pts = [[1, 10], [2, 14], [3, 8], [4, 12], [5, 13], [6, 9]];
  const c = groupIntoCandles(pts, 2);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], [1, 10, 14, 8, 12]); // 10 -> 14 -> 8 -> 12 (overlaps the next start)
  assert.equal(c[1][0], 4);
  assert.equal(c[1][2], 13);
  assert.equal(c[1][3], 9);
  assert.deepEqual(groupIntoCandles([], 5), []);
});

// ---- /api/stream ---------------------------------------------------------------------

test('/api/stream pushes a first snapshot at once, then only when it changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-'));
  let n = 0;
  const handler = createApiHandler({
    getSnapshot: async () => ({ updatedAt: `t${Math.min(n, 1)}`, coins: [{ ticker: 'BTC', price: 100 + n }] }),
    logosDir: dir,
    allowedOrigins: ['*'],
  });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctl = new AbortController();
  try {
    const res = await fetch(`${base}/api/stream`, { signal: ctl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    const readUntil = async re => { while (!re.test(text)) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); } };
    await readUntil(/data: .*t0/);
    assert.match(text, /"price":100/);
    n = 1; // snapshot changes
    await readUntil(/data: .*t1/);
    assert.match(text, /"price":101/);
  } finally {
    ctl.abort();
    handler.stop();
    server.close();
  }
});

test('/api/stream refuses new viewers past the limit', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-'));
  const handler = createApiHandler({ getSnapshot: async () => ({ updatedAt: 'x', coins: [] }), logosDir: dir, allowedOrigins: ['*'], maxStreams: 1 });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = new AbortController();
  try {
    const first = await fetch(`${base}/api/stream`, { signal: a.signal });
    assert.equal(first.status, 200);
    const second = await fetch(`${base}/api/stream`);
    assert.equal(second.status, 503);
  } finally {
    a.abort();
    handler.stop();
    server.close();
  }
});

test('/api/history passes style=candles through', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-'));
  const seen = [];
  const handler = createApiHandler({
    getSnapshot: async () => ({ coins: [] }), logosDir: dir, allowedOrigins: ['*'],
    getHistory: async (t, r, s) => { seen.push([t, r, s]); return { value: { candles: [[1, 1, 2, 0, 1]] }, stale: false }; },
  });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = await (await fetch(`${base}/api/history/btc?range=24h&style=candles`)).json();
    assert.equal(j.style, 'candles');
    assert.deepEqual(j.candles, [[1, 1, 2, 0, 1]]);
    await fetch(`${base}/api/history/btc?range=7d`);
    assert.deepEqual(seen, [['BTC', '24h', 'candles'], ['BTC', '7d', 'line']]);
  } finally { handler.stop(); server.close(); }
});
