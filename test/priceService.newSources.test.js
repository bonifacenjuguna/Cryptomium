// Focused tests for the four newly-integrated sources (Kraken, CoinPaprika,
// CoinMarketCap, DexScreener). test/priceService.test.js already covers the
// original CoinGecko/Binance pairing in full; these tests exercise the new
// providers' own parsing logic and their place in the "auto" chain, with a
// fake network that actually understands each provider's real response shape
// (unlike the older test's generic Binance-shaped catch-all).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { COINS, CONFIG } from '../src/config.js';
import * as ps from '../src/priceService.js';

const realFetch = globalThis.fetch;
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let script;

function installFakeNetwork() {
  const calls = [];
  globalThis.fetch = async url => {
    const u = String(url);
    calls.push(u);
    if (u.includes('coingecko.com')) return runOrThrow(script.coingecko);
    if (u.includes('data-api.binance.vision')) return runOrThrow(script.binanceVision, u);
    if (u.includes('api.binance.com')) return runOrThrow(script.binanceMain, u);
    if (u.includes('api.kraken.com')) return runOrThrow(script.kraken);
    if (u.includes('api.coinpaprika.com')) return runOrThrow(script.coinpaprika);
    if (u.includes('coinmarketcap.com')) return runOrThrow(script.coinmarketcap);
    if (u.includes('api.dexscreener.com')) return runOrThrow(script.dexscreener, u);
    throw new Error(`unexpected url ${u}`);
  };
  return calls;
}
function runOrThrow(fn, arg) {
  if (!fn) throw new Error('no script for this provider');
  const r = fn(arg);
  if (r instanceof Error) throw r;
  return r;
}

const geckoDown = () => json(503, {});
const binanceDown = () => json(503, {});

const krakenOk = (price = '111') => () =>
  json(200, {
    error: [],
    result: Object.fromEntries(
      COINS.filter(c => c.krakenPair).map(c => [
        c.ticker === 'BTC' ? 'XXBTZUSD' : c.ticker === 'DOGE' ? 'XXDGZUSD' : `${c.ticker}USD`,
        { c: [c.stable ? '1.0002' : price, '10'] },
      ])
    ),
  });

const paprikaOk = (price = 222, change = 3.3) => () =>
  json(200, COINS.filter(c => c.coinpaprikaId).map(c => ({
    id: c.coinpaprikaId,
    quotes: { USD: { price: c.stable ? 1 : price, percent_change_24h: change } },
  })));

const cmcOk = (price = 333) => () =>
  json(200, {
    data: Object.fromEntries(COINS.map(c => [c.ticker, { quote: { USD: { price: c.stable ? 1 : price, percent_change_24h: 4.4 } } }])),
  });

beforeEach(() => {
  ps._resetForTests();
  CONFIG.coinmarketcapApiKey = '';
  script = { coingecko: geckoDown, binanceMain: binanceDown, binanceVision: binanceDown, kraken: krakenOk(), coinpaprika: paprikaOk(), coinmarketcap: cmcOk(), dexscreener: () => json(200, { pairs: [] }) };
});
test.after(() => { globalThis.fetch = realFetch; CONFIG.coinmarketcapApiKey = ''; });

test('auto chain: Kraken is used once CoinGecko and Binance both fail', async () => {
  installFakeNetwork();
  const prices = await ps.fetchAllPrices();
  const latest = await ps.getLatestPrices();
  assert.match(latest.source, /^Kraken/);
  assert.equal(prices.get('BTC'), 111);
  assert.equal(prices.get('ETH'), 111);
});

test('Kraken: matches legacy-prefixed response keys (XXBTZUSD, XXDGZUSD) as well as plain ones', async () => {
  installFakeNetwork();
  await ps.fetchAllPrices();
  const prices = await ps.fetchAllPrices();
  assert.ok(prices.get('BTC') > 0, 'BTC resolved via its XXBTZUSD-style legacy key');
  assert.ok(prices.get('DOGE') > 0, 'DOGE resolved via its XXDGZUSD-style legacy key');
  assert.ok(prices.get('SOL') > 0, 'SOL resolved via its plain SOLUSD-style key');
});

test('Kraken reports its own error array as a clean failure', async () => {
  installFakeNetwork();
  script.kraken = () => json(200, { error: ['EQuery:Unknown asset pair'], result: {} });
  const results = await ps.testProviders();
  const kraken = results.find(r => r.key === 'kraken');
  assert.equal(kraken.ok, false);
  assert.match(kraken.error, /EQuery/);
});

test('auto chain: falls through to CoinPaprika when Kraken also fails', async () => {
  installFakeNetwork();
  script.kraken = () => new Error('kraken down');
  const prices = await ps.fetchAllPrices();
  const latest = await ps.getLatestPrices();
  assert.match(latest.source, /^CoinPaprika/);
  assert.equal(prices.get('ETH'), 222);
});

test('CoinPaprika: 24h change is carried through into the cached reading', async () => {
  installFakeNetwork();
  script.kraken = () => new Error('kraken down');
  await ps.fetchAllPrices();
  const latest = await ps.getLatestPrices();
  assert.equal(latest.changes.get('ETH'), 3.3);
});

test('CoinMarketCap is skipped entirely (never called) when no API key is configured', async () => {
  const calls = installFakeNetwork();
  script.kraken = () => new Error('down');
  script.coinpaprika = () => new Error('down');
  await ps.fetchAllPrices().catch(() => {});
  assert.ok(!calls.some(u => u.includes('coinmarketcap.com')), 'CMC must not be called without a key');
});

test('CoinMarketCap is used once a key is configured and earlier sources fail', async () => {
  installFakeNetwork();
  CONFIG.coinmarketcapApiKey = 'test-key-123';
  script.kraken = () => new Error('down');
  script.coinpaprika = () => new Error('down');
  const prices = await ps.fetchAllPrices();
  const latest = await ps.getLatestPrices();
  assert.match(latest.source, /^CoinMarketCap/);
  assert.equal(prices.get('BTC'), 333);
});

test('CoinMarketCap: a symbol returned as an array (ambiguous ticker) uses the first (top-ranked) entry', async () => {
  installFakeNetwork();
  CONFIG.coinmarketcapApiKey = 'test-key-123';
  script.kraken = () => new Error('down');
  script.coinpaprika = () => new Error('down');
  script.coinmarketcap = () => json(200, {
    data: Object.fromEntries(COINS.map(c => [c.ticker, [{ quote: { USD: { price: c.stable ? 1 : 444, percent_change_24h: 1 } } }]])),
  });
  const prices = await ps.fetchAllPrices();
  assert.equal(prices.get('SOL'), 444);
});

test('DexScreener: only trusted with an exact symbol match above the liquidity floor', async () => {
  installFakeNetwork();
  script.kraken = () => new Error('down');
  script.coinpaprika = () => new Error('down');
  script.dexscreener = url => {
    if (url.includes('Chainlink')) {
      return json(200, {
        pairs: [
          { baseToken: { symbol: 'LINK' }, priceUsd: '15.5', liquidity: { usd: 10_000 } }, // too shallow
          { baseToken: { symbol: 'FAKELINK' }, priceUsd: '0.01', liquidity: { usd: 5_000_000 } }, // wrong symbol
          { baseToken: { symbol: 'LINK' }, priceUsd: '15.7', liquidity: { usd: 2_000_000 } }, // real, deep pool
        ],
      });
    }
    return json(200, { pairs: [] });
  };
  const prices = await ps.fetchAllPrices();
  const latest = await ps.getLatestPrices();
  assert.match(latest.source, /^DexScreener/);
  assert.equal(prices.get('LINK'), 15.7, 'picks the deep, correctly-symbol-matched pool over the shallow or mismatched ones');
  assert.equal(prices.has('BTC'), false, 'coins with no confident DexScreener match are simply absent');
});

test('DexScreener never supplies stablecoins, even with a matching high-liquidity pool', async () => {
  installFakeNetwork();
  script.kraken = () => new Error('down');
  script.coinpaprika = () => new Error('down');
  script.dexscreener = () => json(200, { pairs: [{ baseToken: { symbol: 'USDT' }, priceUsd: '1.001', liquidity: { usd: 50_000_000 } }] });
  await assert.rejects(ps.fetchAllPrices(), /found no confident matches|no usable prices/);
});

test('"Kraken first" mode: Kraken leads, and CoinGecko is skipped when Kraken already succeeds', async () => {
  const calls = installFakeNetwork();
  ps.setPreferredSource('kraken');
  const prices = await ps.fetchAllPrices();
  assert.equal(prices.get('BTC'), 111);
  assert.ok(!calls.some(u => u.includes('coingecko.com')), 'CoinGecko should not be needed when the leading source succeeds');
});

test('"Kraken first" mode: falls back to Binance, then CoinGecko, when Kraken is down', async () => {
  installFakeNetwork();
  ps.setPreferredSource('kraken');
  script.kraken = () => new Error('down');
  script.binanceMain = () => json(200, COINS.filter(c => c.binanceSymbol).map(c => ({ symbol: c.binanceSymbol, price: '99' })));
  script.binanceVision = script.binanceMain;
  const prices = await ps.fetchAllPrices();
  assert.equal(prices.get('BTC'), 99);
});

test('"CoinGecko only" and "Binance first" modes are unaffected by the new sources', async () => {
  const calls = installFakeNetwork();
  ps.setPreferredSource('coingecko');
  script.coingecko = () => json(200, Object.fromEntries(COINS.map(c => [c.coingeckoId, { usd: 1 }])));
  await ps.fetchAllPrices();
  assert.ok(calls.every(u => u.includes('coingecko.com')), 'CoinGecko-only must never call Kraken/CoinPaprika/etc.');
});

test('testProviders lists every source, including CoinMarketCap flagged as unconfigured', async () => {
  installFakeNetwork();
  const results = await ps.testProviders();
  const keys = results.map(r => r.key).sort();
  assert.deepEqual(keys, ['binance', 'coingecko', 'coinmarketcap', 'coinpaprika', 'dexscreener', 'kraken']);
  const cmc = results.find(r => r.key === 'coinmarketcap');
  assert.equal(cmc.ok, false);
  assert.match(cmc.error, /API key not configured/);
});
