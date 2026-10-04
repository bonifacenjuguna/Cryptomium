// Shared pieces: config, storage, preferences, currency, favourites, the live price
// connection, formatting, the header (menu, search, price tape) and small DOM helpers.

const CFG = window.CRYPTOMIUM || {};
export const API = String(CFG.apiUrl || '').replace(/\/+$/, '');
export const CHANNEL_URL = CFG.channelUrl || '#';

// ---------- Safe storage (private windows can throw) ----------
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* not available */ } },
};

// ---------- API ----------
export async function getJSON(path, { timeoutMs = 12000 } = {}) {
  if (!API) throw new Error('No API address configured.');
  const res = await fetch(API + path, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export async function getCoinList() {
  const res = await fetch('/coins.json');
  return res.json();
}

/**
 * Keeps prices live. Opens a stream (server-sent events) so the server pushes every
 * new reading the moment it exists, about every two seconds. If the stream is blocked or
 * goes quiet, a plain request fills the gap, so the page keeps moving either way.
 * Quiet by design: failures never throw at the visitor, the last prices stay on screen.
 * Every reading is also announced as a "cm:prices" event for anything else that listens
 * (the price tape, price alerts).
 */
export function pollPrices(onData, onState) {
  let es = null;
  let watchdog = null;
  let lastMsg = 0;
  let everOk = 0;
  let busy = false;

  const deliver = data => {
    if (!data || !Array.isArray(data.coins)) return;
    lastMsg = Date.now();
    everOk = lastMsg;
    document.dispatchEvent(new CustomEvent('cm:prices', { detail: data }));
    onData(data);
    onState('live');
  };
  const closeStream = () => { if (es) { es.close(); es = null; } };
  const openStream = () => {
    closeStream();
    if (!API || typeof EventSource === 'undefined') return;
    es = new EventSource(API + '/api/stream');
    es.onmessage = e => { try { deliver(JSON.parse(e.data)); } catch { /* ignore a bad frame */ } };
    // EventSource reconnects by itself; the watchdog below covers the gap.
  };
  async function fetchOnce() {
    if (busy) return;
    busy = true;
    try { deliver(await getJSON('/api/prices', { timeoutMs: 8000 })); } catch { /* the watchdog tries again */ } finally { busy = false; }
  }
  function check() {
    if (document.hidden) return;
    const quiet = Date.now() - lastMsg;
    if (quiet > 7000) fetchOnce();
    if (quiet > 7000 && es && es.readyState === 2) openStream();
    if (quiet > 25000) onState(everOk ? 'reconnecting' : 'connecting');
  }
  const start = () => {
    openStream();
    clearInterval(watchdog);
    watchdog = setInterval(check, 3000);
    fetchOnce(); // the first numbers should not wait for the stream to open
  };
  const stop = () => { closeStream(); clearInterval(watchdog); };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  window.addEventListener('online', () => { if (!document.hidden) start(); });
  start();
}

export function setLive(el, state) {
  if (!el) return;
  el.dataset.state = state;
  el.textContent = state === 'live' ? 'Live' : state === 'reconnecting' ? 'Reconnecting' : 'Connecting';
}

// ---------- Preferences ----------
export const PREF_DEFAULTS = {
  theme: 'auto', // auto | light | dark
  accent: 'citrine',
  density: 'comfortable', // comfortable | compact
  flash: true, // prices tint briefly when they tick
  motion: true, // the price tape and other movement
  chartType: 'line', // line | candles
  chartRange: '7d',
  homeTab: 'all',
};
let prefData = { ...PREF_DEFAULTS };
try { Object.assign(prefData, JSON.parse(store.get('cm-prefs') || '{}')); } catch { /* start from defaults */ }
if (!['auto', 'light', 'dark'].includes(prefData.theme)) prefData.theme = 'auto';
{
  const legacy = store.get('cm-theme');
  if (!store.get('cm-prefs') && (legacy === 'light' || legacy === 'dark')) prefData.theme = legacy;
}
const prefListeners = new Set();
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function applyPrefs() {
  const root = document.documentElement;
  const theme = prefData.theme === 'auto' ? (systemDark.matches ? 'dark' : 'light') : prefData.theme;
  const changed = root.dataset.theme !== theme;
  root.dataset.theme = theme;
  root.dataset.accent = prefData.accent;
  root.dataset.density = prefData.density;
  if (prefData.motion === false) root.dataset.motion = 'off'; else delete root.dataset.motion;
  if (changed) document.dispatchEvent(new CustomEvent('themechange'));
}
export const prefs = {
  get: key => prefData[key],
  all: () => ({ ...prefData }),
  set(key, value) {
    prefData[key] = value;
    store.set('cm-prefs', JSON.stringify(prefData));
    applyPrefs();
    prefListeners.forEach(fn => fn(key, value));
  },
  replace(next) {
    prefData = { ...PREF_DEFAULTS, ...next };
    store.set('cm-prefs', JSON.stringify(prefData));
    applyPrefs();
    prefListeners.forEach(fn => fn('*', null));
  },
  reset() { this.replace({}); },
  onChange: fn => prefListeners.add(fn),
};
export function initTheme() {
  applyPrefs();
  systemDark.addEventListener('change', () => { if (prefData.theme === 'auto') applyPrefs(); });
}

// ---------- Small messages (toasts) ----------
export function toast(text, { kind = 'info', ms = 6000, href = '' } = {}) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', 'toasts');
    host.id = 'toasts';
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const t = href ? el('a', 'toast ' + kind) : el('div', 'toast ' + kind);
  if (href) t.href = href;
  t.append(el('span', 'toast-dot'), el('span', 'toast-text', text));
  host.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const done = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); };
  setTimeout(done, ms);
  t.addEventListener('click', () => { if (!href) done(); });
  while (host.children.length > 3) host.firstChild.remove();
}

/** Sets a number's text and, if it moved since last time, tints it briefly green or red. */
export function setNum(node, text, value) {
  if (!node) return;
  const prev = node._v;
  node._v = value;
  if (node.textContent === text) return;
  node.textContent = text;
  if (prefData.flash && typeof prev === 'number' && typeof value === 'number' && value !== prev) {
    node.classList.remove('tick-up', 'tick-down');
    void node.offsetWidth; // restart the animation
    node.classList.add(value > prev ? 'tick-up' : 'tick-down');
  }
}

// ---------- Currency ----------
const SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', KES: 'KSh\u00a0', NGN: '₦', ZAR: 'R\u00a0', GHS: 'GH₵', UGX: 'USh\u00a0', TZS: 'TSh\u00a0',
  INR: '₹', AED: 'AED\u00a0', CAD: 'C$', AUD: 'A$', JPY: '¥', BRL: 'R$',
};
export const currency = { code: 'USD', rate: 1, rates: { USD: 1 } };
const currencyListeners = new Set();
export const onCurrency = fn => currencyListeners.add(fn);
const wanted = () => (store.get('cm-currency') || 'USD').toUpperCase();

function applyCurrency() {
  const code = currency.rates[wanted()] ? wanted() : 'USD';
  currency.code = code;
  currency.rate = currency.rates[code] || 1;
  const select = document.getElementById('currency');
  if (select) {
    const codes = Object.keys(currency.rates);
    if (select.options.length !== codes.length) select.replaceChildren(...codes.map(c => new Option(c, c)));
    select.value = code;
  }
  currencyListeners.forEach(fn => fn());
}

export function initCurrency() {
  document.getElementById('currency')?.addEventListener('change', e => setCurrency(e.target.value));
  applyCurrency();
}
export function setCurrency(code) {
  store.set('cm-currency', code);
  applyCurrency();
}
export const CURRENCY_NAMES = {
  USD: 'US dollar', EUR: 'Euro', GBP: 'British pound', KES: 'Kenyan shilling', NGN: 'Nigerian naira', ZAR: 'South African rand',
  GHS: 'Ghanaian cedi', UGX: 'Ugandan shilling', TZS: 'Tanzanian shilling', INR: 'Indian rupee', AED: 'UAE dirham',
  CAD: 'Canadian dollar', AUD: 'Australian dollar', JPY: 'Japanese yen', BRL: 'Brazilian real',
};
export const currencySymbol = code => (SYMBOLS[code] || code + '\u00a0').trim();

export function setRates(rates) {
  if (rates && rates.USD === 1) currency.rates = rates;
  applyCurrency();
}

// ---------- Formatting (one precision rule everywhere, like the Telegram banners) ----------
function decimalsFor(v, stable) {
  if (stable) return 3;
  if (v >= 10000) return 0;
  if (v >= 1) return 2;
  if (v >= 0.01) return 3;
  return Math.min(12, Math.ceil(-Math.log10(v)) + 3);
}

function numberText(v, stable) {
  let text = v.toFixed(decimalsFor(v, stable));
  if (!stable && v < 0.01 && text.includes('.')) {
    const [w, f] = text.split('.');
    text = w + '.' + f.replace(/0+$/, '').padEnd(4, '0');
  }
  const [whole, frac] = text.split('.');
  const grouped = Number(whole).toLocaleString('en-US');
  return frac === undefined ? grouped : grouped + '.' + frac;
}

const sym = () => SYMBOLS[currency.code] || currency.code + '\u00a0';

export function money(usd, { stable = false } = {}) {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return '–';
  return sym() + numberText(usd * currency.rate, stable);
}

const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
export function compactMoney(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return '–';
  return sym() + compactFmt.format(usd * currency.rate);
}

export function pct(change) {
  if (typeof change !== 'number' || !Number.isFinite(change)) return { text: '–', cls: 'flat' };
  const r = Math.round(change * 100) / 100;
  if (r === 0) return { text: '0.00%', cls: 'flat' };
  return { text: (r > 0 ? '+' : '−') + Math.abs(r).toFixed(2) + '%', cls: r > 0 ? 'up' : 'down' };
}

export function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}

// ---------- Favourites ----------
const favs = new Set((() => { try { return JSON.parse(store.get('cm-favs') || '[]'); } catch { return []; } })());
const favListeners = new Set();
export const isFav = t => favs.has(t);
export const favCount = () => favs.size;
export const onFavs = fn => favListeners.add(fn);
export function toggleFav(ticker) {
  favs.has(ticker) ? favs.delete(ticker) : favs.add(ticker);
  store.set('cm-favs', JSON.stringify([...favs]));
  favListeners.forEach(fn => fn(ticker));
}

// ---------- DOM helpers ----------
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function logoEl(coin, size = '') {
  const wrap = el('div', 'logo' + (size ? ' ' + size : ''));
  const monogram = () => wrap.replaceChildren(document.createTextNode(coin.ticker.slice(0, 4)));
  if (coin.logo) {
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = API + coin.logo;
    img.onerror = monogram;
    wrap.append(img);
  } else {
    monogram();
  }
  return wrap;
}

/** Tint strength for a tile: 0 (flat) to .32 (a move of 6% or more). */
export function heat(change) {
  if (typeof change !== 'number' || !Number.isFinite(change)) return 0;
  return Math.min(1, Math.abs(change) / 6) * 0.32;
}

export function tileEl(coin, i = 0) {
  const a = el('a', 'tile');
  a.href = '/coin/' + coin.ticker;
  a.style.setProperty('--i', i);
  a.dataset.ticker = coin.ticker;
  const sym = el('span', 't-sym', coin.ticker);
  const chg = el('span', 't-chg num', '');
  const name = el('span', 't-name', coin.name);
  const price = el('span', 't-price num', '');
  a.append(sym, chg, name, price);
  return { a, chg, price };
}

export function paintTile(t, coin) {
  const c = pct(coin.change24h);
  setNum(t.price, money(coin.price, { stable: coin.stable }), coin.price);
  t.chg.textContent = c.text;
  t.a.classList.remove('up', 'down', 'flat', 'skeleton');
  t.a.classList.add(c.cls);
  t.a.style.setProperty('--a', heat(coin.change24h).toFixed(3));
  t.a.setAttribute('aria-label', `${coin.name}, ${money(coin.price, { stable: coin.stable })}, ${c.text} in 24 hours`);
}

export const DIR_SVG = {
  up: '<svg viewBox="0 0 12 11" aria-hidden="true"><path d="M6 0l6 11H0z"/></svg>',
  down: '<svg viewBox="0 0 12 11" aria-hidden="true"><path d="M6 11L0 0h12z"/></svg>',
};

// ---------- Header: search ----------
function initSearch(coins) {
  const box = document.getElementById('search');
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-list');
  const toggle = document.getElementById('search-toggle');
  if (!box || !input || !list) return;
  let results = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const go = c => { location.href = '/coin/' + c.ticker; };
  const paint = () => {
    list.replaceChildren();
    results.forEach((c, i) => {
      const li = el('li');
      li.id = 'sr-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.append(el('span', 's-sym', c.ticker), el('span', 's-name', c.name));
      li.addEventListener('mousedown', e => { e.preventDefault(); go(c); });
      list.append(li);
    });
    if (!results.length && input.value.trim()) list.append(el('li', 'search-empty', 'No coin matches that.'));
    list.hidden = !input.value.trim();
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (active >= 0) input.setAttribute('aria-activedescendant', 'sr-' + active); else input.removeAttribute('aria-activedescendant');
  };
  const run = () => {
    const q = input.value.trim().toLowerCase();
    results = q
      ? coins
          .map(c => {
            const t = c.ticker.toLowerCase(), n = c.name.toLowerCase();
            const score = t === q ? 0 : t.startsWith(q) ? 1 : n.startsWith(q) ? 2 : t.includes(q) || n.includes(q) ? 3 : 9;
            return { c, score };
          })
          .filter(x => x.score < 9)
          .sort((a, b) => a.score - b.score)
          .slice(0, 6)
          .map(x => x.c)
      : [];
    active = results.length ? 0 : -1;
    paint();
  };

  input.addEventListener('input', run);
  input.addEventListener('focus', run);
  input.addEventListener('blur', () => { close(); box.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); active = (active + 1) % results.length; paint(); }
    else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); active = (active - 1 + results.length) % results.length; paint(); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]); }
    else if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
  });
  toggle?.addEventListener('click', () => {
    const open = !box.classList.contains('open');
    box.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    if (getComputedStyle(input).display === 'none') toggle?.click(); else input.focus();
  });
}

// ---------- Header: phone menu ----------
function initMenu() {
  const btn = document.getElementById('menu-toggle');
  const menu = document.getElementById('menu');
  if (!btn || !menu) return;
  const set = open => {
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  btn.addEventListener('click', () => {
    const open = !menu.classList.contains('open');
    if (open) document.getElementById('search')?.classList.remove('open');
    set(open);
  });
  menu.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', () => set(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('open')) { set(false); btn.focus(); } });
  document.addEventListener('click', e => {
    if (menu.classList.contains('open') && !menu.contains(e.target) && !btn.contains(e.target)) set(false);
  });
  matchMedia('(min-width: 821px)').addEventListener('change', e => { if (e.matches) set(false); });
  document.getElementById('search-toggle')?.addEventListener('click', () => set(false));
}

// ---------- Header: current page highlight + boot ----------
// ---------- Price tape (a slim live strip under the header) ----------
function initTape(coins) {
  const host = document.getElementById('tape');
  if (!host || !coins.length) return;
  const cells = new Map(); // ticker -> [{ price, chg }]
  const track = el('div', 'tape-track');
  for (let copy = 0; copy < 2; copy++) {
    const group = el('div', 'tape-group');
    if (copy) group.setAttribute('aria-hidden', 'true');
    for (const c of coins) {
      const a = el('a', 'tape-item');
      a.href = '/coin/' + c.ticker;
      a.tabIndex = -1;
      const price = el('span', 'tape-price num', '');
      const chg = el('span', 'tape-chg num', '');
      a.append(el('b', 'tape-sym', c.ticker), price, chg);
      group.append(a);
      if (!cells.has(c.ticker)) cells.set(c.ticker, []);
      cells.get(c.ticker).push({ a, price, chg });
    }
    track.append(group);
  }
  host.replaceChildren(track);
  document.addEventListener('cm:prices', e => {
    for (const coin of e.detail.coins) {
      const slots = cells.get(coin.ticker);
      if (!slots || !coin.price) continue;
      const ch = pct(coin.change24h);
      for (const s of slots) {
        setNum(s.price, money(coin.price, { stable: coin.stable }), coin.price);
        s.chg.textContent = ch.text === '–' ? '' : ch.text;
        s.chg.className = 'tape-chg num ' + ch.cls;
      }
    }
    host.classList.add('ready');
  });
  onCurrency(() => { /* prices repaint on the next reading */ });
}

export async function initChrome() {
  initTheme();
  initCurrency();
  initMenu();
  const path = location.pathname.replace(/\/$/, '');
  if (path === '/about') document.querySelector('[data-nav="about"]')?.setAttribute('aria-current', 'page');
  if (path.startsWith('/settings')) document.querySelector('[data-nav="settings"]')?.setAttribute('aria-current', 'page');
  let coins = [];
  try { coins = await getCoinList(); } catch { /* search just stays empty */ }
  initSearch(coins);
  initTape(coins);
  // Exchange rates arrive quietly; the currency follows when they do.
  getJSON('/api/rates').then(r => setRates(r.rates)).catch(() => {});
  import('./targets.js').then(m => m.start()).catch(() => {});
  return coins;
}
