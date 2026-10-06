// Portfolio (v3.4): a ledger of buys and sells kept on this device, valued with the live prices.
// Several portfolios, average-cost profit and loss (unrealized and realized), allocation, what moved today,
// your own value history, goals, CSV in and out. No account, nothing is uploaded.
import { coinPicker, openPanel } from './ui.js';
import { API, initChrome, pollPrices, ledger, store, money, pct, el, logoEl, setNum, currency, onCurrency, toast } from './common.js';
import { loadMarket } from './intel.js';
import { positions, valued, newFolio, cleanTx, addSnapshot, toCsv, fromCsv, LIMITS } from './ledger.js';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const live = new Map();
let mk = {};
let coins = [];
let tickers = new Set();
let S = ledger.load();
let sortKey = 'value';
let range = '7d';
let showAllAct = false;
let scrubbing = false;
let lastSnap = 0;

// ---------- small helpers ----------
const folio = () => S.folios.find(f => f.id === S.active) || S.folios[0];
const save = () => ledger.save(S);
const zero = () => money(1).replace(/[\d.,]+/, '0.00');
const signed = n => (Math.abs(n) < 0.005 ? zero() : (n > 0 ? '+' : '−') + money(Math.abs(n)));
const parse = text => Number(String(text).replace(/,/g, '').trim());
const amountText = n => n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 8 : 6 });
const inputText = n => String(Number(n.toPrecision(8)));
const dateText = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const coinName = t => coins.find(c => c.ticker === t)?.name || t;
const cls = n => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
const icon = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const hv = (tag, c, text) => el(tag, (c ? c + ' ' : '') + 'hv', text);
const ARROW = { buy: '<path d="M12 19V5M6 11l6-6 6 6"/>', sell: '<path d="M12 5v14M6 13l6 6 6-6"/>' };

function setTabs(box, attr, value) {
  for (const b of box.querySelectorAll('[role="tab"]')) b.setAttribute('aria-selected', String(b.dataset[attr] === value));
}

function download(name, text, type) {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- numbers ----------
function calc() {
  const f = folio();
  const pos = positions(f.tx);
  const rows = valued(pos, t => live.get(t)?.price ?? null);
  let total = 0, ago = 0, basis = 0, worth = 0, unpriced = 0;
  for (const r of rows) {
    if (r.value == null) { unpriced++; continue; }
    const c = live.get(r.p.ticker);
    total += r.value;
    ago += typeof c?.change24h === 'number' && c.change24h > -100 ? r.value / (1 + c.change24h / 100) : r.value;
    if (r.p.cost > 0) { basis += r.p.cost; worth += r.value * (r.p.pricedAmt / r.p.amount); }
  }
  const realized = [...pos.values()].reduce((a, p) => a + p.realized, 0);
  const sells = f.tx.some(x => x.t === 'sell');
  return { f, pos, rows, total, ago, basis, worth, realized, sells, unpriced };
}

// ---------- chart ----------
function drawChart(host, pts, up, fmt) {
  host.replaceChildren();
  host.classList.toggle('up', up);
  host.classList.toggle('down', !up);
  if (pts.length < 2) return;
  const W = 600, H = 170, pad = 10;
  const ys = pts.map(p => p.y);
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const X = i => (i / (pts.length - 1)) * W;
  const Y = v => pad + (1 - (v - min) / span) * (H - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('');
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const defs = svg('defs');
  const g = svg('linearGradient', { id: 'pxg', x1: '0', y1: '0', x2: '0', y2: '1' });
  g.append(svg('stop', { offset: '0', 'stop-color': 'currentColor', 'stop-opacity': '.32' }), svg('stop', { offset: '1', 'stop-color': 'currentColor', 'stop-opacity': '0' }));
  defs.append(g);
  s.append(defs, svg('path', { d: `${line}L${W} ${H}L0 ${H}Z`, fill: 'url(#pxg)', class: 'px-area' }), svg('path', { d: line, class: 'px-line', fill: 'none' }));
  const cur = el('div', 'px-cur');
  cur.hidden = true;
  const dot = el('i', 'px-dot');
  cur.append(el('i', 'px-cur-line'), dot);
  host.append(s, cur);

  const show = clientX => {
    const r = host.getBoundingClientRect();
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((clientX - r.left) / r.width) * (pts.length - 1))));
    cur.hidden = false;
    cur.style.left = (i / (pts.length - 1)) * 100 + '%';
    dot.style.top = (Y(pts[i].y) / H) * 100 + '%';
    $('px-scrub').textContent = `${fmt(pts[i].y)} · ${pts[i].label}`;
  };
  const stop = () => { scrubbing = false; cur.hidden = true; $('px-scrub').textContent = ''; };
  host.onpointerdown = e => { scrubbing = true; show(e.clientX); };
  host.onpointermove = e => { if (scrubbing || e.pointerType === 'mouse') { scrubbing = true; show(e.clientX); } };
  host.onpointerleave = stop;
  host.onpointerup = e => { if (e.pointerType !== 'mouse') stop(); };
  host.onpointercancel = stop;
}

function paintChart(c) {
  const host = $('px-chart');
  if (scrubbing) return;
  host.classList.remove('empty');
  let pts = [];
  if (range === '7d') {
    const parts = c.rows.filter(r => r.value != null && mk[r.p.ticker]?.spark?.length > 8);
    const n = parts.length ? Math.min(...parts.map(r => mk[r.p.ticker].spark.length)) : 0;
    if (n > 8 && parts.length === c.rows.filter(r => r.value != null).length) {
      const now = Date.now(), step = (7 * 864e5) / (n - 1);
      pts = Array.from({ length: n }, (_, i) => ({
        y: parts.reduce((a, r) => a + r.p.amount * mk[r.p.ticker].spark.at(-n + i), 0),
        label: dateText(now - (n - 1 - i) * step),
      }));
    }
    if (pts.length < 2) { host.replaceChildren(el('p', 'px-hint', 'The week appears once every coin you hold has price history.')); host.classList.add('empty'); return; }
  } else {
    pts = ledger.snaps(S.active).map(([t, v]) => ({ y: v, label: new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }));
    if (c.total > 0 && !c.unpriced) pts.push({ y: c.total, label: 'Now' });
    if (pts.length < 2) { host.replaceChildren(el('p', 'px-hint', 'Your own history builds up each time you open the app. Check back later today.')); host.classList.add('empty'); return; }
  }
  drawChart(host, pts, pts.at(-1).y >= pts[0].y, v => money(v));
}

// ---------- summary ----------
function paintHero(c) {
  const has = c.f.tx.length > 0;
  const total = $('px-total');
  if (!has) total.textContent = money(1).replace(/[\d.,]+/, '0.00');
  else if (!c.total) total.textContent = '–';
  else setNum(total, money(c.total), c.total);

  const chg = $('px-chg');
  if (has && c.total && c.ago > 0) {
    const delta = c.total - c.ago, p = pct((delta / c.ago) * 100);
    chg.textContent = `${signed(delta)} (${p.text}) today`;
    chg.className = 'px-chg num chg hv ' + p.cls;
  } else { chg.textContent = ' '; chg.className = 'px-chg num chg flat'; }

  const stat = (label, value, sub, tone = '') => {
    const d = el('div', 'px-stat');
    d.append(el('span', 'px-label', label), hv('b', 'num ' + tone, value));
    d.append(sub ? hv('span', 'num chg ' + tone, sub) : el('span', 'px-sub-empty'));
    return d;
  };
  const stats = [];
  if (c.basis > 0) {
    const pl = c.worth - c.basis;
    stats.push(stat('Invested', money(c.basis), c.rows.some(r => r.p.pricedAmt < r.p.amount - 1e-12) ? 'some prices missing' : ''));
    stats.push(stat('Unrealized', signed(pl), pct((pl / c.basis) * 100).text, cls(pl)));
  } else {
    stats.push(stat('Invested', '–', has ? 'add prices paid' : ''));
    stats.push(stat('Unrealized', '–', ''));
  }
  stats.push(stat('Realized', c.sells ? signed(c.realized) : zero(), c.sells ? 'from sales' : 'no sales yet', c.sells ? cls(c.realized) : ''));
  $('px-stats').replaceChildren(...stats);

  const goal = $('px-goal');
  goal.hidden = !has;
  if (!has) return;
  goal.replaceChildren();
  const g = c.f.goal;
  if (g > 0) {
    const share = Math.max(0, Math.min(1, c.total / g));
    const bar = el('div', 'px-bar');
    bar.append(Object.assign(el('i'), { style: `width:${(share * 100).toFixed(1)}%` }));
    const line = el('div', 'px-goal-row');
    const edit = el('button', 'px-link', 'Edit'); edit.type = 'button'; edit.addEventListener('click', openGoal);
    line.append(hv('span', '', c.total ? `${(share * 100).toFixed(share < .1 ? 1 : 0)}% of your ${money(g)} goal` : `Goal ${money(g)}`), edit);
    goal.append(bar, line);
  } else {
    const b = el('button', 'px-link', 'Set a goal'); b.type = 'button'; b.addEventListener('click', openGoal);
    goal.append(b);
  }
}

const SEG_COLORS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];

function paintAlloc(c) {
  const priced = c.rows.filter(r => r.value).sort((a, b) => b.value - a.value);
  const card = $('px-alloc-card');
  card.hidden = !priced.length;
  if (!priced.length) return;
  const top = priced.slice(0, 5);
  const other = priced.slice(5).reduce((a, r) => a + r.value, 0);
  const segs = top.map((r, i) => ({ label: r.p.ticker, v: r.value, i }));
  if (other > 0) segs.push({ label: 'Other', v: other, i: 5 });
  const sum = segs.reduce((a, s) => a + s.v, 0);

  const s = svg('svg', { viewBox: '0 0 42 42', 'aria-hidden': 'true' });
  s.append(svg('circle', { cx: 21, cy: 21, r: 15.9155, fill: 'none', class: 'dn-track' }));
  const center = el('div', 'dn-center');
  const cLabel = el('b', 'num'), cSub = el('span');
  center.append(cLabel, cSub);
  const setCenter = seg => { cLabel.textContent = ((seg.v / sum) * 100).toFixed(seg.v / sum < .1 ? 1 : 0) + '%'; cSub.textContent = seg.label; };
  setCenter(segs[0]);
  let offset = 0;
  const circles = segs.map(seg => {
    const len = (seg.v / sum) * 100, gap = segs.length > 1 ? Math.min(.9, len * .4) : 0;
    const k = svg('circle', { cx: 21, cy: 21, r: 15.9155, fill: 'none', pathLength: 100, class: 'dn-seg ' + SEG_COLORS[seg.i], 'stroke-dasharray': `${Math.max(len - gap, .1).toFixed(3)} ${(100 - len + gap).toFixed(3)}`, 'stroke-dashoffset': (-offset).toFixed(3), transform: 'rotate(-90 21 21)' });
    offset += len;
    return k;
  });
  s.append(...circles);
  $('px-donut').replaceChildren(s, center);

  $('px-legend').replaceChildren(...segs.map((seg, i) => {
    const li = el('li');
    const b = el('button', 'px-leg'); b.type = 'button';
    b.append(el('i', 'al-dot ' + SEG_COLORS[seg.i]), el('b', '', seg.label), hv('span', 'num px-leg-v', money(seg.v)), el('span', 'num px-leg-p', ((seg.v / sum) * 100).toFixed(1) + '%'));
    const focus = () => { setCenter(seg); circles.forEach((k, j) => k.classList.toggle('dim', j !== i)); };
    const blur = () => { setCenter(segs[0]); circles.forEach(k => k.classList.remove('dim')); };
    b.addEventListener('click', focus);
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') focus(); });
    b.addEventListener('pointerleave', blur);
    b.addEventListener('blur', blur);
    li.append(b);
    return li;
  }));
}

function paintMoves(c) {
  const list = c.rows.filter(r => r.value != null).map(r => {
    const ch = live.get(r.p.ticker)?.change24h;
    return typeof ch === 'number' && ch > -100 ? { r, d: r.value - r.value / (1 + ch / 100), ch } : null;
  }).filter(Boolean).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6);
  $('px-moves-card').hidden = !list.length;
  const max = Math.max(...list.map(x => Math.abs(x.d)), 1e-9);
  $('px-moves').replaceChildren(...list.map(({ r, d, ch }) => {
    const li = el('li', 'px-mv ' + cls(d));
    const bar = el('span', 'px-mv-bar');
    bar.append(Object.assign(el('i'), { style: `width:${Math.max(4, (Math.abs(d) / max) * 100).toFixed(1)}%` }));
    li.append(el('b', '', r.p.ticker), bar, hv('span', 'num px-mv-d', signed(d)), el('span', 'num chg ' + cls(ch), pct(ch).text));
    return li;
  }));
}

// ---------- holdings ----------
function sortRows(rows) {
  if (sortKey === 'az') return [...rows].sort((a, b) => coinName(a.p.ticker).localeCompare(coinName(b.p.ticker)));
  const k = { value: r => r.value ?? -1, day: r => live.get(r.p.ticker)?.change24h ?? -1e9, pl: r => r.plPct ?? -1e9 }[sortKey];
  return [...rows].sort((a, b) => k(b) - k(a));
}

function paintHoldings(c) {
  const rows = sortRows(c.rows);
  $('px-list').replaceChildren(...rows.map(r => {
    const t = r.p.ticker, coin = live.get(t);
    const li = el('li');
    const b = el('button', 'px-row'); b.type = 'button';
    b.setAttribute('aria-label', `${coinName(t)}, open details`);
    const logo = el('span', 'wl-logo'); logo.append(logoEl(coin || { ticker: t, logo: null }));
    const name = el('span', 'px-row-name');
    name.append(el('b', '', coinName(t)), hv('span', 'num', `${amountText(r.p.amount)} ${t}`));
    const val = el('span', 'px-row-val');
    const ch = pct(coin?.change24h);
    val.append(hv('b', 'num', r.value != null ? money(r.value) : '–'));
    const sub = el('span', 'px-row-sub');
    sub.append(el('span', 'chg num ' + ch.cls, ch.text));
    if (r.pl != null) sub.append(hv('span', 'chg num px-pl ' + cls(r.pl), pct(r.plPct).text + ' all time'));
    val.append(sub);
    b.append(logo, name, val);
    b.addEventListener('click', () => openHolding(t));
    li.append(b);
    return li;
  }));
  $('px-list').closest('.px-sec').hidden = !rows.length;
}

// ---------- activity ----------
function txRow(x, onOpen, withCoin = true) {
  const li = el('li');
  const b = el('button', 'px-tx'); b.type = 'button';
  const ic = el('span', 'px-tx-ic ' + x.t); ic.innerHTML = icon(ARROW[x.t]);
  const stable = live.get(x.ticker)?.stable;
  const verb = x.t === 'buy' ? 'Bought' : 'Sold';
  const t = el('span', 'px-tx-t');
  t.append(hv('b', '', `${verb} ${amountText(x.amount)}${withCoin ? ' ' + x.ticker : ''}`), el('span', '', dateText(x.ts) + (x.price != null ? ` · at ${money(x.price, { stable })}` : '') + (x.note ? ` · ${x.note}` : '')));
  b.append(ic, t, x.price != null ? hv('span', 'num px-tx-v', money(x.amount * x.price)) : el('span'));
  b.addEventListener('click', () => onOpen(x));
  li.append(b);
  return li;
}

function paintActivity(c) {
  const all = [...c.f.tx].sort((a, b) => b.ts - a.ts);
  const shown = showAllAct ? all : all.slice(0, 6);
  $('px-act-sec').hidden = !all.length;
  $('px-act-all').hidden = all.length <= 6;
  $('px-act-all').textContent = showAllAct ? 'Show less' : `Show all ${all.length}`;
  $('px-act').replaceChildren(...shown.map(x => txRow(x, tx => openTxForm({ tx }))));
}

// ---------- page ----------
function paintFolios() {
  const box = $('px-folios');
  const chips = S.folios.map(f => {
    const b = el('button', 'px-chip', f.name); b.type = 'button';
    b.setAttribute('aria-current', String(f.id === S.active));
    b.addEventListener('click', () => { if (f.id === S.active) return; S.active = f.id; showAllAct = false; save(); });
    return b;
  });
  if (S.folios.length < LIMITS.folios) {
    const b = el('button', 'px-chip add'); b.type = 'button';
    b.innerHTML = icon('<path d="M12 5v14M5 12h14"/>') + '<span>New</span>';
    b.setAttribute('aria-label', 'New portfolio');
    b.addEventListener('click', openNewFolio);
    chips.push(b);
  }
  box.replaceChildren(...chips);
}

function render() {
  const c = calc();
  const empty = c.f.tx.length === 0;
  document.querySelector('.px').classList.toggle('hide-vals', S.hide);
  const eye = $('px-eye');
  eye.setAttribute('aria-pressed', String(S.hide));
  eye.setAttribute('aria-label', S.hide ? 'Show amounts' : 'Hide amounts');
  eye.innerHTML = icon(S.hide
    ? '<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
    : '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
  paintFolios();
  $('px-empty').hidden = !empty;
  $('px-body').hidden = empty;
  if (!empty) { paintHero(c); paintChart(c); paintAlloc(c); paintMoves(c); paintHoldings(c); paintActivity(c); }
  maybeSnapshot(c);
}

function maybeSnapshot(c) {
  if (!c.total || c.unpriced || Date.now() - lastSnap < 60_000) return;
  lastSnap = Date.now();
  ledger.saveSnaps(S.active, addSnapshot(ledger.snaps(S.active), Date.now(), c.total));
}

// ---------- panels ----------
function field(label, input, hint) {
  const l = el('label', 'fld');
  l.append(el('span', '', label), input);
  if (hint) l.append(el('small', 'px-fhint', hint));
  return l;
}
const textInput = (value = '', attrs = {}) => { const i = el('input'); i.type = 'text'; i.value = value; i.autocomplete = 'off'; Object.assign(i, attrs); return i; };

function askText({ title, label, value = '', cta = 'Save', mode = 'text', hint = '', onSave }) {
  openPanel({
    title,
    build(body, api) {
      const form = el('form', 'px-form');
      const input = textInput(value, mode === 'number' ? { inputMode: 'decimal', placeholder: '0.00' } : { maxLength: LIMITS.name });
      const err = el('p', 's-error'); err.hidden = true; err.setAttribute('role', 'alert');
      const go = el('button', 'btn btn-accent', cta); go.type = 'submit';
      form.append(field(label, input, hint), err, go);
      form.addEventListener('submit', e => {
        e.preventDefault();
        const msg = onSave(input.value.trim());
        if (msg) { err.textContent = msg; err.hidden = false; } else api.close();
      });
      body.append(form);
      if (matchMedia('(min-width: 821px)').matches) input.focus();
    },
  });
}

function openNewFolio() {
  askText({
    title: 'New portfolio', label: 'Name', cta: 'Create', hint: 'For example Long term, Trading or Savings.',
    onSave(v) {
      if (!v) return 'Give it a name.';
      const f = newFolio(v);
      S.folios.push(f); S.active = f.id; showAllAct = false; save();
      return '';
    },
  });
}

function openGoal() {
  const f = folio();
  askText({
    title: 'Portfolio goal', label: `Target value (${currency.code})`, mode: 'number', cta: 'Save goal',
    value: f.goal ? inputText(f.goal * currency.rate) : '', hint: 'A target to measure your progress against. Clear the box to remove it.',
    onSave(v) {
      if (!v) { f.goal = null; save(); return ''; }
      const n = parse(v);
      if (!(n > 0) || !Number.isFinite(n)) return 'Enter a number greater than zero.';
      f.goal = n / currency.rate; save();
      return '';
    },
  });
}

function openMore() {
  openPanel({
    title: 'Options',
    build(body, api) {
      const f = folio();
      const box = el('div', 'px-opts');
      const row = (label, sub, path, fn, danger = false) => {
        const b = el('button', 'px-opt' + (danger ? ' danger' : '')); b.type = 'button';
        const ic = el('span', 'px-opt-ic'); ic.innerHTML = icon(path);
        const t = el('span', 'px-opt-t'), head = el('b', '', label);
        t.append(head, el('span', '', sub));
        b.append(ic, t);
        b.addEventListener('click', () => fn(head));
        return b;
      };
      const importer = el('input'); importer.type = 'file'; importer.accept = '.csv,text/csv'; importer.hidden = true;
      importer.addEventListener('change', async () => { const file = importer.files?.[0]; if (file) { api.close(); await importFile(file); } });
      const many = S.folios.length > 1;
      const delLabel = many ? 'Delete portfolio' : 'Clear portfolio';
      let armed = null;
      box.append(
        row('Rename', f.name, '<path d="M4 20h4L19 9l-4-4L4 16z"/>', () => {
          api.close();
          askText({ title: 'Rename portfolio', label: 'Name', value: f.name, onSave(v) { if (!v) return 'Give it a name.'; f.name = v.slice(0, LIMITS.name); save(); return ''; } });
        }),
        row('Goal', f.goal ? `Target ${money(f.goal)}` : 'Set a target value', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>', () => { api.close(); openGoal(); }),
        row('Export CSV', 'Every transaction in this portfolio', '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', () => {
          if (!f.tx.length) { toast('Nothing to export yet.'); return; }
          download(`cryptomium-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'portfolio'}.csv`, toCsv(f), 'text/csv');
          api.close();
        }),
        row('Import CSV', 'Add transactions from a file. Prices in US dollars', '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>', () => importer.click()),
        row(delLabel, many ? 'Removes it and all its transactions' : 'Removes every transaction', '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', head => {
          if (!armed) {
            head.textContent = 'Tap again to confirm';
            armed = setTimeout(() => { armed = null; head.textContent = delLabel; }, 4000);
            return;
          }
          clearTimeout(armed);
          if (many) { S.folios = S.folios.filter(x => x.id !== f.id); S.active = S.folios[0].id; }
          else { f.tx = []; f.goal = null; }
          ledger.saveSnaps(f.id, []);
          save(); api.close();
        }, true),
      );
      body.append(box, importer);
    },
  });
}

async function importFile(file) {
  if (file.size > 1_500_000) { toast('That file is too large for a portfolio.'); return; }
  const f = folio();
  const { tx, skipped } = fromCsv(await file.text(), tickers);
  if (!tx.length) { toast(skipped ? `Nothing could be read, ${skipped} rows skipped. Use the Export CSV layout.` : 'That file has no transactions.'); return; }
  const room = Math.max(0, LIMITS.tx - f.tx.length);
  f.tx.push(...tx.slice(0, room).map(x => ({ ...x, id: Math.random().toString(36).slice(2, 10) })));
  save();
  toast(`Added ${Math.min(tx.length, room)} transaction${tx.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`);
}

function openHolding(ticker) {
  let on = null;
  openPanel({
    title: coinName(ticker),
    wide: true,
    onClose: () => { if (on) document.removeEventListener('cm:holdings', on); },
    build(body, api) {
      const paint = () => {
        const c = calc();
        const p = c.pos.get(ticker);
        const r = c.rows.find(x => x.p.ticker === ticker);
        const coin = live.get(ticker);
        if (!p) { api.close(); return; }
        const head = el('div', 'px-h-top');
        const logo = el('span', 'wl-logo'); logo.append(logoEl(coin || { ticker, logo: null }));
        const v = el('div', 'px-h-val');
        v.append(hv('b', 'num', r?.value != null ? money(r.value) : p.amount > 0 ? '–' : 'Sold out'), el('span', 'num', coin?.price ? `${money(coin.price, { stable: coin.stable })} each` : ticker));
        head.append(logo, v);
        const grid = el('dl', 'px-h-grid');
        const add = (k, val, tone = '') => { const d = el('div'); d.append(el('dt', '', k), hv('dd', 'num ' + tone, val)); grid.append(d); };
        add('Amount', `${amountText(p.amount)} ${ticker}`);
        add('Average buy', p.pricedAmt > 0 ? money(p.cost / p.pricedAmt, { stable: coin?.stable }) : '–');
        add('Cost basis', p.cost > 0 ? money(p.cost) : '–');
        add('Unrealized', r?.pl != null ? `${signed(r.pl)} (${pct(r.plPct).text})` : '–', r?.pl != null ? cls(r.pl) : '');
        add('Realized', p.sold > 0 ? signed(p.realized) : '–', p.sold > 0 ? cls(p.realized) : '');
        add('Fees paid', p.fees > 0 ? money(p.fees) : '–');
        const acts = el('div', 'px-h-acts');
        const mkBtn = (label, c2, fn) => { const b = el('button', 'btn ' + c2, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
        const link = el('a', 'btn btn-ghost', 'Coin page'); link.href = '/coin/' + ticker;
        acts.append(mkBtn('Buy', 'btn-accent', () => { api.close(); openTxForm({ t: 'buy', ticker }); }), mkBtn('Sell', 'btn-ghost', () => { api.close(); openTxForm({ t: 'sell', ticker }); }), link);
        const list = el('ul', 'px-act px-h-list');
        for (const x of c.f.tx.filter(t => t.ticker === ticker).sort((a, b) => b.ts - a.ts)) list.append(txRow(x, tx => { api.close(); openTxForm({ tx }); }, false));
        body.replaceChildren(head, grid, acts, el('h3', 'px-h-sub', 'Transactions'), list);
      };
      paint();
      on = paint;
      document.addEventListener('cm:holdings', on);
    },
  });
}

function openTxForm({ t = 'buy', ticker = '', tx = null } = {}) {
  const editing = Boolean(tx);
  let type = tx?.t || t;
  openPanel({
    title: editing ? 'Edit transaction' : 'Add transaction',
    build(body, api) {
      const form = el('form', 'px-form');
      form.autocomplete = 'off';
      const btnText = () => (editing ? 'Save changes' : type === 'buy' ? 'Add purchase' : 'Add sale');
      const go = el('button', 'btn btn-accent', btnText()); go.type = 'submit';
      const seg = el('div', 'px-seg'); seg.setAttribute('role', 'tablist');
      const mkSeg = (v, label) => {
        const b = el('button', '', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.t = v;
        b.setAttribute('aria-selected', String(v === type));
        b.addEventListener('click', () => { type = v; setTabs(seg, 't', type); go.textContent = btnText(); });
        return b;
      };
      seg.append(mkSeg('buy', 'Buy'), mkSeg('sell', 'Sell'));

      const coinBtn = el('button', 'cpk'); coinBtn.type = 'button';
      const want = (new URLSearchParams(location.search).get('coin') || '').toUpperCase();
      const start = [tx?.ticker, ticker, want, coins[0]?.ticker].find(x => x && coins.some(c => c.ticker === x)) || '';
      const picker = coinPicker(coinBtn, { coins, live, value: start, placeholder: 'Choose a coin' });
      const coinField = el('div', 'fld'); coinField.append(el('span', '', 'Coin'), coinBtn);

      const amount = textInput(tx ? inputText(tx.amount) : '', { inputMode: 'decimal', placeholder: '0.00' });
      const price = textInput(tx?.price != null ? inputText(tx.price * currency.rate) : '', { inputMode: 'decimal', placeholder: 'Optional' });
      const priceF = field(`Price each (${currency.code})`, price);
      const mkt = el('button', 'px-link px-mkt', 'Use market price'); mkt.type = 'button';
      mkt.addEventListener('click', () => {
        const px = live.get(picker.get())?.price;
        if (px) price.value = inputText(px * currency.rate); else toast('No live price for that coin right now.');
      });
      priceF.append(mkt);
      const fee = textInput(tx?.fee ? inputText(tx.fee * currency.rate) : '', { inputMode: 'decimal', placeholder: '0' });
      const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const today = new Date();
      const day = el('input'); day.type = 'date'; day.max = iso(today); day.value = iso(tx ? new Date(tx.ts) : today);
      const note = textInput(tx?.note || '', { maxLength: LIMITS.note, placeholder: 'Optional' });
      const err = el('p', 's-error'); err.hidden = true; err.setAttribute('role', 'alert');
      const row2 = el('div', 'px-row2'); row2.append(field('Amount', amount), priceF);
      const row3 = el('div', 'px-row2'); row3.append(field(`Fee (${currency.code})`, fee), field('Date', day));
      form.append(seg, coinField, row2, row3, field('Note', note), err, go);
      if (editing) {
        const del = el('button', 'btn btn-ghost px-del', 'Delete transaction'); del.type = 'button';
        let armed = null;
        del.addEventListener('click', () => {
          if (!armed) { del.textContent = 'Tap again to confirm'; armed = setTimeout(() => { armed = null; del.textContent = 'Delete transaction'; }, 4000); return; }
          clearTimeout(armed);
          const f = folio(); f.tx = f.tx.filter(x => x.id !== tx.id); save(); api.close();
        });
        form.append(del);
      }
      form.addEventListener('submit', e => {
        e.preventDefault();
        const fail = m => { err.textContent = m; err.hidden = false; };
        err.hidden = true;
        const a = parse(amount.value);
        if (!(a > 0) || !Number.isFinite(a)) return fail('Enter an amount greater than zero.');
        let px = null;
        if (price.value.trim()) { px = parse(price.value); if (!(px >= 0) || !Number.isFinite(px)) return fail('Enter the price as a number, or leave it empty.'); px /= currency.rate; }
        let fe = 0;
        if (fee.value.trim()) { fe = parse(fee.value); if (!(fe >= 0) || !Number.isFinite(fe)) return fail('Enter the fee as a number, or leave it empty.'); fe /= currency.rate; }
        if (!day.value) return fail('Choose a date.');
        const keepTime = tx && day.value === iso(new Date(tx.ts));
        const ts = keepTime ? tx.ts : day.value === iso(today) ? Date.now() : new Date(day.value + 'T12:00:00').getTime();
        const next = cleanTx({ id: tx?.id, t: type, ticker: picker.get(), amount: a, price: px, fee: fe, ts, note: note.value.trim() }, tickers);
        if (!next) return fail('Choose a coin first.');
        const f = folio();
        if (!editing && f.tx.length >= LIMITS.tx) return fail('This portfolio is full. Export it and start another.');
        const list = editing ? f.tx.map(x => (x.id === tx.id ? next : x)) : [...f.tx, next];
        if ([...positions(list).values()].some(q => q.oversold)) {
          const held = positions(editing ? f.tx.filter(x => x.id !== tx.id) : f.tx).get(next.ticker)?.amount || 0;
          return fail(type === 'sell' ? `You only hold ${amountText(held)} ${next.ticker} on that date.` : 'That change would leave a later sale larger than what you held.');
        }
        f.tx = list;
        save();
        api.close();
        toast(editing ? 'Saved.' : type === 'buy' ? `Added ${amountText(a)} ${next.ticker}.` : `Sold ${amountText(a)} ${next.ticker}.`, { ms: 2800 });
        if (location.search.includes('coin=')) history.replaceState(history.state, '', location.pathname);
      });
      body.append(form);
      if (matchMedia('(min-width: 821px)').matches) amount.focus();
    },
  });
}

// ---------- start ----------
async function boot() {
  coins = await initChrome();
  tickers = new Set(coins.map(c => c.ticker));
  S = ledger.load();
  // Settle the first visit on 3.4 right away (older holdings become opening buys) so the portfolio keeps one stable id.
  if (!store.get('cm-pf2')) ledger.save(S);
  render();

  document.addEventListener('cm:holdings', () => { S = ledger.load(); render(); });
  onCurrency(render);
  $('px-add').addEventListener('click', () => openTxForm());
  $('px-first').addEventListener('click', () => openTxForm());
  $('px-more').addEventListener('click', openMore);
  $('px-eye').addEventListener('click', () => { S.hide = !S.hide; save(); });
  $('px-act-all').addEventListener('click', () => { showAllAct = !showAllAct; render(); });
  $('px-range').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; range = b.dataset.r; setTabs($('px-range'), 'r', range); render(); });
  $('px-sort').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; sortKey = b.dataset.s; setTabs($('px-sort'), 's', sortKey); render(); });
  $('px-import-empty').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; });

  if (new URLSearchParams(location.search).get('coin')) openTxForm();

  if (!API) return;
  loadMarket().then(m => { mk = m.coins; render(); }).catch(() => {});
  pollPrices(data => {
    for (const c of data.coins) live.set(c.ticker, c);
    render();
  });
}
boot();
