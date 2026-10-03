import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSourceAlerter } from '../src/sourceAlerts.js';
import { ProviderError } from '../src/priceService.js';

function setup() {
  const sent = [];
  let clock = 1_000_000;
  const handle = createSourceAlerter({ send: async t => sent.push(t), now: () => clock, cooldownMs: 60 * 60_000 });
  return { sent, handle, advance: ms => { clock += ms; } };
}
const fallback = (over = {}) => ({ type: 'fallback', primary: 'CoinGecko', used: 'Binance', usedKey: 'binance', error: new ProviderError('x', 429), ...over });

test('fallback message explains the reason and the stablecoin caveat', async () => {
  const { sent, handle } = setup();
  await handle(fallback());
  assert.equal(sent.length, 1);
  assert.match(sent[0], /CoinGecko isn't responding \(rate-limited \(HTTP 429\)\)/);
  assert.match(sent[0], /using Binance as a backup/);
  assert.match(sent[0], /USDT\/USDC depeg checks pause/);
});

test('fallback to CoinGecko (from Binance-first) has no stablecoin caveat', async () => {
  const { sent, handle } = setup();
  await handle(fallback({ primary: 'Binance', used: 'CoinGecko', usedKey: 'coingecko', error: new ProviderError('x', 451) }));
  assert.doesNotMatch(sent[0], /depeg/);
  assert.match(sent[0], /blocked from this server's region/);
});

test('repeat fallbacks within the cooldown are not re-sent; after it they are', async () => {
  const { sent, handle, advance } = setup();
  await handle(fallback());
  await handle({ type: 'recovered', primary: 'CoinGecko' });
  advance(10 * 60_000);
  await handle(fallback());
  assert.equal(sent.length, 2, 'fallback + recovered; second fallback suppressed');
  advance(61 * 60_000);
  await handle(fallback());
  assert.equal(sent.length, 3);
});

test('"recovered" is only sent if the owner was told about the problem', async () => {
  const { sent, handle } = setup();
  await handle({ type: 'recovered', primary: 'CoinGecko' });
  assert.equal(sent.length, 0);
  await handle(fallback());
  await handle({ type: 'recovered', primary: 'CoinGecko' });
  assert.match(sent.at(-1), /✅ CoinGecko is back/);
});

test('outage message', async () => {
  const { sent, handle } = setup();
  await handle({ type: 'outage', primary: 'CoinGecko', error: new Error('network down') });
  assert.match(sent[0], /Every price source is failing \(network down\)/);
});
