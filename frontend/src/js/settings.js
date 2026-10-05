// Settings: the hub, Preferences, Watchlist, Price alerts, Data and privacy.
import {
  API, initChrome, pollPrices, getJSON, store, prefs, PREF_DEFAULTS, currency, onCurrency, setCurrency, currencySymbol, CURRENCY_NAMES,
  money, pct, el, logoEl, isFav, toggleFav, onFavs, favCount, ago, setNum, holdings, setLive,
} from './common.js';
import { loadTargets, addTarget, removeTarget, clearReached, rearm, chime, describe } from './targets.js';
import { openSheet, coinPicker } from './ui.js';
import { createChart } from './chart.js';
import { LESSONS, CATS, TERMS } from './learn-content.js';

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
const ACCENT_LABEL = { citrine: 'Gold', azure: 'Blue', emerald: 'Green', violet: 'Violet', rose: 'Rose', graphite: 'Slate' };
function paintHub() {
  const set = (id, text) => { const n = $(id); if (n) n.textContent = text; };
  set('hv-appearance', `${THEME_LABEL[prefs.get('theme')]} theme · ${ACCENT_LABEL[prefs.get('accent')] || 'Gold'}`);
  set('hv-preferences', `${currency.code} · ${prefs.get('chartType') === 'candles' ? 'Candles' : 'Line'} · ${String(prefs.get('chartRange')).toUpperCase()}`);
  const hidden = (prefs.get('hide') || []).length;
  set('hv-home', hidden ? `${hidden} ${hidden === 1 ? 'section' : 'sections'} hidden` : 'Everything shown');
  set('hv-watchlist', favCount() === 1 ? '1 coin starred' : `${favCount()} coins starred`);
  const active = loadTargets().filter(t => !t.firedAt).length;
  set('hv-alerts', active === 1 ? '1 alert watching' : `${active} alerts watching`);
  const held = holdings.load().length;
  set('hv-portfolio', held ? (held === 1 ? '1 holding' : `${held} holdings`) : 'Nothing added yet');
  set('hv-learn', `${TERMS.length} words explained`);
  set('hv-sources', 'Live from the exchanges');
  set('hv-about', 'About ' + (window.CRYPTOMIUM?.brand || 'Cryptomium'));
  set('hv-data', 'Stays on this device');
  set('hv-advanced', prefs.get('liveMode') === 'saver' ? 'Data saver on' : 'Auto updates');
  set('hv-experimental', prefs.get('sound') || prefs.get('haptics') ? 'Some on' : 'All off');
}

// ---------------------------------------------------------------- preferences
function paintPrefs() {
  document.querySelectorAll('[data-pref]').forEach(group => {
    const value = String(prefs.get(group.dataset.pref));
    group.querySelectorAll('[data-value]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === value)));
  });
  document.querySelectorAll('[data-toggle]').forEach(b => b.setAttribute('aria-checked', String(Boolean(prefs.get(b.dataset.toggle)))));
  const hidden = prefs.get('hide') || [];
  document.querySelectorAll('[data-show]').forEach(b => b.setAttribute('aria-checked', String(!hidden.includes(b.dataset.show))));
}

function paintCurrencies() {
  $('cp-sym').textContent = currencySymbol(currency.code).slice(0, 4);
  $('cp-code').textContent = currency.code;
  $('cp-name').textContent = CURRENCY_NAMES[currency.code] || '';
  const btc = live.get('BTC');
  setNum($('cur-preview'), btc ? money(btc.price) : '–', btc?.price);
}

// The currency list opens in the shared sheet, with the common currencies first.
const COMMON = ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR'];
function openCurrencySheet() {
  const known = Object.keys(currency.rates).length > 1;
  const all = Object.keys(CURRENCY_NAMES);
  const ordered = [...COMMON.filter(c => all.includes(c)), ...all.filter(c => !COMMON.includes(c))];
  openSheet({
    title: 'Choose a currency', searchLabel: 'Search currencies', trigger: $('cur-pick'), value: currency.code,
    empty: 'No currency matches that.',
    items: ordered.map(code => {
      const off = known && !currency.rates[code];
      return {
        value: code, title: code, sub: CURRENCY_NAMES[code] + (off ? ' (not available right now)' : ''), disabled: off,
        group: COMMON.includes(code) ? 'Popular' : 'All currencies',
        lead: () => el('span', 'cc-sym', currencySymbol(code).slice(0, 4)),
      };
    }),
    onPick: code => { setCurrency(code); flashSaved(); },
  });
}

function initPreferences() {
  paintPrefs();
  document.querySelectorAll('[data-pref]').forEach(group => {
    group.addEventListener('click', e => {
      const b = e.target.closest('[data-value]');
      if (!b) return;
      const key = group.dataset.pref;
      const raw = b.dataset.value;
      prefs.set(key, key === 'pageSize' ? Number(raw) : raw);
      paintPrefs();
      flashSaved();
    });
  });
  document.querySelectorAll('[data-toggle]').forEach(b => {
    b.addEventListener('click', () => {
      const key = b.dataset.toggle;
      prefs.set(key, !prefs.get(key));
      paintPrefs();
      flashSaved();
    });
  });
  document.querySelectorAll('[data-show]').forEach(b => {
    b.addEventListener('click', () => {
      const key = b.dataset.show;
      const hidden = new Set(prefs.get('hide') || []);
      if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
      prefs.set('hide', [...hidden]);
      paintPrefs();
      flashSaved();
    });
  });
  if ($('cur-pick')) {
    paintCurrencies();
    $('cur-pick').addEventListener('click', openCurrencySheet);
    onCurrency(paintCurrencies);
  }
  $('reset-prefs')?.addEventListener('click', () => {
    const next = prefs.all();
    for (const n of document.querySelectorAll('[data-pref],[data-toggle]')) { const k = n.dataset.pref || n.dataset.toggle; next[k] = PREF_DEFAULTS[k]; }
    prefs.replace(next);
    paintPrefs(); flashSaved('Back to the defaults');
  });
  $('reset-layout')?.addEventListener('click', () => { prefs.set('hide', []); prefs.set('pageSize', 10); paintPrefs(); flashSaved('Everything is shown again'); });
}

// ---------------------------------------------------------------- live preview (desktop)
const preview = { chart: null, key: '' };
function paintPreviewTape() {
  const host = $('pv-tape');
  if (!host) return;
  host.hidden = prefs.get('tape') === false;
  const picks = ['BTC', 'ETH', 'SOL', 'XRP'].map(t => live.get(t)).filter(Boolean);
  host.replaceChildren(...picks.map(c => {
    const ch = pct(c.change24h);
    const s = el('span', 'pv-t');
    s.append(el('b', '', c.ticker), el('span', 'num', money(c.price, { stable: c.stable })), el('span', 'num chg ' + ch.cls, ch.text));
    return s;
  }));
}
async function loadPreviewChart() {
  const type = prefs.get('chartType') === 'candles' ? 'candles' : 'line';
  const range = ['24h', '7d', '30d', '90d', '1y'].includes(prefs.get('chartRange')) ? prefs.get('chartRange') : '7d';
  document.querySelectorAll('#pv-tabs [data-r]').forEach(n => n.classList.toggle('on', n.dataset.r === range));
  const key = type + range;
  if (!preview.chart) preview.chart = createChart($('pv-chart'), {});
  if (key === preview.key) { preview.chart.redraw(); return; }
  preview.key = key;
  try {
    const h = await getJSON(`/api/history/BTC?range=${range}${type === 'candles' ? '&style=candles' : ''}`);
    if (preview.key !== key) return;
    preview.chart.setData(type === 'candles' ? { type, range, candles: h.candles } : { type, range, points: h.points });
    const btc = live.get('BTC');
    if (btc?.price) preview.chart.tick(btc.price);
  } catch { preview.chart.setMessage('Preview not available right now'); }
}
function paintPreview() {
  const btc = live.get('BTC');
  if (btc) {
    setNum($('pv-price'), money(btc.price), btc.price);
    const ch = pct(btc.change24h);
    $('pv-chg').textContent = ch.text; $('pv-chg').className = 'chg num ' + ch.cls;
    if (!$('pv-logo').firstChild) $('pv-logo').append(logoEl(btc, 'lg'));
    preview.chart?.tick(btc.price);
  }
  paintPreviewTape();
}
function initPreview() {
  if (!$('pv-chart') || !API) return;
  loadPreviewChart();
  prefs.onChange(key => {
    if (['chartType', 'chartRange', '*'].includes(key)) loadPreviewChart();
    if (['theme', 'accent', 'palette', 'density', 'textSize', '*'].includes(key)) setTimeout(() => preview.chart?.redraw(), 30);
    paintPreviewTape();
  });
  document.addEventListener('themechange', () => preview.chart?.redraw());
  onCurrency(() => { paintPreview(); preview.chart?.redraw(); });
  new ResizeObserver(() => preview.chart?.redraw()).observe($('pv-chart'));
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

let alPick = null;
function paintAlertHint() {
  const t = alPick ? alPick.get() : '';
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
    body.append(el('b', '', `${t.ticker} ${describe(t, stable)}`));
    const meta = el('span', 'al-meta');
    meta.dataset.ticker = t.ticker; meta.dataset.price = t.price;
    if (!t.firedAt && (t.dir === 'above' || t.dir === 'below')) meta.dataset.live = '1';
    if (t.firedAt) {
      meta.textContent = `Reached ${ago(new Date(t.firedAt).toISOString())} at ${money(t.firedPrice, { stable })}`;
    } else if (l?.price && (t.dir === 'above' || t.dir === 'below')) {
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
  if (!btn || !text) return;
  if (!('Notification' in window)) { btn.hidden = true; text.textContent = 'This browser cannot show notifications. You will still see a message on the page.'; return; }
  const p = Notification.permission;
  btn.hidden = p !== 'default';
  text.textContent = p === 'granted' ? 'On. You will get a notification when an alert is reached.'
    : p === 'denied' ? 'Blocked in your browser settings. You will still see a message on the page.'
      : 'Get a notification when an alert is reached.';
}

function initAlerts() {
  const fromUrl = (new URLSearchParams(location.search).get('coin') || '').toUpperCase();
  alPick = coinPicker($('al-coin'), { coins, live, value: coins.some(c => c.ticker === fromUrl) ? fromUrl : (coins[0]?.ticker || ''), placeholder: 'Choose a coin', onChange: () => paintAlertHint() });
  onCurrency(() => { paintAlertHint(); renderTargets(); });
  paintAlertHint();
  renderTargets();
  document.addEventListener('cm:targets', renderTargets);
  setInterval(renderTargets, 30000);

  const syncKind = () => {
    const k = $('al-dir').value;
    $('al-price-fld').hidden = k === 'ath' || k === 'atl';
    $('al-price-l').textContent = k === 'move' ? 'Move in 24h (%)' : `Price in ${currency.code}`;
    $('al-price').placeholder = k === 'move' ? 'e.g. 5' : 'Price';
  };
  $('al-dir').addEventListener('change', syncKind);
  syncKind();
  $('al-form').addEventListener('submit', e => {
    e.preventDefault();
    const err = $('al-error');
    err.hidden = true;
    const ticker = alPick.get();
    const dir = $('al-dir').value;
    const shown = parseNum($('al-price').value);
    if (dir === 'ath' || dir === 'atl') { addTarget({ ticker, dir, price: 0 }); return; }
    if (!(shown > 0)) { err.textContent = 'Enter a price greater than zero.'; err.hidden = false; return; }
    const usd = shown / currency.rate;
    const l = live.get(ticker);
    if (dir === 'move') {
      if (!(shown >= 0.5 && shown <= 100)) { err.textContent = 'Enter a 24h move between 0.5 and 100 percent.'; err.hidden = false; return; }
      addTarget({ ticker, dir, price: shown });
      $('al-price').value = '';
      return;
    }
    if (l?.price && (dir === 'above' || dir === 'below')) {
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
    ['Preferences', 'Appearance, layout, chart and market defaults', store.get('cm-prefs')],
    ['Currency', `Showing ${currency.code}`, store.get('cm-currency')],
    ['Starred coins', favCount() === 1 ? '1 coin' : `${favCount()} coins`, store.get(FAV_KEY)],
    ['Price alerts', `${loadTargets().length} saved`, store.get('cm-targets')],
    ['Portfolio', `${holdings.load().length} holdings`, store.get('cm-portfolio')],
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
    portfolio: holdings.load(),
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
      const ok = data.targets.filter(t => t && tickers.has(t.ticker) && (['above', 'below', 'move', 'ath', 'atl'].includes(t.dir)) && (t.price > 0 || t.dir === 'ath' || t.dir === 'atl')).slice(0, 50)
        .map(t => ({ id: String(t.id || Math.random().toString(36).slice(2)).slice(0, 20), ticker: t.ticker, dir: t.dir, price: Number(t.price), created: Number(t.created) || Date.now(), firedAt: t.firedAt ? Number(t.firedAt) : undefined, firedPrice: t.firedPrice ? Number(t.firedPrice) : undefined }));
      store.set('cm-targets', JSON.stringify(ok));
    }
    if (Array.isArray(data.portfolio)) {
      const ok = data.portfolio.filter(h => h && tickers.has(h.ticker) && Number(h.amount) > 0).slice(0, 40)
        .map(h => ({ id: String(h.id || Math.random().toString(36).slice(2)).slice(0, 20), ticker: h.ticker, amount: Number(h.amount) }));
      store.set('cm-portfolio', JSON.stringify(ok));
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
  document.addEventListener('cm:holdings', renderStore);
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
    store.set('cm-portfolio', '[]');
    store.set('cm-theme', 'auto');
    flashSaved('Everything was cleared');
    setTimeout(() => location.reload(), 600);
  });
}

// ---------------------------------------------------------------- learn
function initLearn() {
  $('lessons').replaceChildren(...LESSONS.map((l, i) => {
    const d = el('details', 'lesson');
    if (i === 0) d.open = true;
    const sm = el('summary'); sm.append(el('span', 'ls-n', String(i + 1)), el('b', '', l.t));
    d.append(sm, el('p', '', l.d));
    return d;
  }));
  let cat = 'All';
  const cats = $('gl-cats');
  const paintCats = () => cats.replaceChildren(...['All', ...CATS].map(c => {
    const b = el('button', 'gl-chip', c); b.type = 'button'; b.setAttribute('aria-pressed', String(c === cat));
    b.addEventListener('click', () => { cat = c; paintCats(); paint(); });
    return b;
  }));
  const paint = () => {
    const q = $('gl-search').value.trim().toLowerCase();
    const list = TERMS.filter(t => (cat === 'All' || t.c === cat) && (!q || t.w.toLowerCase().includes(q) || t.d.toLowerCase().includes(q)));
    $('gloss').replaceChildren(...list.flatMap(t => {
      const dt = el('dt'); dt.append(el('b', '', t.w), el('i', 'gl-cat', t.c));
      return [dt, el('dd', '', t.d)];
    }));
    $('gl-empty').hidden = list.length > 0;
  };
  $('gl-search').addEventListener('input', paint);
  paintCats(); paint();
}

// ---------------------------------------------------------------- data sources
function initSources() {
  const msg = $('src-msg');
  const stateText = { live: 'Live', reconnecting: 'Reconnecting', connecting: 'Connecting' };
  let last = null;
  pollPrices(data => {
    last = data;
    $('src-name').textContent = data.source || '–';
    $('src-time').textContent = data.updatedAt ? ago(data.updatedAt) : '–';
  }, st => { $('src-state').textContent = stateText[st] || st; $('src-state').dataset.state = st; });
  setInterval(() => { if (last?.updatedAt) $('src-time').textContent = ago(last.updatedAt); }, 5000);
  const test = async () => {
    msg.textContent = 'Testing…';
    const t0 = performance.now();
    try { await getJSON('/api/prices', { timeoutMs: 8000 }); const ms = Math.round(performance.now() - t0); $('src-ping').textContent = ms + ' ms'; msg.textContent = ms < 800 ? 'All good' : 'A little slow'; }
    catch { $('src-ping').textContent = 'No answer'; msg.textContent = 'Could not reach the price service'; }
  };
  $('src-test').addEventListener('click', test);
  test();
}

// ---------------------------------------------------------------- advanced + experimental
function initAdvanced() {
  initPreferences();
  $('clear-recent')?.addEventListener('click', () => { store.set('cm-recent', '[]'); flashSaved('Recent searches cleared'); });
  $('reload-now')?.addEventListener('click', () => location.reload());
  $('notif-btn')?.addEventListener('click', async () => {
    try { await Notification.requestPermission(); } catch { /* older browsers */ }
    paintNotif();
  });
  paintNotif();
}
function initExperimental() {
  initPreferences();
  $('test-sound')?.addEventListener('click', () => chime());
}

// ---------------------------------------------------------------- boot
async function boot() {
  coins = await initChrome();
  if (page === 'hub') {
    paintHub();
    onCurrency(paintHub);
    onFavs(paintHub);
    prefs.onChange(paintHub);
    document.addEventListener('cm:targets', paintHub);
  } else {
    const here = document.querySelector(`.snav [data-s="${page}"]`);
    here?.setAttribute('aria-current', 'page');
    here?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  if (['appearance', 'preferences', 'home'].includes(page)) { initPreferences(); initPreview(); }
  if (page === 'watchlist') initWatchlist();
  if (page === 'alerts') initAlerts();
  if (page === 'data') initData();
  if (page === 'learn') initLearn();
  if (page === 'sources') initSources();
  if (page === 'advanced') initAdvanced();
  if (page === 'experimental') initExperimental();

  if (API && ['appearance', 'preferences', 'home', 'watchlist', 'alerts'].includes(page)) {
    pollPrices(data => {
      for (const c of data.coins) live.set(c.ticker, c);
      if (page === 'preferences') paintCurrencies();
      if (['appearance', 'preferences', 'home'].includes(page)) paintPreview();
      if (page === 'watchlist') { if (!document.querySelector('.wl-price') || document.querySelector('.wl-price').textContent === '–') renderWatchlist(); else updateWatchlistPrices(); }
      if (page === 'alerts') { paintAlertHint(); updateTargetMeta(); alPick?.refresh(); }
    }, () => {});
  }
}
boot();
