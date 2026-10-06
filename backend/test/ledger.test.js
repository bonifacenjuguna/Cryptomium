import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positions, valued, fromLegacy, sanitize, emptyState, addSnapshot, toCsv, fromCsv, cleanTx, newFolio } from '../../frontend/src/js/ledger.js';

const D = s => Date.parse(s);
const tx = (t, ticker, amount, price, ts, fee = 0) => cleanTx({ t, ticker, amount, price, fee, ts: D(ts) });

test('average cost, partial sale and realized profit', () => {
  const list = [tx('buy', 'BTC', 1, 100, '2026-01-01'), tx('buy', 'BTC', 1, 200, '2026-02-01'), tx('sell', 'BTC', 1, 300, '2026-03-01')];
  const p = positions(list).get('BTC');
  assert.equal(p.amount, 1);
  assert.equal(p.cost, 150);       // average cost 150 stays on the coin still held
  assert.equal(p.realized, 150);   // sold at 300 against 150
});

test('fees raise cost and lower realized profit', () => {
  const list = [tx('buy', 'ETH', 2, 100, '2026-01-01', 10), tx('sell', 'ETH', 2, 150, '2026-02-01', 5)];
  const p = positions(list).get('ETH');
  assert.equal(p.amount, 0);
  assert.equal(p.realized, 300 - 5 - 210);
});

test('coins without a price never distort profit', () => {
  const list = [tx('buy', 'SOL', 4, null, '2026-01-01'), tx('buy', 'SOL', 4, 50, '2026-01-02')];
  const [row] = valued(positions(list), () => 100);
  assert.equal(row.p.amount, 8);
  assert.equal(row.value, 800);
  assert.equal(row.pl, 400 - 200); // only the 4 priced coins: worth 400, paid 200
});

test('selling more than held is capped and flagged', () => {
  const p = positions([tx('buy', 'XRP', 10, 1, '2026-01-01'), tx('sell', 'XRP', 15, 2, '2026-01-02')]).get('XRP');
  assert.equal(p.amount, 0);
  assert.equal(p.oversold, true);
});

test('order of entry does not matter, date does', () => {
  const a = tx('sell', 'BTC', 1, 300, '2026-03-01'), b = tx('buy', 'BTC', 1, 100, '2026-01-01');
  assert.equal(positions([a, b]).get('BTC').realized, 200);
});

test('legacy holdings become opening buys', () => {
  const s = fromLegacy([{ ticker: 'BTC', amount: 2, cost: 200, costAmt: 1 }, { ticker: 'ETH', amount: 5 }, { ticker: 'X', amount: 0 }]);
  const pos = positions(s.folios[0].tx);
  assert.equal(pos.get('BTC').amount, 2);
  assert.equal(pos.get('BTC').pricedAmt, 1);
  assert.equal(pos.get('BTC').cost, 200);
  assert.equal(pos.get('ETH').amount, 5);
  assert.equal(pos.has('X'), false);
});

test('sanitize repairs bad state', () => {
  assert.equal(sanitize(null).folios.length, 1);
  const s = sanitize({ v: 2, active: 'nope', folios: [{ id: 'a', name: '  ', tx: [{ t: 'buy', ticker: 'btc', amount: 1 }, { t: 'x' }, null] }] });
  assert.equal(s.active, 'a');
  assert.equal(s.folios[0].name, 'Main');
  assert.equal(s.folios[0].tx.length, 1);
  assert.equal(s.folios[0].tx[0].ticker, 'BTC');
  assert.equal(sanitize({ v: 2, folios: [{ id: 'a', tx: [{ t: 'buy', ticker: 'BTC', amount: 1 }] }] }, new Set(['ETH'])).folios[0].tx.length, 0);
});

test('snapshots: one reading per window, newest kept, capped', () => {
  let l = [];
  const H = 3600e3;
  l = addSnapshot(l, 0, 100);
  l = addSnapshot(l, 1 * H, 110);
  assert.deepEqual(l, [[0, 110]]);
  l = addSnapshot(l, 4 * H, 120);
  assert.equal(l.length, 2);
  for (let i = 0; i < 600; i++) l = addSnapshot(l, (10 + i * 4) * H, 100 + i, 50);
  assert.equal(l.length, 50);
  assert.equal(l[0][0], 0);
  assert.equal(l.at(-1)[1], 699);
  assert.deepEqual(addSnapshot(l, 1e12, 0), l);
});

test('CSV round trip keeps quotes and commas in notes', () => {
  const f = newFolio('T');
  f.tx.push(tx('buy', 'BTC', 0.5, 20000.25, '2026-01-02'));
  f.tx.push({ ...tx('sell', 'ETH', 3, null, '2026-01-03', 1.5), note: 'said "hi", then left' });
  const csv = toCsv(f);
  const back = fromCsv(csv);
  assert.equal(back.skipped, 0);
  assert.equal(back.tx.length, 2);
  assert.equal(back.tx[1].note, 'said "hi", then left');
  assert.equal(back.tx[0].price, 20000.25);
  assert.equal(back.tx[1].price, null);
  assert.equal(back.tx[1].fee, 1.5);
});

test('CSV skips bad rows and wrong files', () => {
  const r = fromCsv('date,type,ticker,amount\n2026-01-01,buy,BTC,1\nnonsense,buy,BTC,1\n2026-01-01,hold,BTC,1\n2026-01-01,buy,ZZZ,1', new Set(['BTC']));
  assert.equal(r.tx.length, 1);
  assert.equal(r.skipped, 3);
  assert.equal(fromCsv('a,b\n1,2').tx.length, 0);
});

test('emptyState has one folio', () => { assert.equal(emptyState().folios.length, 1); });
