// Screener: filter and sort every tracked coin. Runs entirely in the browser on the one shared
// market reading, so changing a filter costs no request. Filters are kept in the address bar.
import { initChrome, logoEl, dragScroll, pollPrices, el, money, compactMoney, onCurrency, API } from './common.js';
import { loadMarket, buildRows, coinCell, changeSpan, distText, supplyText } from './intel.js';

const $ = id => document.getElementById(id);
const state = { coins: [], live: new Map(), market: null, sort: 'cap', dir: -1, f: {}, q: '' };

// Amounts accept 5, 2.5k, 40m, 1.2b, 3t. Prices are US dollars.
export function parseAmount(text) {
  const m = String(text ?? '').trim().toLowerCase().replace(/[,$\s]/g, '').match(/^(-?\d*\.?\d+)([kmbt])?$/);
  if (!m) return null;
  return Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]] || 1);
}

const FILTERS = [
  { id: 'cap', label: 'Market cap', d: 'Biggest coins by market value', unit: '$', get: r => r.cap },
  { id: 'price', label: 'Price', unit: '$', get: r => r.price },
  { id: 'vol', label: '24h volume', d: 'Where the trading is happening', unit: '$', get: r => r.vol },
  { id: 'volCap', label: 'Volume / market cap', unit: '%', get: r => r.volCap },
  { id: 'c24', label: '24h change', unit: '%', get: r => r.c24 },
  { id: 'c7', label: '7d change', unit: '%', get: r => r.c7 },
  { id: 'athDist', label: 'Distance from ATH', unit: '%', get: r => r.athDist, hint: 'Negative: −30 means 30% below' },
  { id: 'atlUp', label: 'Above all-time low', unit: '%', get: r => r.atlUp },
  { id: 'circ', label: 'Circulating supply', unit: '', get: r => r.circ },
  { id: 'rank', label: 'Market rank', unit: '#', get: r => r.rank },
];

const PRESETS = [
  { id: 'cap', label: 'Largest', sort: 'cap', dir: -1 },
  { id: 'gain', label: 'Gainers', d: 'Strongest risers in the last 24 hours', sort: 'c24', dir: -1 },
  { id: 'lose', label: 'Losers', d: 'Biggest fallers in the last 24 hours', sort: 'c24', dir: 1 },
  { id: 'vol', label: 'Volume', sort: 'vol', dir: -1 },
  { id: 'near', label: 'Near ATH', d: 'Closest to their all-time high', sort: 'athDist', dir: -1, f: { stable: 'no' } },
  { id: 'far', label: 'Far from ATH', d: 'Furthest below their all-time high', sort: 'athDist', dir: 1, f: { stable: 'no' } },
  { id: 'rec', label: 'ATL recovery', d: 'Rebounding most from their lows', sort: 'atlUp', dir: -1, f: { stable: 'no' } },
];

const COLS = [
  { id: 'rank', label: '#', get: r => r.rank, cell: r => el('span', 'num', r.rank ?? '–') },
  { id: 'name', label: 'Coin', sortable: false },
  { id: 'price', label: 'Price', get: r => r.price, cell: r => el('span', 'num price-cell', money(r.price, { stable: r.stable })) },
  { id: 'c24', label: '24H', get: r => r.c24, cell: r => changeSpan(r.c24) },
  { id: 'c7', label: '7D', get: r => r.c7, cell: r => changeSpan(r.c7) },
  { id: 'cap', label: 'Market cap', get: r => r.cap, cell: r => el('span', 'num', compactMoney(r.cap)) },
  { id: 'vol', label: 'Volume', get: r => r.vol, cell: r => el('span', 'num', compactMoney(r.vol)) },
  { id: 'volCap', label: 'Vol/Cap', get: r => r.volCap, cell: r => el('span', 'num', r.volCap == null ? '–' : r.volCap.toFixed(1) + '%') },
  { id: 'athDist', label: 'From ATH', get: r => r.athDist, cell: r => el('span', 'num ' + (r.athDist > -10 ? 'up' : ''), distText(r.athDist)) },
  { id: 'atlUp', label: 'From ATL', get: r => r.atlUp, cell: r => el('span', 'num', distText(r.atlUp)) },
  { id: 'circ', label: 'Circulating', get: r => r.circ, cell: r => el('span', 'num', supplyText(r.circ)) },
];

const rows = () => buildRows(state.coins, state.live, state.market);

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.sort = COLS.some(c => c.id === p.get('sort') && c.sortable !== false) ? p.get('sort') : 'cap';
  state.dir = p.get('dir') === 'asc' ? 1 : -1;
  state.f = {};
  for (const f of FILTERS) {
    for (const end of ['min', 'max']) { const v = p.get(f.id + '_' + end); if (v) state.f[f.id + '_' + end] = v; }
  }
  const s = p.get('stable'); if (s === 'no' || s === 'only') state.f.stable = s;
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'cap') p.set('sort', state.sort);
  if (state.dir === 1) p.set('dir', 'asc');
  for (const [k, v] of Object.entries(state.f)) if (v) p.set(k, v);
  history.replaceState(null, '', location.pathname + ([...p].length ? '?' + p : ''));
}

/** Pure: does a row pass the current filters? Missing data fails a filter that asks about it. */
export function passes(r, f, q = '') {
  if (q && !`${r.ticker} ${r.name}`.toLowerCase().includes(q.toLowerCase())) return false;
  if (f.stable === 'no' && r.stable) return false;
  if (f.stable === 'only' && !r.stable) return false;
  for (const def of FILTERS) {
    const lo = f[def.id + '_min'], hi = f[def.id + '_max'];
    if (!lo && !hi) continue;
    const v = def.get(r);
    if (typeof v !== 'number') return false;
    const a = lo ? parseAmount(lo) : null, b = hi ? parseAmount(hi) : null;
    if (a != null && v < a) return false;
    if (b != null && v > b) return false;
  }
  return true;
}

function buildFilters() {
  const grid = $('sc-grid');
  const stable = el('div', 'fld sc-fld');
  stable.append(el('span', '', 'Coin type'));
  const sel = el('div', 'segs');
  for (const [v, label] of [['', 'All'], ['no', 'No stablecoins'], ['only', 'Stablecoins']]) {
    const b = el('button', 'seg', label); b.type = 'button'; b.dataset.v = v;
    b.addEventListener('click', () => { if (v) state.f.stable = v; else delete state.f.stable; sync(); });
    sel.append(b);
  }
  stable.append(sel);
  grid.append(stable);
  for (const def of FILTERS) {
    const box = el('div', 'fld sc-fld');
    box.append(el('span', '', def.label + (def.unit === '%' ? ' (%)' : def.unit === '$' ? ' ($)' : '')));
    const pair = el('div', 'sc-pair');
    for (const end of ['min', 'max']) {
      const i = el('input', 'sc-in');
      i.type = 'text'; i.inputMode = 'text'; i.placeholder = end === 'min' ? 'Min' : 'Max';
      i.id = `sc-${def.id}-${end}`;
      i.setAttribute('aria-label', `${def.label} ${end === 'min' ? 'minimum' : 'maximum'}`);
      i.autocomplete = 'off';
      i.addEventListener('input', () => { if (i.value.trim()) state.f[def.id + '_' + end] = i.value.trim(); else delete state.f[def.id + '_' + end]; paint(); writeUrl(); });
      pair.append(i);
    }
    box.append(pair);
    if (def.hint) box.append(el('span', 's-hint', def.hint));
    grid.append(box);
  }
}

function syncInputs() {
  for (const def of FILTERS) for (const end of ['min', 'max']) { const i = $(`sc-${def.id}-${end}`); if (i && document.activeElement !== i) i.value = state.f[def.id + '_' + end] || ''; }
  for (const b of $('sc-grid').querySelectorAll('.seg')) b.setAttribute('aria-pressed', String((state.f.stable || '') === b.dataset.v));
  const active = Object.values(state.f).filter(Boolean).length + (state.q ? 1 : 0);
  $('sc-active').textContent = active ? active + ' active' : '';
  $('sc-q').value = state.q;
}
function sync() { syncInputs(); paint(); writeUrl(); }

function paintHead() {
  $('sc-head').replaceChildren(...COLS.map(c => {
    const th = el('th'); th.scope = 'col';
    if (c.sortable === false) { th.textContent = c.label; return th; }
    const b = el('button', '', c.label); b.type = 'button';
    th.setAttribute('aria-sort', state.sort === c.id ? (state.dir === 1 ? 'ascending' : 'descending') : 'none');
    b.addEventListener('click', () => {
      if (state.sort === c.id) state.dir *= -1; else { state.sort = c.id; state.dir = c.id === 'rank' ? 1 : -1; }
      paintHead(); paint(); writeUrl(); markPreset();
    });
    th.append(b);
    return th;
  }));
}

function markPreset() {
  for (const b of $('sc-presets').children) {
    const p = PRESETS.find(x => x.id === b.dataset.id);
    b.setAttribute('aria-pressed', String(p.sort === state.sort && p.dir === state.dir && (p.f?.stable || '') === (state.f.stable || '')));
  }
}

// Phone view: every coin is a card that shows the one number this view is about, with a bar to compare at a glance.
function paintCards(list) {
  const lens = state.sort === 'rank' ? COLS.find(c => c.id === 'cap') : COLS.find(c => c.id === state.sort);
  const vals = list.map(r => lens.get(r)).filter(v => typeof v === 'number' && Number.isFinite(v));
  const top = Math.max(1e-9, ...vals.map(v => Math.abs(v)));
  const signed = lens.id === 'c24' || lens.id === 'c7';
  const up = list.filter(r => r.c24 > 0).length, down = list.filter(r => r.c24 < 0).length;
  const known = list.filter(r => typeof r.c24 === 'number');
  const avg = known.length ? known.reduce((a, r) => a + r.c24, 0) / known.length : null;
  const tile = (cls, label, text) => { const d = el('div', 'pl ' + cls); d.append(el('span', '', label), el('b', 'num', text)); return d; };
  const split = el('div', 'sc-split'); const u = el('i', 'u'), dn = el('i', 'd');
  u.style.width = (up + down ? (up / (up + down)) * 100 : 0) + '%'; dn.style.width = (up + down ? (down / (up + down)) * 100 : 0) + '%';
  split.append(u, dn);
  const a = avg == null ? null : Math.round(avg * 100) / 100;
  $('sc-pulse').replaceChildren(tile('up', 'Rising', String(up)), tile('down', 'Falling', String(down)),
    tile(a == null ? '' : a > 0 ? 'up' : a < 0 ? 'down' : '', 'Average 24h', a == null ? '–' : (a > 0 ? '+' : a < 0 ? '−' : '') + Math.abs(a).toFixed(2) + '%'), split);
  const preset = PRESETS.find(p => p.sort === state.sort && p.dir === state.dir && (p.f?.stable || '') === (state.f.stable || ''));
  const cap = $('sc-lens'); cap.replaceChildren();
  cap.append(el('b', '', preset ? preset.label : 'Sorted by ' + lens.label), document.createTextNode(' · ' + (preset ? preset.d : 'your own view') + ' · ' + list.length + ' coins'));
  $('sc-cards').replaceChildren(...list.map((r, i) => {
    const v = lens.get(r);
    const a = el('a', 'sc-card'); a.href = '/coin/' + r.ticker;
    const id = el('span', 'sc-id'); id.append(el('b', '', r.ticker), el('small', '', lens.id === 'price' ? r.name : money(r.price, { stable: r.stable }) + ' · ' + r.name));
    const val = el('span', 'sc-val'); const num = lens.cell(r); num.className = ''; 
    const b = el('b', 'num', num.textContent); if (signed && typeof v === 'number') b.classList.add(v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
    val.append(b, el('small', '', lens.label));
    let w = 0;
    if (typeof v === 'number' && Number.isFinite(v)) w = lens.id === 'athDist' ? Math.max(0, Math.min(1, 1 + v / 100)) : Math.abs(v) / top;
    const m = el('i', 'sc-meter' + (signed && typeof v === 'number' ? (v > 0 ? ' up' : ' down') : '')); const bar = el('u'); bar.style.setProperty('--w', Math.max(2, w * 100).toFixed(1) + '%'); m.append(bar);
    a.append(el('span', 'sc-rk', String(i + 1)), logoEl({ ticker: r.ticker, logo: r.logo, color: r.color }), id, val, m);
    return a;
  }));
}

function paint() {
  const col = COLS.find(c => c.id === state.sort);
  const list = rows().filter(r => passes(r, state.f, state.q)).sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    if (x == null && y == null) return a.order - b.order;
    if (x == null) return 1; if (y == null) return -1; // missing values always last
    return (x - y) * state.dir || a.order - b.order;
  });
  $('sc-result').textContent = `${list.length} of ${state.coins.length} coins`;
  $('sc-none').hidden = list.length > 0;
  $('sc-t').hidden = list.length === 0;
  paintCards(list);
  $('sc-body').replaceChildren(...list.map(r => {
    const tr = el('tr');
    for (const c of COLS) {
      const td = el('td');
      if (c.id === 'name') td.append(coinCell(r)); else td.append(c.cell(r));
      tr.append(td);
    }
    return tr;
  }));
}

async function boot() {
  state.coins = await initChrome();
  readUrl();
  const pre = $('sc-presets');
  for (const p of PRESETS) {
    const b = el('button', 'seg', p.label); b.type = 'button'; b.dataset.id = p.id;
    b.addEventListener('click', () => {
      state.sort = p.sort; state.dir = p.dir;
      if (p.f?.stable) state.f.stable = p.f.stable; else delete state.f.stable;
      paintHead(); sync(); markPreset();
    });
    pre.append(b);
  }
  buildFilters();
  paintHead();
  $('sc-reset').addEventListener('click', () => { state.f = {}; state.q = ''; sync(); markPreset(); });
  $('sc-q').addEventListener('input', e => { state.q = e.target.value.trim(); paint(); writeUrl(); syncInputs(); });
  if (window.matchMedia('(max-width: 720px)').matches && !Object.keys(state.f).length) $('sc-filters').open = false;
  sync(); markPreset();
  dragScroll(document.querySelector('.sc-table'));
  onCurrency(paint);
  if (!API) return;
  let first = true, timer = 0;
  pollPrices(data => {
    for (const c of data.coins) state.live.set(c.ticker, c);
    if (first) { first = false; paint(); return; }
    // Live prices arrive every second; re-sorting 31 rows that often would make the table jump.
    clearTimeout(timer); timer = setTimeout(paint, 15_000);
  });
  loadMarket().then(m => { state.market = m.coins; paint(); }).catch(() => { $('sc-none').hidden = false; $('sc-none').textContent = 'Market details are not available right now. Try again shortly.'; });
}
if (typeof document !== 'undefined' && document.getElementById('sc-body')) boot();
