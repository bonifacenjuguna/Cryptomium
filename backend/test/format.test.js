import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice } from '../src/priceFormat.js';
import { buildCaption } from '../src/caption.js';

test('formatPrice: dynamic precision', () => {
  assert.equal(formatPrice(86019.4), '$86,019');
  assert.equal(formatPrice(123456), '$123,456');
  assert.equal(formatPrice(4021.45), '$4,021.45');
  assert.equal(formatPrice(610.5), '$610.50');
  assert.equal(formatPrice(150.254), '$150.25');
  assert.equal(formatPrice(12.75), '$12.75');
  assert.equal(formatPrice(2.31), '$2.31');
  assert.equal(formatPrice(0.096), '$0.096');
  assert.equal(formatPrice(0.0958), '$0.096');
  assert.equal(formatPrice(0.235), '$0.235');
  assert.equal(formatPrice(0.00001234), '$0.00001234');
  assert.equal(formatPrice(0.0035), '$0.0035');
  assert.equal(formatPrice(0.005), '$0.0050');
  assert.equal(formatPrice(0.00000012345), '$0.0000001235');
});

test('formatPrice: stablecoins show 3 decimals so a depeg is visible', () => {
  assert.equal(formatPrice(0.994, { stable: true }), '$0.994');
  assert.equal(formatPrice(1.0064, { stable: true }), '$1.006');
  assert.equal(formatPrice(1.0004, { stable: true }), '$1.000');
});

test('rounding across a boundary stays consistent', () => {
  assert.equal(formatPrice(9999.6), '$9,999.60');
  assert.equal(formatPrice(9999.996), '$10,000.00'); // rounds up across the 2-decimal band
  assert.equal(formatPrice(0.9996), '$1.000');
});

test('buildCaption: alert, post-with-change, and post-without-direction', () => {
  const wm = '@cryptomiumx';
  assert.equal(buildCaption({ ticker: 'BTC', price: 81385, direction: 'up' }), `▲ BTC $81,385 ${wm}`);
  assert.equal(buildCaption({ ticker: 'ETH', price: 4021.45, direction: 'down', changePct: -1.234 }), `▼ ETH $4,021.45 · 24h -1.23% ${wm}`);
  assert.equal(buildCaption({ ticker: 'DOGE', price: 0.096, direction: 'up', changePct: 2 }), `▲ DOGE $0.096 · 24h +2.00% ${wm}`);
  assert.equal(buildCaption({ ticker: 'SOL', price: 150.25 }), `SOL $150.25 ${wm}`);
  assert.equal(buildCaption({ ticker: 'USDT', price: 0.994, direction: 'down' }), `▼ USDT $0.994 ${wm}`);
});
