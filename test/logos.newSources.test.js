// Focused tests for the two newly-added logo fallback sources: CoinMarketCap
// (only when a key is configured) and DexScreener (keyless, absolute last
// resort). test/logos.test.js already covers the original CoinGecko + CDN
// path in full; these exercise just the new candidates.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'priceping-logos-newsources-'));
process.env.LOGOS_DIR = dir;
const logos = await import('../src/logoService.js');
const { COINS, CONFIG } = await import('../src/config.js');

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
const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
  arrayBuffer: async () => body,
});

beforeEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  CONFIG.coinmarketcapApiKey = '';
});
test.after(() => { CONFIG.coinmarketcapApiKey = ''; });

test('CoinMarketCap logos are used (one batched call) when CoinGecko lacks the image and a key is configured', async () => {
  CONFIG.coinmarketcapApiKey = 'test-cmc-key';
  const image = await png(200);
  let cmcCalls = 0;

  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('/coins/markets')) return response(200, []); // CoinGecko has nothing for anyone
    if (u.includes('cryptocurrency/info')) {
      cmcCalls++;
      const data = Object.fromEntries(COINS.map(c => [c.ticker, { logo: `https://cmc.test/${c.ticker}.png` }]));
      return response(200, { data });
    }
    if (u.startsWith('https://cmc.test/')) return response(200, image);
    return response(404, null); // CDN fallbacks all fail
  };

  const { saved, failed } = await logos.fetchMissingLogos({ fetchFn, sleep: noSleep, log: quietLog });
  assert.equal(cmcCalls, 1, 'CMC logos must come from a single batched request');
  assert.equal(failed.length, 0);
  assert.equal(saved.length, COINS.length);
});

test('CoinMarketCap logo lookup is never called without a key configured', async () => {
  // CONFIG.coinmarketcapApiKey is '' by beforeEach — deliberately not set here.
  let cmcCalls = 0;
  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('/coins/markets')) return response(200, []);
    if (u.includes('cryptocurrency/info')) { cmcCalls++; return response(200, { data: {} }); }
    return response(404, null);
  };
  await logos.fetchMissingLogos({ fetchFn, sleep: noSleep, log: quietLog });
  assert.equal(cmcCalls, 0, 'no key configured -> CoinMarketCap must never be called');
});

test('DexScreener token-profile image is the last resort when every other candidate fails', async () => {
  const image = await png(200);
  let dexCalls = 0;

  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('/coins/markets')) return response(200, []);
    if (u.includes('cryptocurrency/info')) return response(200, { data: {} }); // CMC knows nothing
    if (u.includes('dexscreener.com')) {
      dexCalls++;
      if (u.includes('Uniswap')) {
        return response(200, {
          pairs: [
            { baseToken: { symbol: 'UNI' }, liquidity: { usd: 100 }, info: { imageUrl: 'https://dex.test/uni.png' } },
            { baseToken: { symbol: 'FAKEUNI' }, liquidity: { usd: 999_999 }, info: { imageUrl: 'https://dex.test/fake.png' } },
          ],
        });
      }
      return response(200, { pairs: [] });
    }
    if (u === 'https://dex.test/uni.png') return response(200, image);
    return response(404, null);
  };

  const { saved, failed } = await logos.fetchMissingLogos({ fetchFn, sleep: noSleep, log: quietLog });
  assert.ok(dexCalls > 0, 'DexScreener should be searched for the coins nothing else could supply');
  assert.ok(saved.includes('UNI'), 'UNI resolved via DexScreener despite the higher-liquidity impostor symbol');
  assert.ok(failed.includes('BTC'), 'coins DexScreener also has no confident match for still fail cleanly');
  assert.ok(await logos.hasLogo('UNI'));
});

test('a DexScreener match with no image is simply not used (never crashes)', async () => {
  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('/coins/markets')) return response(200, []);
    if (u.includes('cryptocurrency/info')) return response(200, { data: {} });
    if (u.includes('dexscreener.com')) {
      return response(200, { pairs: [{ baseToken: { symbol: 'BTC' }, liquidity: { usd: 1_000_000 } }] }); // no info.imageUrl
    }
    return response(404, null);
  };
  const { failed } = await logos.fetchMissingLogos({ fetchFn, sleep: noSleep, log: quietLog });
  assert.ok(failed.includes('BTC'));
});
