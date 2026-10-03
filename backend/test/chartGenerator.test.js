import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChartImage } from '../src/chartGenerator.js';

function linePoints(n = 50, start = 86000) {
  const now = Date.now();
  let price = start;
  return Array.from({ length: n }, (_, i) => {
    price *= 1 + (((i * 37) % 11) - 5) / 1000; // deterministic wobble, no RNG
    return { t: now - (n - i) * 3_600_000, price };
  });
}
function candlePoints(n = 30, start = 86000) {
  const now = Date.now();
  let price = start;
  return Array.from({ length: n }, (_, i) => {
    const o = price;
    price *= 1 + (((i * 53) % 13) - 6) / 500;
    const c = price;
    return { t: now - (n - i) * 14_400_000, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c };
  });
}

test('generateChartImage: line style produces a valid, sized PNG', async () => {
  const buf = await generateChartImage({ ticker: 'BTC', style: 'line', days: 7, rangeLabel: '7D', points: linePoints() });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 5000, 'not a suspiciously tiny/blank image');
  assert.equal(buf[0], 0x89); // PNG magic byte
});

test('generateChartImage: candlestick style produces a valid PNG', async () => {
  const buf = await generateChartImage({ ticker: 'ETH', style: 'candles', days: 30, rangeLabel: '30D', points: candlePoints() });
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf[0], 0x89);
});

test('generateChartImage: a single data point does not crash (degenerate range)', async () => {
  const buf = await generateChartImage({ ticker: 'BTC', style: 'line', days: 1, rangeLabel: '24H', points: [{ t: Date.now(), price: 86000 }] });
  assert.ok(Buffer.isBuffer(buf));
});

test('generateChartImage: a perfectly flat price series does not crash (zero range)', async () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ t: Date.now() - i * 1000, price: 1.0 }));
  const buf = await generateChartImage({ ticker: 'USDT', style: 'line', days: 1, rangeLabel: '24H', points });
  assert.ok(Buffer.isBuffer(buf));
});

test('generateChartImage: very small prices (sub-cent) still render (DOGE-style axis labels)', async () => {
  const buf = await generateChartImage({ ticker: 'DOGE', style: 'line', days: 1, rangeLabel: '24H', points: linePoints(50, 0.098) });
  assert.ok(Buffer.isBuffer(buf));
});

test('generateChartImage: a single candle does not crash', async () => {
  const buf = await generateChartImage({
    ticker: 'BTC', style: 'candles', days: 1, rangeLabel: '24H',
    points: [{ t: Date.now(), o: 86000, h: 86500, l: 85800, c: 86200 }],
  });
  assert.ok(Buffer.isBuffer(buf));
});
