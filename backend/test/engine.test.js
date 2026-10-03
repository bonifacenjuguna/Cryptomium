import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinByTicker, MODES } from '../src/config.js';
import { checkMilestone, stepOf, formatStep, previewLevel, nextAlertDistance } from '../src/milestoneEngine.js';

const base = (over = {}) => ({
  threshold: 500, pct_threshold: 0.5, step_unit: 'usd', mode: 'steady', last_milestone: null, ...over,
});
const BTC = coinByTicker('BTC');
const USDT = coinByTicker('USDT');

test('modes are ¼x, ½x, x, 2x with the agreed names', () => {
  assert.deepEqual(MODES.map(m => [m.name, m.multiplier]), [['Hyper', 0.25], ['Fast', 0.5], ['Steady', 1], ['Calm', 2]]);
});

test('effective step = base x mode multiplier, in either unit', () => {
  assert.equal(stepOf(BTC, base({ mode: 'hyper' })).value, 125);
  assert.equal(stepOf(BTC, base({ mode: 'fast' })).value, 250);
  assert.equal(stepOf(BTC, base()).value, 500);
  assert.equal(stepOf(BTC, base({ mode: 'calm' })).value, 1000);
  assert.equal(stepOf(BTC, base({ step_unit: 'pct', mode: 'hyper' })).value, 0.125);
  assert.equal(stepOf(BTC, base({ step_unit: 'pct', mode: 'calm' })).value, 1);
});

test('formatStep', () => {
  assert.equal(formatStep('usd', 500), '$500');
  assert.equal(formatStep('usd', 1000), '$1,000');
  assert.equal(formatStep('usd', 0.005), '$0.005');
  assert.equal(formatStep('usd', 0.00025), '$0.00025');
  assert.equal(formatStep('pct', 0.75), '0.75%');
  assert.equal(formatStep('pct', 0.125), '0.125%');
  assert.equal(formatStep('pct', 1), '1%');
});

test('$ ladder: first reading sets a silent baseline', () => {
  const r = checkMilestone(BTC, base(), 81234);
  assert.equal(r.direction, null);
  assert.equal(r.newLastMilestone, 81000);
});

test('$ ladder: crossing up / down and collapsing big jumps', () => {
  assert.deepEqual(checkMilestone(BTC, base({ last_milestone: 81000 }), 81510), { direction: 'up', price: 81500, newLastMilestone: 81500 });
  assert.deepEqual(checkMilestone(BTC, base({ last_milestone: 81000 }), 80490), { direction: 'down', price: 80500, newLastMilestone: 80500 });
  assert.deepEqual(checkMilestone(BTC, base({ last_milestone: 81000 }), 83120), { direction: 'up', price: 83000, newLastMilestone: 83000 });
  assert.equal(checkMilestone(BTC, base({ last_milestone: 81000 }), 81499), null);
});

test('$ ladder honors the mode (Hyper = $125 for BTC)', () => {
  const s = base({ last_milestone: 81000, mode: 'hyper' });
  assert.deepEqual(checkMilestone(BTC, s, 81130), { direction: 'up', price: 81125, newLastMilestone: 81125 });
  assert.equal(checkMilestone(BTC, s, 81100), null);
  const calm = base({ last_milestone: 81000, mode: 'calm' });
  assert.equal(checkMilestone(BTC, calm, 81600), null);
  assert.equal(checkMilestone(BTC, calm, 82000).direction, 'up');
});

test('% steps: baseline, then alert every time price moves that % from the last alert', () => {
  const pct = (over = {}) => base({ step_unit: 'pct', ...over });
  let r = checkMilestone(BTC, pct(), 80000);
  assert.deepEqual(r, { direction: null, price: 80000, newLastMilestone: 80000 });

  assert.equal(checkMilestone(BTC, pct({ last_milestone: 80000 }), 80390), null);   // +0.4875%
  r = checkMilestone(BTC, pct({ last_milestone: 80000 }), 80400);                    // +0.5% exactly
  assert.deepEqual(r, { direction: 'up', price: 80400, newLastMilestone: 80400 });
  r = checkMilestone(BTC, pct({ last_milestone: 80000 }), 79600);                    // -0.5%
  assert.deepEqual(r, { direction: 'down', price: 79600, newLastMilestone: 79600 });
  r = checkMilestone(BTC, pct({ last_milestone: 80000 }), 84000);                    // big jump -> one post
  assert.deepEqual(r, { direction: 'up', price: 84000, newLastMilestone: 84000 });
});

test('% steps honor the mode (Hyper 0.5% -> 0.125%)', () => {
  const s = base({ step_unit: 'pct', mode: 'hyper', last_milestone: 80000 });
  assert.equal(checkMilestone(BTC, s, 80090), null);
  assert.equal(checkMilestone(BTC, s, 80100).direction, 'up');
});

test('stablecoin depeg band: $ step and % step are equivalent, and re-arm', () => {
  const usd = { threshold: 0.005, pct_threshold: 0.5, step_unit: 'usd', mode: 'steady', last_milestone: null };
  const pct = { ...usd, step_unit: 'pct' };
  for (const s of [usd, pct]) {
    assert.equal(checkMilestone(USDT, s, 1.004), null);
    assert.equal(checkMilestone(USDT, s, 0.994).direction, 'down');
    assert.equal(checkMilestone(USDT, s, 1.006).direction, 'up');
    assert.deepEqual(checkMilestone(USDT, { ...s, last_milestone: 0.994 }, 1.0), { direction: null, price: 1.0, newLastMilestone: null });
    assert.equal(checkMilestone(USDT, { ...s, last_milestone: 0.994 }, 0.993), null); // already alerted, not re-armed
  }
});

test('previewLevel: ladder coins round to a level, % / stable show the live price', () => {
  assert.equal(previewLevel(BTC, base(), 81386), 81500);
  assert.equal(previewLevel(BTC, base({ step_unit: 'pct' }), 81386.42), 81386.42);
  assert.equal(previewLevel(USDT, base(), 1.0004), 1.0004);
});

test('nextAlertDistance: no reading yet -> baselining', () => {
  assert.deepEqual(nextAlertDistance(BTC, base(), 81234), { kind: 'baselining' });
});

test('nextAlertDistance: $ ladder is symmetric around the anchor, in dollars', () => {
  const s = base({ last_milestone: 81000 }); // step $500
  assert.deepEqual(nextAlertDistance(BTC, s, 81000), { kind: 'ladder', unit: 'usd', toUp: 500, toDown: 500 });
  assert.deepEqual(nextAlertDistance(BTC, s, 81300), { kind: 'ladder', unit: 'usd', toUp: 200, toDown: 800 });
  assert.deepEqual(nextAlertDistance(BTC, s, 80700), { kind: 'ladder', unit: 'usd', toUp: 800, toDown: 200 });
});

test('nextAlertDistance: $ ladder respects the mode multiplier', () => {
  const s = base({ last_milestone: 81000, mode: 'hyper' }); // step $125
  assert.deepEqual(nextAlertDistance(BTC, s, 81000), { kind: 'ladder', unit: 'usd', toUp: 125, toDown: 125 });
  assert.deepEqual(nextAlertDistance(BTC, s, 81100), { kind: 'ladder', unit: 'usd', toUp: 25, toDown: 225 });
});

test('nextAlertDistance: % steps are symmetric around the anchor, in percent', () => {
  const s = base({ step_unit: 'pct', last_milestone: 80000 }); // step 0.5%
  assert.deepEqual(nextAlertDistance(BTC, s, 80000), { kind: 'pct', unit: 'pct', toUp: 0.5, toDown: 0.5 });
  const near = nextAlertDistance(BTC, s, 80200); // +0.25%
  assert.ok(Math.abs(near.toUp - 0.25) < 1e-9 && Math.abs(near.toDown - 0.75) < 1e-9);
});

function closeTo(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} to be close to ${expected}`);
}

test('nextAlertDistance: stablecoin inside the band', () => {
  const s = { threshold: 0.005, pct_threshold: 0.5, step_unit: 'usd', mode: 'steady', last_milestone: null };
  const atPeg = nextAlertDistance(USDT, s, 1.0);
  assert.equal(atPeg.kind, 'stable-armed');
  closeTo(atPeg.toUp, 0.005);
  closeTo(atPeg.toDown, 0.005);
  const off = nextAlertDistance(USDT, s, 1.002);
  closeTo(off.toUp, 0.003);
  closeTo(off.toDown, 0.007);
});

test('nextAlertDistance: stablecoin already depegged -> distance back inside the band', () => {
  const s = { threshold: 0.005, pct_threshold: 0.5, step_unit: 'usd', mode: 'steady', last_milestone: 1.008 };
  const up = nextAlertDistance(USDT, s, 1.008);
  assert.equal(up.kind, 'stable-outside');
  assert.equal(up.direction, 'up');
  closeTo(up.toReturn, 0.003);
  const s2 = { ...s, last_milestone: 0.992 };
  const down = nextAlertDistance(USDT, s2, 0.992);
  assert.equal(down.kind, 'stable-outside');
  assert.equal(down.direction, 'down');
  closeTo(down.toReturn, 0.003);
});
