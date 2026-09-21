import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestPrice } from '../src/inputParsing.js';

test('parseTestPrice accepts a price with optional direction', () => {
  assert.deepEqual(parseTestPrice('81500'), { price: 81500, direction: null });
  assert.deepEqual(parseTestPrice(' $81,500 '), { price: 81500, direction: null });
  assert.deepEqual(parseTestPrice('0.235 down'), { price: 0.235, direction: 'down' });
  assert.deepEqual(parseTestPrice('12.75 Up'), { price: 12.75, direction: 'up' });
  assert.deepEqual(parseTestPrice('100 rise'), { price: 100, direction: 'up' });
  assert.deepEqual(parseTestPrice('100 fall'), { price: 100, direction: 'down' });
});

test('parseTestPrice rejects junk', () => {
  for (const bad of ['', 'abc', '-5', '0', '12 sideways', '1e5x']) assert.equal(parseTestPrice(bad), null, bad);
});
