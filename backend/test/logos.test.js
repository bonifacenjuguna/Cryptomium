import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

// The logo folder is read from LOGOS_DIR when the module loads.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cryptomium-logos-'));
process.env.LOGOS_DIR = dir;
const logos = await import('../src/logoService.js');
const { COINS } = await import('../src/config.js');

async function png(size = 128) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3366ff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  return canvas.encode('png');
}

const quietLog = { log() {}, warn() {} };
const noSleep = async () => {};

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => headers[name.toLowerCase()] ?? null },
  json: async () => body,
  arrayBuffer: async () => body,
});

beforeEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
});

test('fetchWithRetry retries a 429 and honors Retry-After', async () => {
  const waits = [];
  const replies = [response(429, null, { 'retry-after': '7' }), response(200, 'fine')];
  const res = await logos.fetchWithRetry('https://example.com/x', {
    fetchFn: async () => replies.shift(),
    sleep: async ms => waits.push(ms),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(waits, [7000]);
});

test('fetchWithRetry does not retry a 404, and gives up after the last try on 500s', async () => {
  let calls = 0;
  await assert.rejects(
    logos.fetchWithRetry('https://example.com/x', { fetchFn: async () => (calls++, response(404)), sleep: noSleep }),
    /404/
  );
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(
    logos.fetchWithRetry('https://example.com/x', { fetchFn: async () => (calls++, response(500)), sleep: noSleep, tries: 3 }),
    /500/
  );
  assert.equal(calls, 3);
});

test('normalizeToPng re-encodes to 256x256 and rejects tiny images', async () => {
  const out = await logos.normalizeToPng(await png(128));
  assert.ok(out.length > 500);
  await assert.rejects(logos.normalizeToPng(await png(16)), /too small/);
});

test('fetchMissingLogos: one batched CoinGecko call, retries, CDN fallback, monogram-worthy failures reported', async () => {
  const image = await png(250);
  const calls = [];
  let marketCalls = 0;
  let rateLimitedOnce = false;

  const fetchFn = async url => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/coins/markets')) {
      marketCalls++;
      // CoinGecko knows every coin EXCEPT dogecoin; cardano's image URL 429s once, then works.
      const items = COINS.filter(c => c.coingeckoId !== 'dogecoin').map(c => ({ id: c.coingeckoId, image: `https://img.test/${c.ticker}.png` }));
      return response(200, items);
    }
    if (u === 'https://img.test/ADA.png' && !rateLimitedOnce) { rateLimitedOnce = true; return response(429, null); }
    if (u.startsWith('https://img.test/')) return response(200, image);
    if (u.includes('jsdelivr') && u.endsWith('/doge.png')) return response(200, image); // DOGE via fallback CDN
    return response(404, null); // TON has no source at all
  };
  // TON: make CoinGecko not know it either
  const wrapped = async url => (String(url).includes('img.test/TON.png') ? response(404, null) : fetchFn(url));

  const { saved, failed } = await logos.fetchMissingLogos({ fetchFn: wrapped, sleep: noSleep, log: quietLog });

  assert.equal(marketCalls, 1, 'image URLs must come from a single batched request');
  assert.deepEqual(failed, ['TON']);
  assert.equal(saved.length, COINS.length - 1);
  assert.ok(saved.includes('DOGE'), 'DOGE should come from the fallback CDN');
  assert.ok(saved.includes('ADA'), 'ADA should survive a 429 via retry');
  for (const ticker of saved) assert.ok(await logos.hasLogo(ticker), `${ticker} file exists`);
  assert.deepEqual(await logos.missingLogos(), ['TON']);
});

test('fetchMissingLogos skips logos that already exist, and does nothing when none are missing', async () => {
  const image = await png(250);
  for (const c of COINS) await fs.writeFile(logos.logoPath(c.ticker), await logos.normalizeToPng(image));
  let calls = 0;
  const result = await logos.fetchMissingLogos({ fetchFn: async () => (calls++, response(500)), sleep: noSleep, log: quietLog });
  assert.deepEqual(result, { saved: [], failed: [] });
  assert.equal(calls, 0);
});

test('if CoinGecko is down entirely, fallback CDNs still supply logos', async () => {
  const image = await png(128);
  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('coingecko')) return response(503, null);
    if (u.includes('jsdelivr')) return response(200, image);
    return response(404, null);
  };
  const { saved, failed } = await logos.fetchMissingLogos({ fetchFn, sleep: noSleep, log: quietLog });
  assert.equal(failed.length, 0);
  assert.equal(saved.length, COINS.length);
});
