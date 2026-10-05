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

// ---------- One-time rename: TON became GRAM (June 2026) ----------
// Saved favourites, recent searches, portfolio holdings and price alerts that still say TON are moved over.
(function migrateRenamedTickers() {
  const RENAMES = { TON: 'GRAM' };
  const fix = t => (typeof t === 'string' && RENAMES[t]) || t;
  const rewrite = (key, map) => {
    const raw = store.get(key);
    if (!raw || !/"TON"/.test(raw)) return;
    try { store.set(key, JSON.stringify(map(JSON.parse(raw)))); } catch { /* leave it as it was */ }
  };
  const uniq = list => [...new Set(list)];
  rewrite('cm-favs', list => uniq(list.map(fix)));
  rewrite('cm-recent', list => uniq(list.map(fix)));
  rewrite('cm-portfolio', list => list.map(h => (h && h.ticker ? { ...h, ticker: fix(h.ticker) } : h)));
  rewrite('cm-targets', list => list.map(t => (t && t.ticker ? { ...t, ticker: fix(t.ticker) } : t)));
})();

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
 * Keeps prices live. One shared connection per page: it opens a stream (server-sent events)
 * so the server pushes every new reading the moment it exists, about every two seconds.
 * If the stream is blocked or goes quiet, a plain request fills the gap, so the page keeps
 * moving either way. Quiet by design: failures never throw at the visitor, the last prices
 * stay on screen. Every reading is also announced as a "cm:prices" event (price tape, footer,
 * price alerts). Pages subscribe with pollPrices(); the header starts the connection so the
 * tape is live on every page, not only the ones that show prices.
 */
const feed = { dataFns: new Set(), stateFns: new Set(), last: null, state: 'connecting', started: false };

function ensureFeed() {
  if (feed.started || !API) return;
  feed.started = true;
  let es = null;
  let watchdog = null;
  let lastMsg = 0;
  let everOk = 0;
  let busy = false;
  const setState = st => { feed.state = st; feed.stateFns.forEach(fn => fn(st)); };

  const deliver = data => {
    if (!data || !Array.isArray(data.coins)) return;
    lastMsg = Date.now();
    everOk = lastMsg;
    feed.last = data;
    document.dispatchEvent(new CustomEvent('cm:prices', { detail: data }));
    feed.dataFns.forEach(fn => fn(data));
    setState('live');
  };
  const closeStream = () => { if (es) { es.close(); es = null; } };
  const openStream = () => {
    closeStream();
    if (typeof EventSource === 'undefined') return;
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
    if (quiet > 25000) setState(everOk ? 'reconnecting' : 'connecting');
  }
  const saver = prefData.liveMode === 'saver';
  const start = () => {
    clearInterval(watchdog);
    if (saver) {
      // Data saver: no always-open connection, one plain request every fifteen seconds.
      watchdog = setInterval(() => { if (!document.hidden) fetchOnce(); }, 15000);
      fetchOnce();
      return;
    }
    openStream();
    watchdog = setInterval(check, 3000);
    fetchOnce(); // the first numbers should not wait for the stream to open
  };
  const stop = () => { closeStream(); clearInterval(watchdog); };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  window.addEventListener('online', () => { if (!document.hidden) start(); });
  start();
}

export function pollPrices(onData, onState = () => {}) {
  feed.dataFns.add(onData);
  feed.stateFns.add(onState);
  ensureFeed();
  if (feed.last) onData(feed.last);
  onState(feed.state);
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
  density: 'auto', // auto (compact on phones) | comfortable | compact
  flash: false, // prices tint briefly green or red when they tick (off unless the visitor turns it on)
  motion: true, // animations and movement across the site
  tape: true, // the live market bar under the header
  chartType: 'line', // line | candles
  chartRange: '7d',
  homeTab: 'all',
  textSize: 'default', // default | large | larger
  palette: 'classic', // classic (green/red) | clear (blue/orange, easier for colour-blind readers)
  hide: [], // home and coin page sections the visitor turned off
  pageSize: 10, // coins shown at first in the markets list
  tabPrice: true, // the live price in the browser tab title on a coin page
  liveMode: 'auto', // auto | saver (fewer updates, less data)
  precision: 'auto', // auto | extra (one more decimal)
  shortcuts: true, // the / key opens search
  sound: false, // a soft chime when a price alert is reached
  haptics: false, // a light tap on phones while moving across a chart
};
let prefData = { ...PREF_DEFAULTS };
try { Object.assign(prefData, JSON.parse(store.get('cm-prefs') || '{}')); } catch { /* start from defaults */ }
if (!['auto', 'light', 'dark'].includes(prefData.theme)) prefData.theme = 'auto';
{
  const legacy = store.get('cm-theme');
  if (!store.get('cm-prefs') && (legacy === 'light' || legacy === 'dark')) prefData.theme = legacy;
}
// Version 2.4 changed two defaults (rows are compact on phones, no price flash). Older saved
// choices for those two are reset once so the new defaults reach everyone.
if (store.get('cm-prefs') && store.get('cm-prefs-v') !== '2') {
  prefData.density = 'auto';
  prefData.flash = false;
  store.set('cm-prefs', JSON.stringify(prefData));
}
store.set('cm-prefs-v', '2');
if (!['auto', 'comfortable', 'compact'].includes(prefData.density)) prefData.density = 'auto';
const prefListeners = new Set();
const phoneQuery = window.matchMedia('(max-width: 820px)');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function applyPrefs() {
  const root = document.documentElement;
  const theme = prefData.theme === 'auto' ? (systemDark.matches ? 'dark' : 'light') : prefData.theme;
  const changed = root.dataset.theme !== theme;
  root.dataset.theme = theme;
  root.dataset.accent = prefData.accent;
  root.dataset.density = prefData.density === 'auto' ? (phoneQuery.matches ? 'compact' : 'comfortable') : prefData.density;
  if (prefData.motion === false) root.dataset.motion = 'off'; else delete root.dataset.motion;
  if (prefData.tape === false) root.dataset.tape = 'off'; else delete root.dataset.tape;
  for (const [attr, key, def] of [['size', 'textSize', 'default'], ['palette', 'palette', 'classic']]) {
    if (prefData[key] && prefData[key] !== def) root.dataset[attr] = prefData[key]; else delete root.dataset[attr];
  }
  const hidden = Array.isArray(prefData.hide) ? prefData.hide.filter(x => /^[a-z]+$/.test(x)) : [];
  if (hidden.length) root.dataset.hide = hidden.join(' '); else delete root.dataset.hide;
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
  phoneQuery.addEventListener('change', () => { if (prefData.density === 'auto') applyPrefs(); });
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
  const more = prefData.precision === 'extra' ? 1 : 0;
  if (stable) return 3 + more;
  if (v >= 10000) return more ? 2 : 0;
  if (v >= 1) return 2 + more;
  if (v >= 0.01) return 3 + more;
  return Math.min(12, Math.ceil(-Math.log10(v)) + 3 + more);
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

// ---------- Portfolio holdings (saved on this device) ----------
export const holdings = {
  load() {
    try {
      const list = JSON.parse(store.get('cm-portfolio') || '[]');
      return Array.isArray(list) ? list.filter(h => h && typeof h.ticker === 'string' && h.amount > 0).slice(0, 60) : [];
    } catch { return []; }
  },
  save(list) {
    store.set('cm-portfolio', JSON.stringify(list.slice(0, 60)));
    document.dispatchEvent(new CustomEvent('cm:holdings'));
  },
};

// ---------- DOM helpers ----------
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Coin logos arrive with very different margins (some fill the whole picture, some float in a lot of
// empty space). Each one is measured once and scaled so every logo fills its round tile the same way.
const fitCache = new Map();
function measureLogo(img) {
  try {
    const n = 48;
    const cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    let x0 = n, y0 = n, x1 = -1, y1 = -1, seen = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (d[(y * n + x) * 4 + 3] > 40) { seen++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (seen / (n * n) > 0.92) return { s: 1, x: 0, y: 0 }; // an opaque picture: leave it alone
    const side = Math.max(w, h);
    const fill = seen / (w * h);
    const round = fill < 0.86 && fill > 0.7; // a round logo fills the tile; other shapes keep some air
    const target = round ? 0.98 : 0.74;
    const s = Math.max(1, Math.min(2.6, (target * n) / side));
    return { s, x: (x0 + x1 + 1) / 2 / n - 0.5, y: (y0 + y1 + 1) / 2 / n - 0.5 };
  } catch { return null; }
}
function fitLogo(img, ticker) {
  let f = fitCache.get(ticker);
  if (f === undefined) { f = measureLogo(img); fitCache.set(ticker, f); }
  if (!f || (f.s === 1 && !f.x && !f.y)) return;
  img.style.transform = `translate(${(-f.x * f.s * 100).toFixed(1)}%, ${(-f.y * f.s * 100).toFixed(1)}%) scale(${f.s.toFixed(3)})`;
}

// Where a logo can come from, best first. Our own backend serves every logo (and fetches a missing
// one on demand). A browser that cached an older copy without CORS headers refuses it in "measure"
// mode, so the same address is tried again as a plain picture. Public icon sets are the last resort.
const logoSources = (coin, api) => {
  const sym = ({ GRAM: 'ton' }[coin.ticker] || coin.ticker).toLowerCase(); // icon sets still file GRAM under its old ticker
  return [
    { src: api + (coin.logo || `/api/logos/${coin.ticker}.png`), cors: true },
    { src: api + (coin.logo || `/api/logos/${coin.ticker}.png`), cors: false },
    { src: `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${sym}.png`, cors: false },
    { src: `https://assets.coincap.io/assets/icons/${sym}@2x.png`, cors: false },
  ];
};
const logoWorked = new Map(); // ticker -> index of the source that loaded, so later tiles skip the misses

/** A coin logo in a round tile. size: '' (32px) | 'sm' | 'lg' | 'xl'. */
export function logoEl(coin, size = '') {
  const wrap = el('div', 'logo' + (size ? ' ' + size : ''));
  const monogram = () => { wrap.classList.add('mono'); wrap.replaceChildren(document.createTextNode(coin.ticker.slice(0, size === 'sm' ? 2 : 4))); };
  const sources = logoSources(coin, API);
  let i = logoWorked.get(coin.ticker) ?? 0;
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => {
    logoWorked.set(coin.ticker, i);
    wrap.classList.add('has-img');
    if (sources[i].cors) fitLogo(img, coin.ticker);
    else applyFit(img, coin.ticker);
  };
  img.onerror = () => {
    i += 1;
    if (i >= sources.length) { monogram(); return; }
    load();
  };
  const load = () => {
    const s = sources[i];
    if (s.cors) img.crossOrigin = 'anonymous'; else img.removeAttribute('crossorigin');
    img.src = s.src;
  };
  wrap.append(img);
  load();
  return wrap;
}
// A logo we could not measure (no CORS) reuses a measurement from an earlier tile if there is one.
function applyFit(img, ticker) {
  const f = fitCache.get(ticker);
  if (!f || (f.s === 1 && !f.x && !f.y)) return;
  img.style.transform = `translate(${(-f.x * f.s * 100).toFixed(1)}%, ${(-f.y * f.s * 100).toFixed(1)}%) scale(${f.s.toFixed(3)})`;
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
  const recents = () => { try { return JSON.parse(store.get('cm-recent') || '[]').filter(t => coins.some(c => c.ticker === t)); } catch { return []; } };
  const go = c => {
    store.set('cm-recent', JSON.stringify([c.ticker, ...recents().filter(t => t !== c.ticker)].slice(0, 5)));
    location.href = '/coin/' + c.ticker;
  };
  const paint = () => {
    list.replaceChildren();
    results.forEach((c, i) => {
      const li = el('li');
      li.id = 'sr-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.append(logoEl(c, 'sm'), el('span', 's-sym', c.ticker), el('span', 's-name', c.name));
      li.addEventListener('mousedown', e => { e.preventDefault(); go(c); });
      list.append(li);
    });
    if (!results.length && input.value.trim()) list.append(el('li', 'search-empty', 'No coin matches that.'));
    list.hidden = !(results.length || input.value.trim());
    if (!input.value.trim() && results.length) {
      const head = el('li', 'search-head');
      head.setAttribute('role', 'presentation');
      const clear = el('button', 'search-clear', 'Clear');
      clear.type = 'button';
      clear.setAttribute('aria-label', 'Clear recent searches');
      // mousedown (not click) so the input keeps focus and the list does not close first.
      clear.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); store.set('cm-recent', '[]'); run(); });
      head.append(el('span', '', 'Recent'), clear);
      list.prepend(head);
    }
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
      : recents().map(t => coins.find(c => c.ticker === t)).filter(Boolean);
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
    if (prefData.shortcuts === false) return;
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
  // The strip stops only while it is held (finger down, or the cursor over it) and moves again the
  // moment it is let go. It never stays stuck.
  const hold = on => host.classList.toggle('held', on);
  host.addEventListener('pointerdown', () => hold(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) host.addEventListener(ev, () => hold(false));
  host.addEventListener('touchend', () => hold(false), { passive: true });
  host.addEventListener('touchcancel', () => hold(false), { passive: true });
  window.addEventListener('blur', () => hold(false));
  document.addEventListener('scroll', () => hold(false), { passive: true });
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

// ---------- Back to top (a button inside the footer, not floating over the page) ----------
function initToTop() {
  document.getElementById('to-top')?.addEventListener('click', () => {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  });
}

// ---------- Footer wordmark: always exactly as wide as the page ----------
function initWordmark() {
  const box = document.querySelector('.foot-mark');
  const word = box?.firstElementChild;
  if (!box || !word) return;
  const fit = () => {
    const avail = box.clientWidth - 2 * parseFloat(getComputedStyle(box).paddingLeft || '0');
    if (avail < 40) return;
    box.style.fontSize = '100px';
    const w = word.getBoundingClientRect().width;
    if (w > 0) box.style.fontSize = Math.max(24, Math.min(320, Math.floor((100 * avail) / w * 10) / 10 - 0.2)) + 'px';
  };
  fit();
  document.fonts?.ready?.then(fit);
  let t = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(t); t = requestAnimationFrame(fit); });
}

// ---------- Footer: the biggest moves right now ----------
function initFooterMovers(coins) {
  const host = document.getElementById('foot-live');
  if (!host) return;
  const stable = new Set(coins.filter(c => c.stable).map(c => c.ticker));
  stable.add('USDT'); stable.add('USDC');
  const rows = new Map();
  let order = '';
  let sortedAt = 0;
  document.addEventListener('cm:prices', e => {
    const list = e.detail.coins.filter(c => c.price && typeof c.change24h === 'number' && !stable.has(c.ticker));
    const now = Date.now();
    if (now - sortedAt > 30000 || !order) {
      sortedAt = now;
      const pick = list.slice().sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 3);
      const key = pick.map(c => c.ticker).join();
      if (key !== order) {
        order = key;
        rows.clear();
        host.replaceChildren(...pick.map(c => {
          const li = el('li');
          const a = el('a', 'fm-item');
          a.href = '/coin/' + c.ticker;
          const price = el('span', 'fm-price num');
          const chg = el('span', 'fm-chg num');
          a.append(el('b', 'fm-sym', c.ticker), price, chg);
          li.append(a);
          rows.set(c.ticker, { price, chg });
          return li;
        }));
      }
    }
    for (const c of list) {
      const r = rows.get(c.ticker);
      if (!r) continue;
      const ch = pct(c.change24h);
      r.price.textContent = money(c.price, { stable: c.stable });
      r.chg.textContent = ch.text;
      r.chg.className = 'fm-chg num ' + ch.cls;
    }
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const t = el('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.className = 'sr';
    document.body.append(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
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
  initToTop();
  initWordmark();
  initFooterMovers(coins);
  for (const name of ['portfolio', 'markets', 'screener', 'news', 'compare']) {
    if (path === '/' + name) document.querySelector(`[data-nav="${name}"]`)?.setAttribute('aria-current', 'page');
  }
  pollPrices(() => {}); // starts the shared live connection on every page
  // Exchange rates arrive quietly; the currency follows when they do.
  getJSON('/api/rates').then(r => setRates(r.rates)).catch(() => {});
  import('./targets.js').then(m => m.start()).catch(() => {});
  return coins;
}
