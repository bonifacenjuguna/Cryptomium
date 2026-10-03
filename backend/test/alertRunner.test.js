import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlertRunner } from '../src/alertRunner.js';

const coins = [{ ticker: 'BTC' }, { ticker: 'ETH' }];
const quiet = { log() {}, warn() {}, error() {} };

function setup(over = {}) {
  const saved = [];
  const sent = [];
  const logged = [];
  let clock = 1_000_000;
  const deps = {
    coins,
    getChannelId: async () => '@chan',
    fetchPrices: async () => new Map([['BTC', 100], ['ETH', 50]]),
    getSettings: async () => ({}),
    check: (coin, _s, price) => ({ price, direction: 'up', newLastMilestone: price }),
    saveMilestone: async (t, v) => { saved.push([t, v]); },
    isMuted: () => false,
    sendAlert: async ({ coin }) => { sent.push(coin.ticker); },
    logPost: async p => { logged.push(p.ticker); },
    now: () => clock,
    sleep: async ms => { clock += ms; },
    log: quiet,
    ...over,
  };
  return { run: createAlertRunner(deps), saved, sent, logged, tick: ms => { clock += ms; } };
}

test('a successful alert is sent, saved, then logged', async () => {
  const t = setup();
  const r = await t.run();
  assert.deepEqual(t.sent, ['BTC', 'ETH']);
  assert.deepEqual(t.saved, [['BTC', 100], ['ETH', 50]]);
  assert.deepEqual(t.logged, ['BTC', 'ETH']);
  assert.equal(r.sent, 2);
});

test('a failed send does NOT consume the milestone, and it is retried next tick', async () => {
  let fail = true;
  const t = setup({ sendAlert: async ({ coin }) => { if (fail && coin.ticker === 'BTC') throw new Error('render failed'); t.sent.push(coin.ticker); } });
  const first = await t.run();
  assert.equal(first.failed, 1);
  assert.ok(!t.saved.some(([k]) => k === 'BTC'), 'BTC milestone must stay open');
  assert.ok(t.saved.some(([k]) => k === 'ETH'), 'other coins are unaffected');
  fail = false;
  await t.run();
  assert.ok(t.sent.includes('BTC'));
  assert.ok(t.saved.some(([k]) => k === 'BTC'));
});

test('after maxAttempts failures the alert is dropped so it cannot loop forever', async () => {
  const t = setup({ maxAttempts: 3, sendAlert: async () => { throw new Error('always broken'); } });
  await t.run(); await t.run();
  assert.equal(t.saved.length, 0);
  await t.run();
  assert.deepEqual(t.saved.map(s => s[0]).sort(), ['BTC', 'ETH']);
});

test('a Telegram 429 pauses sending and keeps the alerts for later', async () => {
  const t = setup({ sendAlert: async () => { throw Object.assign(new Error('Too Many Requests'), { parameters: { retry_after: 2 } }); } });
  const r = await t.run();
  assert.equal(r.failed, 0);
  assert.equal(r.deferred, 2);
  assert.equal(t.saved.length, 0);
});

test('alerts are paced postDelayMs apart', async () => {
  const sleeps = [];
  const t = setup({ postDelayMs: 1500, sleep: async ms => { sleeps.push(ms); } });
  await t.run();
  assert.deepEqual(sleeps, [1500]); // between the 1st and 2nd banner only
});

test('overlapping ticks are skipped, not stacked', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const t = setup({ fetchPrices: async () => { await gate; return new Map([['BTC', 100]]); } });
  const slow = t.run();
  const second = await t.run();
  assert.equal(second.skipped, true);
  release();
  const done = await slow;
  assert.equal(done.skipped, false);
  assert.equal(t.sent.length, 1);
});

test('muted coins and a missing channel advance the ladder silently', async () => {
  const muted = setup({ isMuted: () => true });
  await muted.run();
  assert.equal(muted.sent.length, 0);
  assert.equal(muted.saved.length, 2);

  const noChannel = setup({ getChannelId: async () => null });
  await noChannel.run();
  assert.equal(noChannel.sent.length, 0);
  assert.equal(noChannel.saved.length, 2);
});

test('hourly cap holds alerts back without consuming them, and frees up after an hour', async () => {
  // A coin only fires again if its milestone is still open (not saved yet).
  const t = setup({ maxPerHour: 1, check: (coin, _s, price) => (t.saved.some(([k]) => k === coin.ticker) ? null : { price, direction: 'up', newLastMilestone: price }) });
  const first = await t.run();
  assert.equal(first.sent, 1);
  assert.equal(first.deferred, 1);
  assert.ok(!t.saved.some(([k]) => k === 'ETH'));
  t.tick(60 * 60 * 1000 + 1);
  const later = await t.run();
  assert.ok(later.sent >= 1);
  assert.ok(t.sent.includes('ETH'));
});

test('per-coin minimum gap defers a repeat alert', async () => {
  const t = setup({ minGapSeconds: 600 });
  await t.run();
  const again = await t.run();
  assert.equal(again.sent, 0);
  assert.equal(again.deferred, 2);
  t.tick(601_000);
  assert.equal((await t.run()).sent, 2);
});

test('baseline / re-arm results are saved without posting', async () => {
  const t = setup({ check: (_c, _s, price) => ({ price, direction: null, newLastMilestone: price }) });
  await t.run();
  assert.equal(t.sent.length, 0);
  assert.equal(t.saved.length, 2);
});
