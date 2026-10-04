// Settings: the hub, Preferences, Watchlist, Price alerts, Data and privacy.
import {
  API, initChrome, pollPrices, store, prefs, PREF_DEFAULTS, currency, onCurrency, setCurrency, currencySymbol, CURRENCY_NAMES,
  money, pct, el, logoEl, isFav, toggleFav, onFavs, favCount, ago, setNum,
} from './common.js';
import { loadTargets, addTarget, removeTarget, clearReached, rearm } from './targets.js';

const $ = id => document.getElementById(id);
const page = document.body.dataset.page;
const live = new Map(); // ticker -> latest coin reading
let coins = [];

const THEME_LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };

function flashSaved(text = 'Saved') {
  const n = $('saved') || $('data-msg');
  if (!n) return;
  n.textContent = text;
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => { n.textContent = ''; }, 2000);
}

// ---------------------------------------------------------------- hub
function paintHub() {
  const set = (id, text) => { const n = $(id); if (n) n.textContent = text; };
  set('hv-prefs', `${THEME_LABEL[prefs.get('theme')]} theme · ${currency.code}`);
  set('hv-watch', favCount() === 1 ? '1 coin starred' : `${favCount()} coins starred`);
  const active = loadTargets().filter(t => !t.firedAt).length;
  set('hv-alerts', active === 1 ? '1 alert watching' : `${active} alerts watching`);
}

// ---------------------------------------------------------------- preferences
function paintPrefs() {
  document.querySelectorAll('[data-pref]').forEach(group => {
    const value = String(prefs.get(group.dataset.pref));
    group.querySelectorAll('[data-value]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === value)));
  });
  document.querySelectorAll('[data-toggle]').forEach(b => b.setAttribute('aria-checked', String(prefs.get(b.dataset.toggle) !== false)));
}

function buildCurrencies() {
  const grid = $('cur-grid');
  const rates = currency.rates;
  const known = Object.keys(rates).length > 1;
  const codes = Object.keys(CURRENCY_NAMES);
  grid.replaceChildren(...codes.map(code => {
    const b = el('button', 'cur-chip');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.code = code;
    b.append(el('span', 'cc-sym', currencySymbol(code).slice(0, 4)), el('span', 'cc-code', code), el('span', 'cc-name', CURRENCY_NAMES[code]));
    if (known && !rates[code]) { b.disabled = true; b.title = 'Not available right now'; }
    b.addEventListener('click', () => { setCurrency(code); flashSaved(); });
    return b;
  }));
  paintCurrencies();
}
function paintCurrencies() {
  document.querySelectorAll('.cur-chip').forEach(b => b.setAttribute('aria-checked', String(b.dataset.code === currency.code)));
  const btc = live.get('BTC');
  setNum($('cur-preview'), btc ? money(btc.price) : '–', btc?.price);
}

function initPreferences() {
  paintPrefs();
  document.querySelectorAll('[data-pref]').forEach(group => {
    group.addEventListener('click', e => {
      const b = e.target.closest('[data-value]');
      if (!b) return;
      prefs.set(group.dataset.pref, b.dataset.value);
      paintPrefs();
      flashSaved();
    });
  });
  document.querySelectorAll('[data-toggle]').forEach(b => {
    b.addEventListener('click', () => {
      prefs.set(b.dataset.toggle, !(prefs.get(b.dataset.toggle) !== false));
      paintPrefs();
      flashSaved();
    });
  });
  buildCurrencies();
  onCurrency(() => { buildCurrencies(); });
  $('reset-prefs').addEventListener('click', () => { prefs.reset(); paintPrefs(); flashSaved('Back to the defaults'); });
}

// ---------------------------------------------------------------- watchlist
function renderWatchlist() {
  const q = $('wl-filter').value.trim().toLowerCase();
  const list = coins
    .filter(c => !q || c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    .sort((a, b) => Number(isFav(b.ticker)) - Number(isFav(a.ticker)));
  $('wl-count').textContent = favCount() ? `${favCount()} starred. They show under Starred on the home page.` : 'Nothing starred yet. Tap a star to follow a coin.';
  $('wl-clear').hidden = favCount() === 0;
  const ul = $('wl-list');
  ul.replaceChildren(...list.map(c => {
    const li = el('li', 'wl-row');
    const logo = el('span', 'wl-logo'); logo.append(logoEl(live.get(c.ticker) || { ticker: c.ticker, logo: null }));
    const name = el('a', 'wl-name'); name.href = '/coin/' + c.ticker;
    name.append(el('b', '', c.ticker), el('span', '', c.name));
    const l = live.get(c.ticker);
    const price = el('span', 'wl-price num', l ? money(l.price, { stable: l.stable }) : '–');
    price.dataset.t = c.ticker;
    const ch = pct(l?.change24h);
    const chg = el('span', 'wl-chg chg num ' + ch.cls, ch.text);
    chg.dataset.t = c.ticker;
    const star = el('button', 'fav'); star.type = 'button';
    star.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
    star.setAttribute('aria-pressed', String(isFav(c.ticker)));
    star.setAttribute('aria-label', (isFav(c.ticker) ? 'Unstar ' : 'Star ') + c.name);
    star.addEventListener('click', () => toggleFav(c.ticker));
    li.append(logo, name, price, chg, star);
    return li;
  }));
}
function updateWatchlistPrices() {
  document.querySelectorAll('.wl-price').forEach(n => {
    const l = live.get(n.dataset.t);
    if (l) setNum(n, money(l.price, { stable: l.stable }), l.price);
  });
  document.querySelectorAll('.wl-chg').forEach(n => {
    const l = live.get(n.dataset.t);
    if (!l) return;
    const ch = pct(l.change24h);
    n.textContent = ch.text; n.className = 'wl-chg chg num ' + ch.cls;
  });
}
function initWatchlist() {
  $('wl-filter').addEventListener('input', renderWatchlist);
  $('wl-clear').addEventListener('click', () => { coins.filter(c => isFav(c.ticker)).forEach(c => toggleFav(c.ticker)); });
  onFavs(renderWatchlist);
  renderWatchlist();
}

// ---------------------------------------------------------------- price alerts
const parseNum = text => Number(String(text).replace(/,/g, '').trim());

function paintAlertHint() {
  const t = $('al-coin').value;
  const l = live.get(t);
  $('al-code').textContent = currency.code;
  $('al-now').textContent = l ? `${t} is ${money(l.price, { stable: l.stable })} right now.` : ' ';
  if (l) $('al-price').placeholder = money(l.price, { stable: l.stable }).replace(/[^\d.,]/g, '');
}

function renderTargets() {
  const all = loadTargets();
  const ul = $('al-list');
  $('al-empty').hidden = all.length > 0;
  ul.replaceChildren(...all.map(t => {
    const l = live.get(t.ticker);
    const stable = Boolean(l?.stable);
    const li = el('li', 'al-row' + (t.firedAt ? ' reached' : ''));
    const logo = el('span', 'wl-logo'); logo.append(logoEl(l || { ticker: t.ticker, logo: null }));
    const body = el('span', 'al-body');
    const verb = t.dir === 'above' ? 'rises to or above' : 'falls to or below';
    body.append(el('b', '', `${t.ticker} ${verb} ${money(t.price, { stable })}`));
    const meta = el('span', 'al-meta');
    meta.dataset.ticker = t.ticker; meta.dataset.price = t.price;
    if (!t.firedAt) meta.dataset.live = '1';
    if (t.firedAt) {
      meta.textContent = `Reached ${ago(new Date(t.firedAt).toISOString())} at ${money(t.firedPrice, { stable })}`;
    } else if (l?.price) {
      const away = ((t.price - l.price) / l.price) * 100;
      meta.textContent = `${Math.abs(away).toFixed(2)}% away. Now ${money(l.price, { stable })}`;
    } else meta.textContent = 'Watching';
    body.append(meta);
    const actions = el('span', 'al-actions');
    if (t.firedAt) {
      const re = el('button', 'btn btn-ghost btn-sm', 'Watch again'); re.type = 'button';
      re.addEventListener('click', () => rearm(t.id));
      actions.append(re);
    }
    const del = el('button', 'icon-btn', ''); del.type = 'button'; del.setAttribute('aria-label', 'Delete alert');
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.addEventListener('click', () => removeTarget(t.id));
    actions.append(del);
    li.append(logo, body, actions);
    li.className += ` ${t.dir}`;
    return li;
  }));
}

function updateTargetMeta() {
  document.querySelectorAll('.al-meta[data-live]').forEach(m => {
    const l = live.get(m.dataset.ticker);
    if (!l?.price) return;
    const away = ((Number(m.dataset.price) - l.price) / l.price) * 100;
    m.textContent = `${Math.abs(away).toFixed(2)}% away. Now ${money(l.price, { stable: l.stable })}`;
  });
}

function paintNotif() {
  const btn = $('notif-btn'), text = $('notif-text');
  if (!('Notification' in window)) { btn.hidden = true; text.textContent = 'This browser cannot show notifications. You will still see a message on the page.'; return; }
  const p = Notification.permission;
  btn.hidden = p !== 'default';
  text.textContent = p === 'granted' ? 'On. You will get a notification when an alert is reached.'
    : p === 'denied' ? 'Blocked in your browser settings. You will still see a message on the page.'
      : 'Get a notification when an alert is reached.';
}

function initAlerts() {
  $('al-coin').replaceChildren(...coins.map(c => new Option(`${c.name} (${c.ticker})`, c.ticker)));
  const fromUrl = new URLSearchParams(location.search).get('coin');
  if (fromUrl && coins.some(c => c.ticker === fromUrl.toUpperCase())) $('al-coin').value = fromUrl.toUpperCase();
  $('al-coin').addEventListener('change', paintAlertHint);
  onCurrency(() => { paintAlertHint(); renderTargets(); });
  paintAlertHint();
  renderTargets();
  document.addEventListener('cm:targets', renderTargets);
  setInterval(renderTargets, 30000);

  $('al-form').addEventListener('submit', e => {
    e.preventDefault();
    const err = $('al-error');
    err.hidden = true;
    const ticker = $('al-coin').value;
    const dir = $('al-dir').value;
    const shown = parseNum($('al-price').value);
    if (!(shown > 0)) { err.textContent = 'Enter a price greater than zero.'; err.hidden = false; return; }
    const usd = shown / currency.rate;
    const l = live.get(ticker);
    if (l?.price) {
      if (dir === 'above' && l.price >= usd) { err.textContent = `${ticker} is already at or above that price. Pick a higher one.`; err.hidden = false; return; }
      if (dir === 'below' && l.price <= usd) { err.textContent = `${ticker} is already at or below that price. Pick a lower one.`; err.hidden = false; return; }
    }
    addTarget({ ticker, dir, price: usd });
    $('al-price').value = '';
  });
  $('notif-btn').addEventListener('click', async () => {
    try { await Notification.requestPermission(); } catch { /* older browsers */ }
    paintNotif();
  });
  paintNotif();
  const clear = el('button', 'btn btn-ghost btn-sm', 'Clear reached');
  clear.type = 'button';
  clear.addEventListener('click', clearReached);
  $('al-list').after(clear);
}

// ---------------------------------------------------------------- data and privacy
const FAV_KEY = 'cm-favs';
function bytes(text) { return new Blob([text || '']).size; }
function renderStore() {
  const rows = [
    ['Preferences', 'Theme, accent, density, chart and market defaults', store.get('cm-prefs')],
    ['Currency', `Showing ${currency.code}`, store.get('cm-currency')],
    ['Starred coins', favCount() === 1 ? '1 coin' : `${favCount()} coins`, store.get(FAV_KEY)],
    ['Price alerts', `${loadTargets().length} saved`, store.get('cm-targets')],
  ];
  $('store-list').replaceChildren(...rows.map(([name, note, raw]) => {
    const li = el('li', 'store-row');
    const t = el('span', 'sr-t'); t.append(el('b', '', name), el('span', '', note));
    li.append(t, el('span', 'sr-size', raw ? `${Math.max(1, bytes(raw))} B` : 'empty'));
    return li;
  }));
}
function exportData() {
  const payload = {
    app: 'cryptomium',
    version: 1,
    exportedAt: new Date().toISOString(),
    prefs: prefs.all(),
    currency: currency.code,
    favs: (() => { try { return JSON.parse(store.get(FAV_KEY) || '[]'); } catch { return []; } })(),
    targets: loadTargets(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cryptomium-settings.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  flashSaved('Backup downloaded');
}
async function importData(file) {
  try {
    if (file.size > 200_000) throw new Error('size');
    const data = JSON.parse(await file.text());
    if (data?.app !== 'cryptomium') throw new Error('not ours');
    const tickers = new Set(coins.map(c => c.ticker));
    const next = {};
    for (const key of Object.keys(PREF_DEFAULTS)) if (data.prefs && key in data.prefs && typeof data.prefs[key] === typeof PREF_DEFAULTS[key]) next[key] = data.prefs[key];
    prefs.replace(next);
    if (typeof data.currency === 'string' && CURRENCY_NAMES[data.currency]) store.set('cm-currency', data.currency);
    if (Array.isArray(data.favs)) store.set(FAV_KEY, JSON.stringify(data.favs.filter(t => tickers.has(t))));
    if (Array.isArray(data.targets)) {
      const ok = data.targets.filter(t => t && tickers.has(t.ticker) && (t.dir === 'above' || t.dir === 'below') && t.price > 0).slice(0, 50)
        .map(t => ({ id: String(t.id || Math.random().toString(36).slice(2)).slice(0, 20), ticker: t.ticker, dir: t.dir, price: Number(t.price), created: Number(t.created) || Date.now(), firedAt: t.firedAt ? Number(t.firedAt) : undefined, firedPrice: t.firedPrice ? Number(t.firedPrice) : undefined }));
      store.set('cm-targets', JSON.stringify(ok));
    }
    flashSaved('Backup loaded');
    setTimeout(() => location.reload(), 700);
  } catch {
    flashSaved('That file is not a Cryptomium backup');
  }
}
function initData() {
  renderStore();
  onCurrency(renderStore);
  document.addEventListener('cm:targets', renderStore);
  onFavs(renderStore);
  $('export-btn').addEventListener('click', exportData);
  $('import-file').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importData(f); e.target.value = ''; });
  const reset = $('reset-all');
  let armed = null;
  reset.addEventListener('click', () => {
    if (!armed) {
      reset.textContent = 'Tap again to confirm';
      armed = setTimeout(() => { armed = null; reset.textContent = 'Reset everything'; }, 4000);
      return;
    }
    clearTimeout(armed);
    prefs.reset();
    store.set('cm-currency', 'USD');
    store.set(FAV_KEY, '[]');
    store.set('cm-targets', '[]');
    store.set('cm-theme', 'auto');
    flashSaved('Everything was cleared');
    setTimeout(() => location.reload(), 600);
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  coins = await initChrome();
  if (page === 'hub') {
    paintHub();
    onCurrency(paintHub);
    onFavs(paintHub);
    document.addEventListener('cm:targets', paintHub);
  } else {
    const here = document.querySelector(`.snav [data-s="${page}"]`);
    here?.setAttribute('aria-current', 'page');
    here?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  if (page === 'preferences') initPreferences();
  if (page === 'watchlist') initWatchlist();
  if (page === 'alerts') initAlerts();
  if (page === 'data') initData();

  if (API && ['preferences', 'watchlist', 'alerts'].includes(page)) {
    pollPrices(data => {
      for (const c of data.coins) live.set(c.ticker, c);
      if (page === 'preferences') paintCurrencies();
      if (page === 'watchlist') { if (!document.querySelector('.wl-price') || document.querySelector('.wl-price').textContent === '–') renderWatchlist(); else updateWatchlistPrices(); }
      if (page === 'alerts') { paintAlertHint(); updateTargetMeta(); }
    }, () => {});
  }
}
boot();
