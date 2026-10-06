// Portfolio ledger: pure logic, no page or storage code, so it can be tested on its own.
// Everything is in US dollars (the site converts for display). Cost method: average cost.
//
// A folio is { id, name, goal, tx: [{ id, t: 'buy' | 'sell', ticker, amount, price, fee, ts, note }] }.
// `price` is dollars per coin and may be null when unknown (such coins count in the amount but not in profit and loss).

export const LIMITS = { folios: 8, tx: 2000, name: 24, note: 80 };

const uid = () => Math.random().toString(36).slice(2, 10);
const num = v => (typeof v === 'number' ? v : Number(v));
const good = v => Number.isFinite(v) && v > 0;

export function newFolio(name = 'Main') {
  return { id: uid(), name: String(name).trim().slice(0, LIMITS.name) || 'Main', goal: null, tx: [] };
}

export function emptyState() {
  const f = newFolio('Main');
  return { v: 2, active: f.id, hide: false, folios: [f] };
}

/** Clean one transaction. Returns null when it cannot be trusted. */
export function cleanTx(x, tickers = null) {
  if (!x || (x.t !== 'buy' && x.t !== 'sell')) return null;
  const ticker = String(x.ticker || '').toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(ticker) || (tickers && !tickers.has(ticker))) return null;
  const amount = num(x.amount);
  if (!good(amount)) return null;
  const price = x.price == null || x.price === '' ? null : num(x.price);
  const fee = x.fee == null || x.fee === '' ? 0 : num(x.fee);
  const ts = num(x.ts);
  return {
    id: String(x.id || uid()).slice(0, 20),
    t: x.t,
    ticker,
    amount,
    price: price != null && price >= 0 && Number.isFinite(price) ? price : null,
    fee: Number.isFinite(fee) && fee > 0 ? fee : 0,
    ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    note: String(x.note || '').slice(0, LIMITS.note),
  };
}

/** Make any stored state safe to use; fall back to a fresh one. */
export function sanitize(state, tickers = null) {
  if (!state || state.v !== 2 || !Array.isArray(state.folios) || !state.folios.length) return emptyState();
  const seen = new Set();
  const folios = state.folios.slice(0, LIMITS.folios).map(f => {
    let id = String(f?.id || uid()).slice(0, 20);
    while (seen.has(id)) id = uid();
    seen.add(id);
    const goal = num(f?.goal);
    return {
      id,
      name: String(f?.name || 'Main').trim().slice(0, LIMITS.name) || 'Main',
      goal: good(goal) ? goal : null,
      tx: (Array.isArray(f?.tx) ? f.tx : []).map(x => cleanTx(x, tickers)).filter(Boolean).slice(0, LIMITS.tx),
    };
  });
  const active = folios.some(f => f.id === state.active) ? state.active : folios[0].id;
  return { v: 2, active, hide: Boolean(state.hide), folios };
}

/** Holdings saved by 3.3.x and earlier ({ ticker, amount, cost?, costAmt? }) become opening buys. */
export function fromLegacy(list, tickers = null, now = Date.now()) {
  const f = newFolio('Main');
  for (const h of Array.isArray(list) ? list : []) {
    const amount = num(h?.amount);
    if (!good(amount)) continue;
    const costAmt = good(num(h.costAmt)) ? Math.min(num(h.costAmt), amount) : amount;
    const cost = num(h.cost);
    const priced = good(cost) && costAmt > 0;
    const unpriced = amount - (priced ? costAmt : 0);
    if (priced) {
      const t = cleanTx({ t: 'buy', ticker: h.ticker, amount: costAmt, price: cost / costAmt, ts: now, note: 'Opening balance' }, tickers);
      if (t) f.tx.push(t);
    }
    if (unpriced > 1e-12) {
      const t = cleanTx({ t: 'buy', ticker: h.ticker, amount: unpriced, price: null, ts: now, note: priced ? 'Opening balance, price unknown' : 'Opening balance' }, tickers);
      if (t) f.tx.push(t);
    }
  }
  return { v: 2, active: f.id, hide: false, folios: [f] };
}

/**
 * Open positions and realized results for a list of transactions, in time order.
 * Returns Map(ticker -> { ticker, amount, pricedAmt, cost, realized, bought, sold, fees, first, last, oversold }).
 *  - cost: dollars paid for the coins still held (fees included) that have a recorded price
 *  - pricedAmt: how many of the coins held that cost covers
 *  - realized: profit already locked in by sales (after fees), on coins that had a recorded price
 */
export function positions(tx) {
  const out = new Map();
  const ordered = [...tx].sort((a, b) => a.ts - b.ts || (a.t === 'buy' ? -1 : 1));
  for (const x of ordered) {
    let p = out.get(x.ticker);
    if (!p) { p = { ticker: x.ticker, amount: 0, pricedAmt: 0, cost: 0, realized: 0, bought: 0, sold: 0, fees: 0, first: x.ts, last: x.ts, oversold: false }; out.set(x.ticker, p); }
    p.last = x.ts;
    p.fees += x.fee || 0;
    if (x.t === 'buy') {
      p.amount += x.amount;
      p.bought += x.amount;
      if (x.price != null) { p.pricedAmt += x.amount; p.cost += x.amount * x.price + (x.fee || 0); }
    } else {
      const qty = Math.min(x.amount, p.amount);
      if (x.amount > p.amount + 1e-12) p.oversold = true;
      if (qty <= 0) continue;
      const frac = p.amount > 0 ? qty / p.amount : 0;
      const costOut = p.cost * frac;
      const pricedOut = p.pricedAmt * frac;
      if (x.price != null && pricedOut > 0) {
        const feeShare = (x.fee || 0) * (pricedOut / x.amount);
        p.realized += pricedOut * x.price - feeShare - costOut;
      }
      p.cost -= costOut;
      p.pricedAmt -= pricedOut;
      p.amount -= qty;
      p.sold += qty;
      if (p.amount < 1e-12) { p.amount = 0; p.pricedAmt = 0; p.cost = 0; }
    }
  }
  return out;
}

/** Buy more than was held at some point? (a sell larger than the amount owned then) */
export const hasOversell = tx => [...positions(tx).values()].some(p => p.oversold);

/** One-line summary of the open positions, with live prices: [{ p, value, now, pl, plPct }]. */
export function valued(posMap, price) {
  return [...posMap.values()].filter(p => p.amount > 0).map(p => {
    const px = price(p.ticker);
    const value = px != null ? px * p.amount : null;
    const share = p.amount > 0 ? p.pricedAmt / p.amount : 0;
    const worthCovered = value != null ? value * share : null;
    const pl = worthCovered != null && p.cost > 0 ? worthCovered - p.cost : null;
    return { p, px, value, pl, plPct: pl != null ? (pl / p.cost) * 100 : null };
  });
}

/** Add a reading to a value history: one per 3 hours, newest replaces a too-close one. Keeps at most `cap`. */
export function addSnapshot(list, ts, value, cap = 400, gap = 3 * 3600e3) {
  const out = Array.isArray(list) ? list.filter(r => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1])) : [];
  if (!(value > 0)) return out;
  const last = out.at(-1);
  if (last && ts - last[0] < gap) out[out.length - 1] = [last[0], value];
  else out.push([ts, value]);
  while (out.length > cap) out.splice(1, 1); // thin out the middle, keep the first and newest readings
  return out;
}

// ---------- CSV ----------
const csvCell = s => { const t = String(s ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

export function toCsv(folio) {
  const rows = [['date', 'type', 'ticker', 'amount', 'price_usd', 'fee_usd', 'note']];
  for (const x of [...folio.tx].sort((a, b) => a.ts - b.ts)) {
    rows.push([new Date(x.ts).toISOString().slice(0, 10), x.t, x.ticker, x.amount, x.price ?? '', x.fee || '', x.note]);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

function splitCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Read a CSV made by toCsv (or a hand-made one with the same headers). Returns { tx, skipped }. */
export function fromCsv(text, tickers = null) {
  const rows = splitCsv(String(text || '').replace(/^\uFEFF/, ''));
  if (rows.length < 2) return { tx: [], skipped: 0 };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = name => head.indexOf(name);
  const need = ['date', 'type', 'ticker', 'amount'].map(col);
  if (need.some(i => i < 0)) return { tx: [], skipped: rows.length - 1 };
  const [iD, iT, iK, iA] = need;
  const iP = col('price_usd'), iF = col('fee_usd'), iN = col('note');
  const tx = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const when = Date.parse((r[iD] || '').trim());
    const clean = cleanTx({
      t: (r[iT] || '').trim().toLowerCase(),
      ticker: (r[iK] || '').trim(),
      amount: (r[iA] || '').trim().replace(/,/g, ''),
      price: iP >= 0 ? (r[iP] || '').trim().replace(/,/g, '') : null,
      fee: iF >= 0 ? (r[iF] || '').trim().replace(/,/g, '') : 0,
      ts: Number.isFinite(when) ? when : NaN,
      note: iN >= 0 ? r[iN] : '',
    }, tickers);
    if (clean && Number.isFinite(when)) tx.push(clean); else skipped++;
  }
  return { tx, skipped };
}
