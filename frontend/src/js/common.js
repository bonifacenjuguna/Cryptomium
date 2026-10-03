// Shared pieces: config, storage, theme, currency, favourites, price polling,
// formatting, the header (search, currency, theme) and small DOM helpers.

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
 * Polls /api/prices on the server's own rhythm. Quiet by design: failures never
 * throw at the visitor, they just back off and keep the last prices on screen.
 */
export function pollPrices(onData, onState) {
  let timer = null;
  let backoff = 0;
  let lastOk = 0;
  const schedule = ms => { clearTimeout(timer); if (!document.hidden) timer = setTimeout(tick, ms); };
  async function tick() {
    try {
      const data = await getJSON('/api/prices');
      lastOk = Date.now();
      backoff = 0;
      onData(data);
      onState('live');
      schedule(Math.max(4000, Number(data.refreshMs) || 15000));
    } catch {
      backoff = Math.min(60000, (backoff || 4000) * 1.8);
      onState(lastOk && Date.now() - lastOk < 180000 ? 'live' : lastOk ? 'reconnecting' : 'connecting');
      schedule(backoff);
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  tick();
}

export function setLive(el, state) {
  if (!el) return;
  el.dataset.state = state;
  el.textContent = state === 'live' ? 'Live' : state === 'reconnecting' ? 'Reconnecting' : 'Connecting';
}

// ---------- Theme ----------
export function initTheme() {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  const paint = () => {
    const dark = root.dataset.theme === 'dark';
    btn?.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    btn?.querySelector('.i-sun')?.toggleAttribute('hidden', !dark);
    btn?.querySelector('.i-moon')?.toggleAttribute('hidden', dark);
  };
  btn?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set('cm-theme', next);
    paint();
    document.dispatchEvent(new CustomEvent('themechange'));
  });
  paint();
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
  document.getElementById('currency')?.addEventListener('change', e => {
    store.set('cm-currency', e.target.value);
    applyCurrency();
  });
  applyCurrency();
}

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
  t.price.textContent = money(coin.price, { stable: coin.stable });
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

// ---------- Header: mobile navigation ----------
function initMobileNav() {
  const nav = document.getElementById('main-nav');
  const toggle = document.getElementById('menu-toggle');
  if (!nav || !toggle) return;

  const setOpen = open => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    document.documentElement.classList.toggle('nav-open', open);
  };

  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  nav.addEventListener('click', e => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') setOpen(false);
  });
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
}

// ---------- Header: current page highlight + boot ----------
export async function initChrome() {
  initTheme();
  initCurrency();
  const path = location.pathname.replace(/\/$/, '');
  if (path === '/about') document.querySelector('[data-nav="about"]')?.setAttribute('aria-current', 'page');
  let coins = [];
  try { coins = await getCoinList(); } catch { /* search just stays empty */ }
  initSearch(coins);
  // Exchange rates arrive quietly; the switcher fills in when they do.
  getJSON('/api/rates').then(r => setRates(r.rates)).catch(() => {});
  return coins;
}
