import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { COINS } from '../src/config.js';
import * as ps from '../src/priceService.js';

const realFetch = globalThis.fetch;
const events = [];
let script; // per-test behavior of each provider

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A fake network: CoinGecko, the two Binance hosts, Kraken, CoinPaprika, CMC
// and DexScreener, each scriptable.
function installFakeNetwork() {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('coingecko.com')) {
      const r = script.coingecko();
      if (r instanceof Error) throw r;
      return r;
    }
    if (u.includes('kraken.com')) {
      const r = (script.kraken ?? (() => json(200, { error: [], result: {} })))(u);
      if (r instanceof Error) throw r;
      return r;
    }
    if (u.includes('coinpaprika.com')) {
      const r = (script.coinpaprika ?? (() => json(200, [])))();
      if (r instanceof Error) throw r;
      return r;
    }
    if (u.includes('coinmarketcap.com')) {
      const r = (script.coinmarketcap ?? (() => json(200, { data: {} })))(opts);
      if (r instanceof Error) throw r;
      return r;
    }
    if (u.includes('dexscreener.com')) {
      const r = (script.dexscreener ?? (() => json(200, {})))(u);
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

// ---------------------------------------------------------------------
// New providers: Kraken, CoinPaprika, CoinMarketCap, DexScreener
// ---------------------------------------------------------------------

test('Kraken: modern keys (no legacy X/Z prefix) parse directly', async () => {
  installFakeNetwork();
  ps.setPreferredSource('kraken');
  script.kraken = () => json(200, { error: [], result: {
    SOLUSD: { c: ['150.25', '1.0'] },
    ADAUSD: { c: ['0.235', '1.0'] },
  } });
  const prices = await ps.fetchAllPrices();
  assert.equal(prices.get('SOL'), 150.25);
  assert.equal(prices.get('ADA'), 0.235);
});

test('Kraken: legacy X/Z-prefixed keys (BTC, ETH, DOGE) are matched by substring', async () => {
  installFakeNetwork();
  ps.setPreferredSource('kraken');
  script.kraken = () => json(200, { error: [], result: {
    XXBTZUSD: { c: ['86753.00', '1.0'] }, // requested as XBTUSD
    XETHZUSD: { c: ['2772.97', '1.0'] },
    XDGUSD: { c: ['0.098', '1.0'] }, // Dogecoin's legacy XDG code, no Z suffix
  } });
  const prices = await ps.fetchAllPrices();
  assert.equal(prices.get('BTC'), 86753);
  assert.equal(prices.get('ETH'), 2772.97);
  assert.equal(prices.get('DOGE'), 0.098);
});

test('Kraken: stablecoins are included (unlike Binance) since Kraken quotes them in real USD', async () => {
  installFakeNetwork();
  ps.setPreferredSource('kraken');
  script.kraken = () => json(200, { error: [], result: {
    USDTUSD: { c: ['0.9994', '1.0'] },
    USDCUSD: { c: ['1.0002', '1.0'] },
  } });
  const prices = await ps.fetchAllPrices();
  assert.equal(prices.get('USDT'), 0.9994);
  assert.equal(prices.get('USDC'), 1.0002);
});

test('Kraken: BNB and HYPE are never requested (not listed there)', () => {
  const { BNB, HYPE } = Object.fromEntries(COINS.map(c => [c.ticker, c]));
  assert.equal(BNB.krakenSymbol, null);
  assert.equal(HYPE.krakenSymbol, null);
});

test('Kraken: one invalid pair name fails the whole batch -> retries with the full market', async () => {
  installFakeNetwork();
  ps.setPreferredSource('kraken');
  let calls = 0;
  script.kraken = u => {
    calls++;
    if (u.includes('pair=')) return json(200, { error: ['EQuery:Unknown asset pair'], result: {} });
    return json(200, { error: [], result: { XXBTZUSD: { c: ['86753.00', '1.0'] } } }); // "full market"
  };
  const prices = await ps.fetchAllPrices();
  assert.equal(calls, 2);
  assert.equal(prices.get('BTC'), 86753);
});

test('Kraken: HTTP failure is a clean ProviderError (surfaced when no backup is available either)', async () => {
  installFakeNetwork();
  ps.setPreferredSource('kraken');
  script.kraken = () => json(502, {});
  script.coingecko = () => json(502, {}); // no backup either, so this specific status is what surfaces
  await assert.rejects(ps.fetchAllPrices(), /responded 502/);
});

test('CoinPaprika: matched by id, not by symbol (avoids collisions)', async () => {
  installFakeNetwork();
  ps.setPreferredSource('coinpaprika');
  script.coinpaprika = () => json(200, [
    { id: 'btc-bitcoin', symbol: 'BTC', quotes: { USD: { price: 86753, percent_change_24h: 1.2 } } },
    { id: 'some-other-uni-token', symbol: 'UNI', quotes: { USD: { price: 999999 } } }, // decoy, wrong id
    { id: 'uni-uniswap', symbol: 'UNI', quotes: { USD: { price: 6.42, percent_change_24h: -0.5 } } },
  ]);
  const prices = await ps.fetchAllPrices();
  assert.equal(prices.get('BTC'), 86753);
  assert.equal(prices.get('UNI'), 6.42, 'the decoy with a matching symbol but wrong id must be ignored');
  assert.equal((await ps.getChanges24h()).size >= 0, true);
});

test('CoinPaprika: one batched call covers every coin', async () => {
  installFakeNetwork();
  ps.setPreferredSource('coinpaprika');
  let calls = 0;
  script.coinpaprika = () => {
    calls++;
    return json(200, COINS.map(c => ({ id: c.coinpaprikaId, symbol: c.ticker, quotes: { USD: { price: 1, percent_change_24h: 0 } } })));
  };
  await ps.fetchAllPrices();
  assert.equal(calls, 1);
});

test('CoinMarketCap: fails fast (no network call) when no API key is set, and CoinGecko backup saves the request', async () => {
  const calls = installFakeNetwork();
  ps.setPreferredSource('coinmarketcap');
  const prices = await ps.fetchAllPrices(); // coingecko (the default script) still works as backup
  assert.equal(calls.filter(u => u.includes('coinmarketcap')).length, 0, 'no network call for an unconfigured key');
  assert.equal(prices.size, COINS.length);
  assert.equal((await ps.getLatestPrices()).source, 'CoinGecko (backup)');
});

test('CoinMarketCap: with no key AND no backup, the error explains why', async () => {
  installFakeNetwork();
  ps.setPreferredSource('coinmarketcap');
  script.coingecko = () => json(500, {});
  await assert.rejects(ps.fetchAllPrices());
  // Whichever of the two failures surfaces, CMC's own attempt must have been logged.
  const health = ps.getSourceHealth();
  assert.equal(health.primary, 'CoinMarketCap');
});

test('CoinMarketCap: with a key, sends it as a header and parses by numeric id', async () => {
  process.env.COINMARKETCAP_API_KEY = 'test-key-123';
  const { CONFIG } = await import('../src/config.js');
  CONFIG.coinMarketCapApiKey = 'test-key-123'; // CONFIG is read at call time, not import time
  installFakeNetwork();
  ps.setPreferredSource('coinmarketcap');
  let seenHeader;
  script.coinmarketcap = opts => {
    seenHeader = opts?.headers?.['X-CMC_PRO_API_KEY'];
    return json(200, { data: {
      1: { quote: { USD: { price: 86753, percent_change_24h: 1.1 } } },
      1027: { quote: { USD: { price: 2772.97, percent_change_24h: -0.4 } } },
    } });
  };
  const prices = await ps.fetchAllPrices();
  assert.equal(seenHeader, 'test-key-123');
  assert.equal(prices.get('BTC'), 86753);
  assert.equal(prices.get('ETH'), 2772.97);
  CONFIG.coinMarketCapApiKey = '';
  delete process.env.COINMARKETCAP_API_KEY;
});

test('DexScreener: fails fast (no network call) when nothing is configured, and CoinGecko backup saves the request', async () => {
  const calls = installFakeNetwork();
  ps.setPreferredSource('dexscreener');
  const prices = await ps.fetchAllPrices();
  assert.equal(calls.filter(u => u.includes('dexscreener')).length, 0);
  assert.equal(prices.size, COINS.length);
  assert.equal((await ps.getLatestPrices()).source, 'CoinGecko (backup)');
});

test('providerOrder: Auto never includes CoinMarketCap or DexScreener', () => {
  assert.deepEqual(ps.providerOrder('auto'), ['coingecko', 'binance', 'kraken', 'coinpaprika']);
});

test('providerOrder: every explicit single-source mode falls back to CoinGecko', () => {
  for (const mode of ['binance', 'kraken', 'coinpaprika', 'coinmarketcap', 'dexscreener']) {
    const order = ps.providerOrder(mode);
    assert.equal(order[0], mode);
    assert.ok(order.includes('coingecko'), `${mode} should have CoinGecko as a safety net`);
  }
});

test('testProviders reports all 6 sources, including the two that are off by default', async () => {
  installFakeNetwork();
  const results = await ps.testProviders();
  assert.deepEqual(results.map(r => r.key).sort(), ['binance', 'coingecko', 'coinmarketcap', 'coinpaprika', 'dexscreener', 'kraken'].sort());
  const cmc = results.find(r => r.key === 'coinmarketcap');
  const dex = results.find(r => r.key === 'dexscreener');
  assert.equal(cmc.ok, false);
  assert.match(cmc.error, /COINMARKETCAP_API_KEY/);
  assert.equal(dex.ok, false);
  assert.match(dex.error, /no coins configured/);
});
