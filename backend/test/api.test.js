import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApiHandler, createSnapshotProvider, createRateLimiter } from '../src/api.js';

const coins = [
  { ticker: 'BTC', name: 'Bitcoin', stable: false, brandColor: '#F7931A' },
  { ticker: 'USDT', name: 'Tether', stable: true, brandColor: '#26A17B' },
];

function provider(over = {}) {
  let calls = 0;
  let clock = 0;
  const p = createSnapshotProvider({
    coins,
    getPrices: async () => { calls++; return { prices: new Map([['BTC', 86000.5], ['USDT', 0.999]]), changes: new Map([['BTC', 1.25]]), at: 1_700_000_000_000 }; },
    getChanges: async () => new Map(),
    hasLogo: async t => t === 'BTC',
    ttlMs: 15_000,
    now: () => clock,
    ...over,
  });
  return { p, calls: () => calls, advance: ms => { clock += ms; } };
}

test('snapshot has price, 24h change, logo and colour per coin', async () => {
  const { p } = provider();
  const s = await p();
  assert.equal(s.coins.length, 2);
  assert.deepEqual(s.coins[0], { ticker: 'BTC', name: 'Bitcoin', price: 86000.5, change24h: 1.25, stable: false, color: '#F7931A', logo: '/api/logos/BTC.png' });
  assert.equal(s.coins[1].change24h, null);
  assert.equal(s.coins[1].logo, null);
  assert.equal(s.stale, false);
});

test('snapshot includes the price source label', async () => {
  const { p } = provider({
    getPrices: async () => ({ prices: new Map([['BTC', 1]]), changes: new Map([['BTC', 2]]), at: 1, source: 'Binance + CoinGecko' }),
  });
  assert.equal((await p()).source, 'Binance + CoinGecko');
});

test('refresh speed follows the data source (function ttl), and a switch takes effect', async () => {
  let ttl = 5_000;
  const { p, calls, advance } = provider({ ttlMs: () => ttl });
  await p();
  advance(5_001);
  await p();
  assert.equal(calls(), 2, 'fast source: refreshed after 5s');
  ttl = 30_000;
  advance(10_000);
  await p();
  assert.equal(calls(), 2, 'slow source: 10s is not enough');
  advance(21_000);
  await p();
  assert.equal(calls(), 3);
});

test('missing 24h changes are looked up at most once a minute, even if that fails', async () => {
  let lookups = 0;
  const { p, advance } = provider({
    getPrices: async () => ({ prices: new Map([['BTC', 1]]), changes: new Map(), at: 1 }),
    getChanges: async () => { lookups++; throw new Error('rate limited'); },
    ttlMs: 5_000,
  });
  for (let i = 0; i < 6; i++) { await p(); advance(5_001); }
  assert.ok(lookups <= 1 + 1, `looked up ${lookups} times in 30s`);
  advance(60_000);
  await p();
  assert.ok(lookups >= 2);
});

test('visitors share one snapshot inside the refresh window', async () => {
  const { p, calls, advance } = provider();
  await Promise.all([p(), p(), p()]);
  await p();
  assert.equal(calls(), 1);
  advance(15_001);
  await p();
  assert.equal(calls(), 2);
});

test('a failed refresh serves the last good snapshot marked stale', async () => {
  let fail = false;
  const { p, advance } = provider({
    getPrices: async () => { if (fail) throw new Error('down'); return { prices: new Map([['BTC', 1]]), changes: new Map(), at: 1 }; },
  });
  await p();
  fail = true;
  advance(20_000);
  assert.equal((await p()).stale, true);
});

test('rate limiter blocks after the limit and recovers after a minute', () => {
  let t = 0;
  const allow = createRateLimiter({ limit: 2, now: () => t });
  assert.ok(allow('a')); assert.ok(allow('a')); assert.ok(!allow('a'));
  assert.ok(allow('b'));
  t = 60_001;
  assert.ok(allow('a'));
});

async function withServer(opts, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'logos-'));
  await fs.writeFile(path.join(dir, 'BTC.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const { p } = provider();
  const handler = createApiHandler({ getSnapshot: p, logosDir: dir, allowedOrigins: ['*'], ...opts });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test('GET /api/prices returns JSON with CORS; /health and logos work; unknown paths 404', async () => {
  await withServer({}, async base => {
    const r = await fetch(`${base}/api/prices`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal((await r.json()).coins[0].ticker, 'BTC');
    assert.equal(await (await fetch(`${base}/health`)).text(), 'ok');
    const logo = await fetch(`${base}/api/logos/BTC.png`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/api/logos/USDT.png`)).status, 404); // known coin, no file
    assert.equal((await fetch(`${base}/api/logos/NOPE.png`)).status, 404);
    assert.equal((await fetch(`${base}/api/logos/..%2Fsecret.png`)).status, 404);
    assert.equal((await fetch(`${base}/nothing`)).status, 404);
    assert.equal((await fetch(`${base}/api/prices`, { method: 'POST' })).status, 405);
  });
});

test('only the allowed origin gets CORS headers when one is configured', async () => {
  await withServer({ allowedOrigins: ['https://mine.vercel.app'] }, async base => {
    const ok = await fetch(`${base}/api/prices`, { headers: { Origin: 'https://mine.vercel.app' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://mine.vercel.app');
    const bad = await fetch(`${base}/api/prices`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
});

test('rate limited requests get 429', async () => {
  await withServer({ allow: () => false }, async base => {
    assert.equal((await fetch(`${base}/api/prices`)).status, 429);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});

test('GET /api/logos/<T>.png fetches a missing logo on demand, once, and still 404s when it cannot', async () => {
  const { createApiHandler } = await import('../src/api.js');
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const pth = await import('node:path');
  const http = await import('node:http');
  const dir = await fsp.mkdtemp(pth.join(os.tmpdir(), 'logos-od-'));
  let calls = 0;
  const ensureLogo = async t => {
    calls++;
    if (t !== 'BTC') return false;
    await fsp.writeFile(pth.join(dir, 'BTC.png'), Buffer.alloc(900, 1));
    return true;
  };
  const handler = createApiHandler({ getSnapshot: async () => ({ coins: [] }), logosDir: dir, ensureLogo, allowedOrigins: ['*'] });
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/api/logos/BTC.png`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(`${base}/api/logos/BTC.png`)).status, 200);
    assert.equal(calls, 1); // the second request is served from disk
    assert.equal((await fetch(`${base}/api/logos/ETH.png`)).status, 404);
  } finally {
    server.close();
  }
});
