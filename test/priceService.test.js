import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { COINS } from '../src/config.js';
import * as ps from '../src/priceService.js';

const realFetch = globalThis.fetch;
const events = [];
let script; // per-test behavior of each provider

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A fake network: CoinGecko and the two Binance hosts, each scriptable.
function installFakeNetwork() {
  const calls = [];
  globalThis.fetch = async url => {
    const u = String(url);
    calls.push(u);
    if (u.includes('coingecko.com')) {
      const r = script.coingecko();
      if (r instanceof Error) throw r;
      return r;
    }
    const host = u.includes('data-api.binance.vision') ? 'binanceVision' : 'binanceMain';
    if (script[host]) {
      const r = script[host](u);
      if (r instanceof Error) throw r;
      return r;
    }
    throw new Error(`unexpected url ${u}`);
  };
  return calls;
}

const geckoOk = (price = 100, change = 1.5) => () =>
  json(200, Object.fromEntries(COINS.map(c => [c.coingeckoId, { usd: c.stable ? 1 : price, usd_24h_change: change }])));
const binanceOk = (price = '99') => u => {
  if (u.includes('symbols=')) {
    const symbols = JSON.parse(decodeURIComponent(u.split('symbols=')[1]));
    return json(200, symbols.map(symbol => ({ symbol, price })));
  }
  return json(200, COINS.filter(c => c.binanceSymbol).map(c => ({ symbol: c.binanceSymbol, price })).concat([{ symbol: 'OTHERUSDT', price: '1' }]));
};

beforeEach(() => {
  ps._resetForTests();
  events.length = 0;
  ps.setSourceListener(e => events.push(e));
  script = { coingecko: geckoOk(), binanceMain: binanceOk(), binanceVision: binanceOk() };
});
test.after(() => { globalThis.fetch = realFetch; });

test('auto: CoinGecko is used when healthy, Binance is never called', async () => {
  const calls = installFakeNetwork();
  const prices = await ps.fetchAllPrices();
  assert.equal(prices.size, COINS.length);
  assert.equal((await ps.getLatestPrices()).source, 'CoinGecko');
  assert.ok(calls.every(u => u.includes('coingecko')));
  assert.equal(ps.getSourceHealth().fallbackActive, false);
});

test('auto: falls back to Binance when CoinGecko is rate-limited; stablecoins are absent', async () => {
  installFakeNetwork();
  script.coingecko = () => json(429, {});
  const prices = await ps.fetchAllPrices();
  const latest = await ps.getLatestPrices();
  assert.equal(latest.source, 'Binance (backup)');
  assert.equal(latest.backup, true);
  assert.equal(prices.has('USDT'), false);
  assert.equal(prices.has('USDC'), false);
  assert.equal(prices.get('BTC'), 99);
  assert.equal(prices.size, COINS.filter(c => !c.stable).length);
});

test('Binance: main host blocked (451) -> the data-api host is used', async () => {
  const calls = installFakeNetwork();
  ps.setPreferredSource('binance');
  script.binanceMain = () => json(451, {});
  await ps.fetchAllPrices();
  assert.ok(calls.some(u => u.includes('api.binance.com')));
  assert.ok(calls.some(u => u.includes('data-api.binance.vision')));
  assert.match((await ps.getLatestPrices()).source, /^Binance/);
});

test('Binance: an unknown symbol (HTTP 400) retries with the full price list', async () => {
  const calls = installFakeNetwork();
  ps.setPreferredSource('binance');
  script.binanceMain = u => (u.includes('symbols=') ? json(400, { msg: 'Invalid symbol' }) : binanceOk()(u));
  const prices = await ps.fetchAllPrices();
  assert.equal(prices.get('ETH'), 99);
  assert.ok(calls.some(u => u.endsWith('/api/v3/ticker/price')));
});

test('"Binance first": Binance leads, and stablecoins are filled in from CoinGecko', async () => {
  installFakeNetwork();
  ps.setPreferredSource('binance');
  const prices = await ps.fetchAllPrices();
  const latest = await ps.getLatestPrices();
  assert.equal(prices.get('BTC'), 99, 'crypto coins come from Binance');
  assert.equal(prices.get('USDT'), 1, 'stablecoins come from CoinGecko');
  assert.equal(prices.size, COINS.length);
  assert.equal(latest.source, 'Binance + CoinGecko');
  assert.equal(latest.backup, false);
});

test('"Binance first": if Binance fails, CoinGecko is the backup', async () => {
  installFakeNetwork();
  ps.setPreferredSource('binance');
  script.binanceMain = () => new Error('boom');
  script.binanceVision = () => new Error('boom');
  await ps.fetchAllPrices();
  assert.equal((await ps.getLatestPrices()).source, 'CoinGecko (backup)');
});

test('"CoinGecko only": never touches Binance, and throws if CoinGecko is down', async () => {
  const calls = installFakeNetwork();
  ps.setPreferredSource('coingecko');
  script.coingecko = () => json(500, {});
  await assert.rejects(ps.fetchAllPrices(), /500/);
  assert.ok(calls.every(u => u.includes('coingecko')));
});

test('both sources down: throws, and only announces an outage after 3 failures in a row', async () => {
  installFakeNetwork();
  script.coingecko = () => json(503, {});
  script.binanceMain = () => json(503, {});
  script.binanceVision = () => json(503, {});
  for (let i = 0; i < 2; i++) await assert.rejects(ps.fetchAllPrices());
  assert.equal(events.length, 0);
  await assert.rejects(ps.fetchAllPrices());
  assert.deepEqual(events.map(e => e.type), ['outage']);
  await assert.rejects(ps.fetchAllPrices());
  assert.equal(events.length, 1, 'no repeat announcement');
});

test('health: fallback is announced after 2 failed readings, recovery after 3 good ones', async () => {
  installFakeNetwork();
  script.coingecko = () => json(429, {});
  await ps.fetchAllPrices();
  assert.equal(events.length, 0, 'one blip is not announced');
  await ps.fetchAllPrices();
  assert.deepEqual(events.map(e => e.type), ['fallback']);
  assert.equal(events[0].primary, 'CoinGecko');
  assert.equal(events[0].used, 'Binance');
  assert.equal(ps.getSourceHealth().fallbackActive, true);

  script.coingecko = geckoOk();
  await ps.fetchAllPrices();
  await ps.fetchAllPrices();
  assert.equal(events.length, 1);
  await ps.fetchAllPrices();
  assert.deepEqual(events.map(e => e.type), ['fallback', 'recovered']);
  assert.equal(ps.getSourceHealth().fallbackActive, false);
});

test('getChanges24h returns CoinGecko 24h changes; testProviders reports each source', async () => {
  installFakeNetwork();
  await ps.fetchAllPrices();
  assert.equal((await ps.getChanges24h()).get('BTC'), 1.5);

  script.binanceMain = () => json(451, {});
  script.binanceVision = () => json(451, {});
  const results = await ps.testProviders();
  const gecko = results.find(r => r.key === 'coingecko');
  const binance = results.find(r => r.key === 'binance');
  assert.equal(gecko.ok, true);
  assert.equal(gecko.count, COINS.length);
  assert.equal(binance.ok, false);
  assert.match(binance.error, /blocked/);
});

test('changing the mode resets health so old failures do not carry over', async () => {
  installFakeNetwork();
  script.coingecko = () => json(429, {});
  await ps.fetchAllPrices();
  await ps.fetchAllPrices();
  assert.equal(ps.getSourceHealth().fallbackActive, true);
  ps.setPreferredSource('binance');
  assert.equal(ps.getSourceHealth().fallbackActive, false);
});

test('a malformed provider response is a clean provider failure, not a crash', async () => {
  installFakeNetwork();
  script.coingecko = () => json(200, null);
  ps.setPreferredSource('binance');
  script.binanceMain = () => json(200, { code: -1, msg: 'weird' });
  script.binanceVision = () => json(200, { code: -1, msg: 'weird' });
  // Binance is unusable, so CoinGecko's (null) answer is the last resort and must also fail cleanly.
  await assert.rejects(ps.fetchAllPrices(), /unexpected response/);
});

test('Binance attempts are recorded per host, for the Test sources screen', async () => {
  installFakeNetwork();
  script.binanceMain = () => json(451, {});
  const results = await ps.testProviders();
  const binance = results.find(r => r.key === 'binance');
  assert.equal(binance.ok, true, 'data-api host rescues it');
  assert.deepEqual(binance.attempts.map(a => a.ok), [false, true]);
  assert.match(binance.attempts[0].reason, /blocked from this server's region/);
});

test('when every Binance host fails, testProviders reports both attempts', async () => {
  installFakeNetwork();
  script.binanceMain = () => json(451, {});
  script.binanceVision = () => json(451, {});
  const results = await ps.testProviders();
  const binance = results.find(r => r.key === 'binance');
  assert.equal(binance.ok, false);
  assert.equal(binance.attempts.length, 2);
  assert.ok(binance.attempts.every(a => !a.ok));
});
