// Converter: any coin or currency into any other, at the live prices the rest of the app uses.
import { initChrome, pollPrices, currency, onCurrency, currencySymbol, CURRENCY_NAMES, el, logoEl, toast } from './common.js';
import { openSheet } from './ui.js';

initChrome();
const $ = id => document.getElementById(id);
const KEY = 'cm-converter';
const live = new Map();
let stale = false;

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private mode */ } };
let st = read();
if (!st || !st.from || !st.to) st = { from: { k: 'coin', c: 'BTC' }, to: { k: 'fiat', c: currency.code }, amt: '1' };
st.amt = String(st.amt ?? '1');

const same = (a, b) => a.k === b.k && a.c === b.c;
/** What one unit is worth in US dollars (the common ruler), or null when we do not know yet. */
function usd(a) {
  if (a.k === 'coin') { const c = live.get(a.c); return c && c.price > 0 ? c.price : null; }
  const r = currency.rates[a.c];
  return r > 0 ? 1 / r : null;
}
const num = text => { const n = Number(String(text).replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };
function fmt(v) {
  if (!Number.isFinite(v)) return '\u2013';
  if (v === 0) return '0';
  const a = Math.abs(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8 });
}
const label = a => a.c;

function assetFace(a) {
  const f = el('span', 'cv-face');
  if (a.k === 'coin') f.append(logoEl(live.get(a.c) || { ticker: a.c, logo: null }, 'sm'));
  else f.append(el('span', 'cc-sym', currencySymbol(a.c).slice(0, 4)));
  return f;
}
function paintAsset(btn, a) {
  const t = el('span', 'cv-code', label(a));
  const chev = el('span', 'sel-chev');
  btn.replaceChildren(assetFace(a), t, chev);
}

function paint() {
  paintAsset($('cv-from'), st.from);
  paintAsset($('cv-to'), st.to);
  const f = usd(st.from), t = usd(st.to);
  const amt = num(st.amt || '0');
  const ok = f && t;
  $('cv-out').textContent = ok && Number.isFinite(amt) ? fmt((amt * f) / t) : '\u2013';
  $('cv-rate').textContent = ok
    ? `1 ${label(st.from)} = ${fmt(f / t)} ${label(st.to)}${stale ? '. Showing saved prices.' : ''}`
    : 'Loading prices\u2026';
  // quick amounts
  $('cv-amts').replaceChildren(...['1', '10', '100', '1000'].map(v => {
    const b = el('button', 'al-chip', Number(v).toLocaleString('en-US'));
    b.type = 'button';
    b.addEventListener('click', () => { st.amt = v; $('cv-amt').value = v; write(); paint(); });
    return b;
  }));
  // quick pairs
  const cur = { k: 'fiat', c: currency.code };
  const pairs = [
    [{ k: 'coin', c: 'BTC' }, cur], [{ k: 'coin', c: 'ETH' }, cur], [cur, { k: 'coin', c: 'BTC' }], [{ k: 'coin', c: 'BTC' }, { k: 'coin', c: 'ETH' }], [{ k: 'coin', c: 'SOL' }, cur],
  ].filter(([a, b]) => !same(a, b) && [a, b].every(x => x.k === 'fiat' || live.has(x.c)));
  $('cv-pairs').replaceChildren(...pairs.map(([a, b]) => {
    const btn = el('button', 'al-chip', `${a.c} \u2192 ${b.c}`);
    btn.type = 'button';
    btn.addEventListener('click', () => { st.from = a; st.to = b; write(); paint(); });
    return btn;
  }));
}

function choose(which) {
  const btn = $(which === 'from' ? 'cv-from' : 'cv-to');
  const coins = [...live.values()].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const codes = Object.keys(currency.rates);
  const items = [
    ...coins.map(c => ({ value: 'coin:' + c.ticker, title: c.ticker, sub: c.name || '', group: 'Crypto', lead: () => logoEl(c, 'sm') })),
    ...codes.map(code => ({ value: 'fiat:' + code, title: code, sub: CURRENCY_NAMES[code] || '', group: 'Currencies', lead: () => el('span', 'cc-sym', currencySymbol(code).slice(0, 4)) })),
  ];
  openSheet({
    title: which === 'from' ? 'You have' : 'You want',
    items, trigger: btn, value: `${st[which].k}:${st[which].c}`, searchLabel: 'Search coins and currencies',
    onPick: v => {
      const [k, c] = v.split(':');
      const next = { k, c };
      const other = which === 'from' ? 'to' : 'from';
      if (same(next, st[other])) st[other] = st[which]; // picking what the other side has swaps them
      st[which] = next;
      write(); paint();
    },
  });
}

$('cv-amt').value = st.amt;
$('cv-amt').addEventListener('input', e => {
  const clean = e.target.value.replace(/[^0-9.,]/g, '');
  if (clean !== e.target.value) e.target.value = clean;
  st.amt = clean; write(); paint();
});
$('cv-from').addEventListener('click', () => choose('from'));
$('cv-to').addEventListener('click', () => choose('to'));
$('cv-swap').addEventListener('click', () => { [st.from, st.to] = [st.to, st.from]; write(); paint(); });
$('cv-copy').addEventListener('click', async () => {
  const text = $('cv-out').textContent.replace(/,/g, '');
  try { await navigator.clipboard.writeText(text); toast('Copied ' + $('cv-out').textContent, { ms: 2200 }); } catch { toast('Could not copy here.', { ms: 2200 }); }
});
onCurrency(() => { if (st.to.k === 'fiat' && !currency.rates[st.to.c]) st.to = { k: 'fiat', c: currency.code }; paint(); });

pollPrices(d => {
  for (const c of d.coins) live.set(c.ticker, c);
  stale = Boolean(d.stale);
  paint();
}, () => {});
paint();
