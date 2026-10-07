// Converter: any coin or currency on either side, at the live price. Uses the app's own pickers (no system dropdowns).
import { initChrome, pollPrices, el, logoEl, money, store, currency, onCurrency, currencySymbol, CURRENCY_NAMES, API } from './common.js';
import { openSheet } from './ui.js';

const $ = id => document.getElementById(id);
const KEY = 'cm-convert';
const state = { coins: [], live: new Map(), from: 'coin:BTC', to: 'fiat:USD', amount: '1' };
const OTHERS = ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR', 'INR', 'JPY'];
const COMMON = ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR'];

const kindOf = v => v.split(':')[0];
const idOf = v => v.split(':')[1];
const logoOf = t => state.live.get(t) || { ticker: t };

/** How many US dollars one unit of this side is worth, or null while that is not known yet. */
function usdPer(v) {
  if (kindOf(v) === 'coin') { const p = state.live.get(idOf(v))?.price; return p > 0 ? p : null; }
  const r = currency.rates[idOf(v)];
  return r > 0 ? 1 / r : null;
}
const num = x => Number(String(x).replace(/,/g, '').trim());
function fmt(value, kind) {
  if (!Number.isFinite(value)) return '–';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const digits = kind === 'fiat' ? (abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8) : (abs >= 1000 ? 4 : abs >= 1 ? 6 : 8);
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}
const label = v => idOf(v);

function sideButton(btn, v) {
  btn.replaceChildren();
  if (kindOf(v) === 'coin') btn.append(logoEl(logoOf(idOf(v)), 'sm'));
  else btn.append(el('span', 'cc-sym', currencySymbol(idOf(v)).slice(0, 4)));
  const t = el('span', 'cvp-pick-t');
  t.append(el('b', '', label(v)), el('span', '', kindOf(v) === 'coin' ? (state.coins.find(c => c.ticker === idOf(v))?.name || '') : (CURRENCY_NAMES[idOf(v)] || '')));
  btn.append(t, el('span', 'sel-chev'));
  btn.setAttribute('aria-label', (btn.id === 'cvp-from-btn' ? 'Convert from ' : 'Convert to ') + label(v));
}

function paint() {
  sideButton($('cvp-from-btn'), state.from);
  sideButton($('cvp-to-btn'), state.to);
  const a = usdPer(state.from), b = usdPer(state.to);
  const amount = num(state.amount);
  const out = $('cvp-result');
  const ready = a && b;
  out.textContent = ready && Number.isFinite(amount) && state.amount.trim() !== '' ? fmt((amount * a) / b, kindOf(state.to)) : '–';
  out.classList.toggle('is-wide', out.textContent.length > 12);
  $('cvp-rate').textContent = ready ? `1 ${label(state.from)} = ${fmt(a / b, kindOf(state.to))} ${label(state.to)}` : (API ? 'Loading the live price…' : '');
  paintOthers(ready ? (Number.isFinite(amount) ? amount : 0) * a : null);
}

function paintOthers(usd) {
  const box = $('cvp-more'), list = $('cvp-list');
  const codes = OTHERS.filter(c => currency.rates[c] && c !== idOf(state.to) && !(kindOf(state.from) === 'fiat' && c === idOf(state.from)));
  box.hidden = usd == null || !codes.length;
  if (box.hidden) return;
  list.replaceChildren(...codes.map(c => {
    const li = el('li', 'cvp-li');
    li.append(el('span', 'cc-sym', currencySymbol(c).slice(0, 4)));
    const t = el('span', 'cvp-li-t'); t.append(el('b', '', c), el('span', '', CURRENCY_NAMES[c] || ''));
    li.append(t, el('span', 'num cvp-li-v', fmt(usd * currency.rates[c], 'fiat')));
    return li;
  }));
}

function items() {
  const out = state.coins.map(c => {
    const l = state.live.get(c.ticker);
    return { value: 'coin:' + c.ticker, title: c.ticker, sub: c.name, group: 'Coins', lead: () => logoEl(logoOf(c.ticker), 'sm'), trail: l?.price ? money(l.price, { stable: l.stable }) : '' };
  });
  const known = Object.keys(currency.rates).length > 1;
  const all = Object.keys(CURRENCY_NAMES);
  const ordered = [...COMMON.filter(c => all.includes(c)), ...all.filter(c => !COMMON.includes(c))];
  const fiat = ordered.map(code => {
    const off = known && !currency.rates[code];
    return { value: 'fiat:' + code, title: code, sub: CURRENCY_NAMES[code] + (off ? ' (not available right now)' : ''), disabled: off, group: 'Currencies', lead: () => el('span', 'cc-sym', currencySymbol(code).slice(0, 4)) };
  });
  return [...fiat, ...out];
}

function choose(side) {
  const btn = $(side === 'from' ? 'cvp-from-btn' : 'cvp-to-btn');
  openSheet({
    title: side === 'from' ? 'Convert from' : 'Convert to', searchLabel: 'Search coins and currencies', trigger: btn, value: state[side],
    empty: 'Nothing matches that.', items: items(),
    onPick: v => { state[side] = v; if (state.from === state.to) state[side === 'from' ? 'to' : 'from'] = kindOf(v) === 'coin' ? 'fiat:USD' : 'coin:BTC'; chips(); save(); paint(); },
  });
}

function save() {
  try { store.set(KEY, JSON.stringify({ from: state.from, to: state.to })); } catch { /* private mode */ }
  try { history.replaceState(null, '', `/convert?from=${label(state.from)}&to=${label(state.to)}&amount=${encodeURIComponent(state.amount)}`); } catch { /* ignore */ }
}

function chips() {
  const box = $('cvp-chips');
  const list = kindOf(state.from) === 'coin' ? ['0.1', '1', '10', '100'] : ['10', '100', '1000', '10000'];
  box.replaceChildren(...list.map(v => {
    const b = el('button', 'al-chip', v); b.type = 'button';
    b.addEventListener('click', () => { state.amount = v; $('cvp-amount').value = v; save(); paint(); });
    return b;
  }));
}

// A side can be written as COIN BTC / currency USD in the address: /convert?from=BTC&to=KES&amount=2
function fromQuery(raw, fallback) {
  const t = String(raw || '').toUpperCase();
  if (state.coins.some(c => c.ticker === t)) return 'coin:' + t;
  if (CURRENCY_NAMES[t]) return 'fiat:' + t;
  return fallback;
}

async function boot() {
  state.coins = await initChrome();
  let saved = {};
  try { saved = JSON.parse(store.get(KEY) || '{}') || {}; } catch { /* defaults */ }
  const q = new URLSearchParams(location.search);
  state.from = fromQuery(q.get('from'), saved.from && fromQuery(idOf(saved.from), '') || 'coin:BTC');
  state.to = fromQuery(q.get('to'), saved.to && fromQuery(idOf(saved.to), '') || 'fiat:' + (CURRENCY_NAMES[currency.code] ? currency.code : 'USD'));
  if (state.from === state.to) state.to = kindOf(state.from) === 'coin' ? 'fiat:USD' : 'coin:BTC';
  const amt = q.get('amount');
  if (amt && Number.isFinite(num(amt))) state.amount = amt;
  $('cvp-amount').value = state.amount;
  $('cvp-amount').addEventListener('input', e => { state.amount = e.target.value; paint(); });
  $('cvp-amount').addEventListener('change', save);
  $('cvp-from-btn').addEventListener('click', () => choose('from'));
  $('cvp-to-btn').addEventListener('click', () => choose('to'));
  $('cvp-swap').addEventListener('click', () => { [state.from, state.to] = [state.to, state.from]; chips(); save(); paint(); });
  chips(); paint();
  onCurrency(paint);
  if (!API) return;
  pollPrices(d => { for (const c of d.coins) state.live.set(c.ticker, c); paint(); });
}
boot();
