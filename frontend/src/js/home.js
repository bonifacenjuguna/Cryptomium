import {
  API, initChrome, getJSON, pollPrices, setLive, currency, onCurrency, money, compactMoney, pct, ago,
  isFav, toggleFav, onFavs, favCount, el, logoEl, DIR_SVG,
} from './common.js';

const $ = id => document.getElementById(id);

const state = {
  coins: [],            // static list (ticker, name) so the page has shape before data arrives
  live: new Map(),      // ticker -> latest coin from /api/prices
  market: {},           // ticker -> market details from /api/market
  tiles: new Map(),
  rows: new Map(),
  tab: 'all',
  sort: { key: 'default', dir: 1 },
  firstPaint: true,
  expanded: false,
};
const SMALL = window.matchMedia('(max-width: 820px)');
const COLLAPSED_ROWS = 8;

// ---------------------------------------------------------------- table
function starButton(ticker, name) {
  const b = el('button', 'fav');
  b.type = 'button';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
  const paint = () => {
    const on = isFav(ticker);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', (on ? 'Unstar ' : 'Star ') + name);
  };
  paint();
  b.addEventListener('click', () => { toggleFav(ticker); });
  b.paint = paint;
  return b;
}

function buildRows() {
  for (const c of state.coins) {
    const tr = el('tr');
    const star = starButton(c.ticker, c.name);
    const tdStar = el('td'); tdStar.append(star);

    const tdCoin = el('td');
    const link = el('a', 'coin-cell'); link.href = '/coin/' + c.ticker;
    const logoSlot = el('span');
    const names = el('span');
    names.append(el('div', 'c-sym', c.ticker), el('div', 'c-name', c.name));
    link.append(logoSlot, names);
    tdCoin.append(link);

    const tdPrice = el('td', 'price-cell num');
    const td24 = el('td', 'chg num');
    const td7 = el('td', 'chg num col-7d');
    const tdCap = el('td', 'num col-cap');
    const tdSpark = el('td', 'col-spark');
    tr.append(tdStar, tdCoin, tdPrice, td24, td7, tdCap, tdSpark);
    state.rows.set(c.ticker, { tr, star, logoSlot, tdPrice, td24, td7, tdCap, tdSpark, logoDone: false });
  }
}

function sparkSvg(values, up) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 112 34');
  svg.setAttribute('class', 'spark ' + (up ? 'up' : 'down'));
  svg.setAttribute('aria-hidden', 'true');
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 112).toFixed(1)} ${(31 - ((v - min) / span) * 28).toFixed(1)}`).join('');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function value(c, key) {
  const live = state.live.get(c.ticker), m = state.market[c.ticker];
  if (key === 'price') return live?.price ?? null;
  if (key === 'change24h') return live?.change24h ?? null;
  if (key === 'change7d') return m?.change7d ?? null;
  if (key === 'marketCap') return m?.marketCap ?? null;
  return null;
}

function visibleCoins() {
  let list = state.coins.slice();
  if (state.tab === 'fav') list = list.filter(c => isFav(c.ticker));
  if (state.tab === 'up') list = list.filter(c => (value(c, 'change24h') ?? 0) > 0);
  if (state.tab === 'down') list = list.filter(c => (value(c, 'change24h') ?? 0) < 0);

  let { key, dir } = state.sort;
  if (state.tab === 'up') { key = 'change24h'; dir = -1; }
  if (state.tab === 'down') { key = 'change24h'; dir = 1; }
  if (key === 'default') {
    // Biggest first once we know market sizes, otherwise the list's own order.
    if (Object.keys(state.market).length) list.sort((a, b) => (value(b, 'marketCap') ?? -1) - (value(a, 'marketCap') ?? -1));
    return dir === 1 ? list : list.reverse();
  }
  return list.sort((a, b) => {
    const x = value(a, key), y = value(b, key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * dir;
  });
}

function paintTable() {
  const list = visibleCoins();
  for (const c of state.coins) {
    const r = state.rows.get(c.ticker);
    const live = state.live.get(c.ticker);
    const m = state.market[c.ticker];
    if (live && !r.logoDone) { r.logoSlot.replaceChildren(logoEl(live)); r.logoDone = true; }
    else if (!live && !r.logoDone) r.logoSlot.replaceChildren(logoEl({ ticker: c.ticker, logo: null }));
    r.tdPrice.textContent = live ? money(live.price, { stable: live.stable }) : '–';
    const c24 = pct(live?.change24h);
    r.td24.textContent = c24.text; r.td24.className = 'chg num ' + c24.cls;
    const c7 = pct(m?.change7d);
    r.td7.textContent = c7.text; r.td7.className = 'chg num col-7d ' + c7.cls;
    r.tdCap.textContent = m?.marketCap ? compactMoney(m.marketCap) : '–';
    if (m?.spark?.length > 3 && r.sparkKey !== m.spark.join()) {
      r.sparkKey = m.spark.join();
      r.tdSpark.replaceChildren(sparkSvg(m.spark, m.spark.at(-1) >= m.spark[0]));
    }
    r.star.paint();
  }
  const collapse = SMALL.matches && !state.expanded && list.length > COLLAPSED_ROWS;
  const rows = (collapse ? list.slice(0, COLLAPSED_ROWS) : list).map(c => state.rows.get(c.ticker).tr);
  const more = $('more-rows');
  more.hidden = !(SMALL.matches && list.length > COLLAPSED_ROWS);
  more.textContent = state.expanded ? 'Show fewer coins' : 'Show all coins';
  const body = $('rows');
  const same = rows.length === body.children.length && rows.every((tr, i) => body.children[i] === tr);
  if (!same) body.replaceChildren(...rows);

  const empty = $('table-empty');
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    empty.textContent = state.tab === 'fav'
      ? 'Nothing starred yet. Tap the star beside a coin to keep it here.'
      : state.tab === 'up' || state.tab === 'down'
        ? (state.live.size ? 'No coins match right now.' : 'Waiting for prices.')
        : 'Waiting for prices.';
  }
  document.querySelectorAll('th[aria-sort]').forEach(th => {
    const k = th.querySelector('button')?.dataset.sort;
    th.setAttribute('aria-sort', k === state.sort.key && state.sort.key !== 'default'
      ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  });
}

function wireTable() {
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    document.querySelectorAll('#tabs .tab').forEach(t => t.setAttribute('aria-selected', String(t === b)));
    paintTable();
  });
  document.querySelector('thead').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    if (state.sort.key === key) state.sort.dir *= -1;
    else state.sort = { key, dir: key === 'default' ? 1 : -1 };
    paintTable();
  });
  onFavs(paintTable);
  $('more-rows').addEventListener('click', () => { state.expanded = !state.expanded; paintTable(); });
  SMALL.addEventListener('change', paintTable);
}

// ---------------------------------------------------------------- alerts
let alertData = [];
function paintHeroAlert() {
  const a = alertData[0];
  const chip = $('hero-alert');
  if (!a) { chip.hidden = true; return; }
  const down = a.direction === 'down';
  const stable = a.ticker === 'USDT' || a.ticker === 'USDC';
  chip.hidden = false;
  chip.className = 'alert-chip ' + (down ? 'down' : 'up');
  $('ac-text').textContent = `${a.ticker} ${down ? 'fell to' : 'rose to'} ${money(a.price, { stable })}`;
  $('ac-time').textContent = ago(a.at);
}

function paintAlerts() {
  paintHeroAlert();
  const list = $('alert-list');
  $('alert-empty').hidden = alertData.length > 0;
  list.replaceChildren(...alertData.slice(0, 8).map(a => {
    const live = state.live.get(a.ticker);
    const info = state.coins.find(c => c.ticker === a.ticker) || { ticker: a.ticker, name: a.ticker };
    const down = a.direction === 'down';
    const li = el('li');
    const link = el('a', 'alert ' + (down ? 'down' : 'up'));
    link.href = '/coin/' + a.ticker;
    const logo = el('span', 'a-logo');
    logo.append(logoEl(live || { ticker: a.ticker, logo: '/api/logos/' + a.ticker + '.png' }));
    const badge = el('span', 'a-dir ' + (down ? 'down' : 'up'));
    badge.innerHTML = DIR_SVG[down ? 'down' : 'up'];
    logo.append(badge);
    const body = el('span', 'a-body');
    body.append(el('strong', 'a-sym', a.ticker), el('span', 'a-verb', (down ? 'Fell to' : 'Rose to')));
    const right = el('span', 'a-right');
    const stable = a.ticker === 'USDT' || a.ticker === 'USDC';
    right.append(el('strong', 'a-price num', money(a.price, { stable })), el('span', 'a-time', ago(a.at)));
    link.append(logo, body, right);
    li.append(link);
    return li;
  }));
}

async function loadAlerts() {
  try {
    alertData = (await getJSON('/api/alerts?limit=8')).alerts;
    paintAlerts();
  } catch { /* keep what is on screen */ }
}

// ---------------------------------------------------------------- boot
async function boot() {
  state.coins = await initChrome();
  if (!state.coins.length) return;
  buildRows();
  wireTable();
  paintTable();
  onCurrency(() => { paintTable(); paintAlerts(); });

  if (!API) {
    $('board-note').hidden = false;
    $('board-note').textContent = 'The price service is not connected yet.';
    return;
  }

  pollPrices(
    data => {
      state.live = new Map(data.coins.map(c => [c.ticker, c]));
      paintTable();
      $('board-note').hidden = true;
    },
    s => {
      setLive($('live'), s);
      if (s !== 'live' && !state.live.size) {
        $('board-note').hidden = false;
        $('board-note').textContent = 'Prices are taking longer than usual to load. We keep trying, so this page will fill in on its own.';
      }
    }
  );

  const loadMarket = async () => {
    try { state.market = (await getJSON('/api/market')).coins; paintTable(); } catch { /* optional detail */ }
  };
  loadMarket();
  setInterval(loadMarket, 5 * 60 * 1000);

  loadAlerts();
  setInterval(() => { loadAlerts(); }, 60 * 1000);
  setInterval(paintAlerts, 30 * 1000); // keeps "5 min ago" honest between fetches
}

boot();
