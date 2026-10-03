import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { coinByTicker } from '../src/config.js';
import * as ps from '../src/priceService.js';
import { CHART_RANGES, chartRangeByKey, parseCustomDays, fetchChartData } from '../src/chartData.js';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const BTC = coinByTicker('BTC');

beforeEach(() => {
  ps._resetForTests();
});

test('CHART_RANGES / chartRangeByKey', () => {
  assert.deepEqual(CHART_RANGES.map(r => r.key), ['24h', '7d', '30d', '90d', '1y']);
  assert.equal(chartRangeByKey('7d').days, 7);
  assert.equal(chartRangeByKey('nope'), undefined);
});

test('parseCustomDays accepts plain numbers and "N days"/"Nd"', () => {
  assert.equal(parseCustomDays('45'), 45);
  assert.equal(parseCustomDays('45 days'), 45);
  assert.equal(parseCustomDays('45d'), 45);
  assert.equal(parseCustomDays(' 1 '), 1);
  assert.equal(parseCustomDays('365'), 365);
});

test('parseCustomDays rejects out-of-range or junk input', () => {
  for (const bad of ['0', '-5', '366', 'abc', '', '45 weeks']) {
    assert.equal(parseCustomDays(bad), null, bad);
  }
});

test('fetchChartData: candles for a standard range hit the OHLC endpoint', async () => {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return json(200, [
      [1000, 100, 110, 95, 105],
      [2000, 105, 120, 100, 115],
    ]);
  };
  const data = await fetchChartData(BTC, 30, 'candles');
  assert.equal(data.style, 'candles');
  assert.equal(data.points.length, 2);
  assert.deepEqual(data.points[0], { t: 1000, o: 100, h: 110, l: 95, c: 105 });
  assert.ok(calls[0].includes('/coins/bitcoin/ohlc'));
  assert.ok(calls[0].includes('days=30'));
});

test('fetchChartData: candles sorts by time ascending even if the API returns them unordered', async () => {
  globalThis.fetch = async () => json(200, [
    [2000, 105, 120, 100, 115],
    [1000, 100, 110, 95, 105],
  ]);
  const data = await fetchChartData(BTC, 7, 'candles');
  assert.deepEqual(data.points.map(p => p.t), [1000, 2000]);
});

test('fetchChartData: a custom day count (not in CHART_RANGES) always falls back to line, not candles', async () => {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return json(200, { prices: [[1000, 100], [2000, 105]] });
  };
  const data = await fetchChartData(BTC, 45, 'candles'); // 45 isn't one of CoinGecko's OHLC buckets
  assert.equal(data.style, 'line', 'silently downgrades rather than sending an invalid request');
  assert.ok(calls[0].includes('/market_chart'));
  assert.ok(!calls[0].includes('/ohlc'));
});

test('fetchChartData: line style uses market_chart and sorts ascending', async () => {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return json(200, { prices: [[2000, 105], [1000, 100], [3000, 110]] });
  };
  const data = await fetchChartData(BTC, 7, 'line');
  assert.equal(data.style, 'line');
  assert.deepEqual(data.points, [{ t: 1000, price: 100 }, { t: 2000, price: 105 }, { t: 3000, price: 110 }]);
  assert.ok(calls[0].includes('/coins/bitcoin/market_chart'));
});

test('fetchChartData: HTTP failure and empty-data responses both throw a clear error', async () => {
  globalThis.fetch = async () => json(502, {});
  await assert.rejects(fetchChartData(BTC, 7, 'line'), /responded 502/);

  globalThis.fetch = async () => json(200, { prices: [] });
  await assert.rejects(fetchChartData(BTC, 7, 'line'), /No price history/);

  globalThis.fetch = async () => json(200, []);
  await assert.rejects(fetchChartData(BTC, 30, 'candles'), /No candle data/);
});
