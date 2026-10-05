import {
  API, initChrome, getJSON, pollPrices, setLive, currency, onCurrency, money, compactMoney, pct, ago,
  isFav, toggleFav, onFavs, el, logoEl, DIR_SVG, prefs, setNum,
} from './common.js';
import { createGauge, moodClass } from './gauge.js';

const $ = id => document.getElementById(id);

const PAGE = [10, 20, 50].includes(Number(prefs.get('pageSize'))) ? Number(prefs.get('pageSize')) : 20; // rows shown first, and added by each "Show more coins"
const STABLES = new Set(['USDT', 'USDC']);
// The order the list opens in before market sizes arrive: the best-known coins first, stablecoins last.
const POPULAR = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'GRAM', 'SUI', 'XLM', 'DOT', 'LTC', 'HBAR', 'UNI', 'HYPE', 'ZEC', 'XMR', 'BCH', 'SHIB', 'NEAR', 'APT', 'ATOM', 'ICP', 'ETC', 'FIL', 'ALGO', 'USDT', 'USDC'];
const popRank = t => { const i = POPULAR.indexOf(t); return i < 0 ? 50 : i; };
const isStable = t => STABLES.has(t);

const state = {
  coins: [],            // static list (ticker, name) so the page has shape before data arrives
  live: new Map(),      // ticker -> latest coin from /api/prices
  market: {},           // ticker -> market details from /api/market
  tiles: new Map(),
  rows: new Map(),
  tab: ['all', 'fav', 'up', 'down'].includes(prefs.get('homeTab')) ? prefs.get('homeTab') : 'all',
  marketRef: {},        // price of each coin when its market details arrived, so market cap can follow the price
  sort: { key: 'default', dir: 1 },
  firstPaint: true,
  shown: PAGE,
};
const urlTab = new URLSearchParams(location.search).get('tab');
if (['all', 'fav', 'up', 'down'].includes(urlTab)) state.tab = urlTab;

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
    const tr = el('tr', 'row');
    const star = starButton(c.ticker, c.name);
    const tdStar = el('td'); tdStar.append(star);

    const tdCoin = el('td');
    const link = el('a', 'coin-cell'); link.href = '/coin/' + c.ticker;
    const logoSlot = el('span');
    const names = el('span');
    names.append(el('div', 'c-sym', c.ticker), el('div', 'c-name', c.name));
    const mini = el('span', 'mini-spark');
    names.append(mini);
    link.append(logoSlot, names);
    tdCoin.append(link);

    const tdPrice = el('td', 'price-cell num');
    const td24 = el('td', 'num');
    const td7 = el('td', 'num col-7d');
    const s24 = el('span', 'pill flat'); td24.append(s24);
    const s7 = el('span', 'pill flat'); td7.append(s7);
    const tdCap = el('td', 'num col-cap');
    const tdSpark = el('td', 'col-spark');
    const tdGo = el('td', 'go');
    tdGo.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    tr.append(tdStar, tdCoin, tdPrice, td24, td7, tdCap, tdSpark, tdGo);
    // The whole row opens the coin page, not only the logo or name.
    tr.addEventListener('click', e => { if (!e.target.closest('a, button')) location.href = link.href; });
    state.rows.set(c.ticker, { tr, star, logoSlot, tdPrice, s24, s7, tdCap, tdSpark, mini, logoDone: false });
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
  const xy = (v, i) => [(i / (values.length - 1)) * 111, 30 - ((v - min) / span) * 26];
  const pts = values.map(xy);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const area = document.createElementNS(ns, 'path');
  area.setAttribute('d', `${d}L111 34L0 34Z`);
  area.setAttribute('class', 'spark-area');
  const line = document.createElementNS(ns, 'path');
  line.setAttribute('d', d);
  line.setAttribute('class', 'spark-line');
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', pts.at(-1)[0].toFixed(1));
  dot.setAttribute('cy', pts.at(-1)[1].toFixed(1));
  dot.setAttribute('r', '2.6');
  dot.setAttribute('class', 'spark-dot');
  svg.append(area, line, dot);
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
    // The most popular coins first: biggest by market size once known, otherwise the curated order.
    // Stablecoins sit at the end so they do not get in the way of the coins people come to follow.
    const known = Object.keys(state.market).length > 0;
    list.sort((a, b) => {
      const sa = isStable(a.ticker), sb = isStable(b.ticker);
      if (sa !== sb) return sa ? 1 : -1;
      if (known) return (value(b, 'marketCap') ?? -1) - (value(a, 'marketCap') ?? -1) || popRank(a.ticker) - popRank(b.ticker);
      return popRank(a.ticker) - popRank(b.ticker);
    });
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
    setNum(r.tdPrice, live ? money(live.price, { stable: live.stable }) : '–', live?.price);
    const c24 = pct(live?.change24h);
    r.s24.textContent = c24.text; r.s24.className = 'pill ' + c24.cls;
    const c7 = pct(m?.change7d);
    r.s7.textContent = c7.text; r.s7.className = 'pill ' + c7.cls;
    const ref = state.marketRef[c.ticker];
    const scale = live?.price && ref ? live.price / ref : 1; // market size follows the live price
    r.tdCap.textContent = m?.marketCap ? compactMoney(m.marketCap * scale) : '–';
    if (m?.spark?.length > 3) {
      // The last point of the 7 day line is the live price, so the line moves with the market.
      const spark = m.spark.slice();
      if (live?.price) spark[spark.length - 1] = live.price;
      const key = spark.length + ':' + spark[0] + ':' + spark.at(-1);
      if (r.sparkKey !== key) {
        r.sparkKey = key;
        r.tdSpark.replaceChildren(sparkSvg(spark, spark.at(-1) >= spark[0]));
        r.mini.replaceChildren(sparkSvg(spark, spark.at(-1) >= spark[0]));
      }
    }
    r.star.paint();
    r.tr.classList.toggle('loading', !live);
  }
  const rows = list.slice(0, state.shown).map(c => state.rows.get(c.ticker).tr);
  const more = $('more-rows');
  more.hidden = list.length <= PAGE;
  more.textContent = state.shown >= list.length ? 'Show fewer coins' : 'Show more coins';
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
  document.querySelectorAll('#tabs .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    state.shown = PAGE;
    document.querySelectorAll('#tabs .tab').forEach(t => t.setAttribute('aria-selected', String(t === b)));
    paintTable();
  });
  document.querySelector('thead').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    if (state.sort.key === key) state.sort.dir *= -1;
    else state.sort = { key, dir: key === 'default' ? 1 : -1 };
    state.shown = PAGE;
    paintTable();
  });
  onFavs(paintTable);
  $('more-rows').addEventListener('click', () => {
    const total = visibleCoins().length;
    state.shown = state.shown >= total ? PAGE : state.shown + PAGE;
    paintTable();
  });
}

// ---------------------------------------------------------------- snapshot
function liveCap(t) {
  const m = state.market[t], live = state.live.get(t), ref = state.marketRef[t];
  if (!m?.marketCap) return null;
  return live?.price && ref ? m.marketCap * (live.price / ref) : m.marketCap;
}

function paintSnapshot() {
  let cap = 0, capAgo = 0, vol = 0;
  for (const c of state.coins) {
    const v = liveCap(c.ticker);
    if (!v) continue;
    const ch = state.live.get(c.ticker)?.change24h;
    cap += v;
    capAgo += typeof ch === 'number' ? v / (1 + ch / 100) : v;
    vol += state.market[c.ticker]?.volume24h || 0;
  }
  if (!cap) return;
  setNum($('sn-cap'), compactMoney(cap), cap);
  const chg = pct(((cap - capAgo) / capAgo) * 100);
  $('sn-cap-chg').textContent = chg.text + ' in 24 hours';
  $('sn-cap-chg').className = 'snap-c num chg ' + chg.cls;
  $('sn-vol').textContent = compactMoney(vol);
  // A seven day line for the whole market: every coin's own line, weighted by its size.
  const lines = state.coins.map(c => ({ m: state.market[c.ticker], cap: liveCap(c.ticker) })).filter(x => x.m?.spark?.length > 8 && x.cap);
  if (lines.length) {
    const len = Math.min(...lines.map(x => x.m.spark.length));
    const total = new Array(len).fill(0);
    for (const x of lines) {
      const sp = x.m.spark.slice(-len);
      const end = sp[len - 1] || 1;
      for (let i = 0; i < len; i++) total[i] += (x.cap * sp[i]) / end;
    }
    total[len - 1] = cap;
    const key = len + ':' + total[0].toFixed(0) + ':' + total.at(-1).toFixed(0);
    const host = $('sn-spark');
    if (host._k !== key) { host._k = key; host.replaceChildren(sparkSvg(total, total.at(-1) >= total[0])); }
  }
}

// ---------------------------------------------------------------- movers
let moversAt = 0;
let moversKey = '';
const moverRows = new Map();

function moverRow(c) {
  const li = el('li');
  const a = el('a', 'mv-row');
  a.href = '/coin/' + c.ticker;
  const logo = el('span', 'mv-logo');
  logo.append(logoEl(c));
  const names = el('span', 'mv-name');
  names.append(el('b', '', c.ticker), el('span', '', c.name));
  const price = el('span', 'mv-price num');
  const chg = el('span', 'pill flat');
  a.append(logo, names, price, chg);
  li.append(a);
  moverRows.set(c.ticker, { price, chg });
  return li;
}

function paintMovers() {
  const rated = [...state.live.values()].filter(c => c.price && typeof c.change24h === 'number' && !isStable(c.ticker));
  if (rated.length < 4) return;
  const now = Date.now();
  if (now - moversAt > 15000 || !moversKey) {
    moversAt = now;
    const gain = rated.filter(c => c.change24h > 0).sort((a, b) => b.change24h - a.change24h).slice(0, 3);
    const lose = rated.filter(c => c.change24h < 0).sort((a, b) => a.change24h - b.change24h).slice(0, 3);
    const key = gain.map(c => c.ticker).join() + '|' + lose.map(c => c.ticker).join();
    if (key !== moversKey) {
      moversKey = key;
      moverRows.clear();
      $('mv-up').replaceChildren(...gain.map(moverRow));
      $('mv-down').replaceChildren(...lose.map(moverRow));
      if (!gain.length) $('mv-up').replaceChildren(el('li', 'mv-none', 'No coins are up right now.'));
      if (!lose.length) $('mv-down').replaceChildren(el('li', 'mv-none', 'No coins are down right now.'));
    }
  }
  for (const [t, r] of moverRows) {
    const c = state.live.get(t);
    if (!c) continue;
    setNum(r.price, money(c.price), c.price);
    const ch = pct(c.change24h);
    r.chg.textContent = ch.text;
    r.chg.className = 'pill ' + ch.cls;
  }
  $('movers').hidden = false;
}

// ---------------------------------------------------------------- market map (treemap)
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((a, b) => a + b.weight, 0);
  const k = (w * h) / total;
  let rest = items.map(i => ({ ...i, area: i.weight * k }));
  const worst = (row, side) => {
    const sum = row.reduce((a, b) => a + b.area, 0);
    const mx = Math.max(...row.map(r => r.area)), mn = Math.min(...row.map(r => r.area));
    return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
    const area = row.reduce((a, b) => a + b.area, 0);
    if (w >= h) {
      const cw = area / h;
      let cy = y;
      for (const r of row) { const rh = r.area / cw; out.push({ ...r, x, y: cy, w: cw, h: rh }); cy += rh; }
      x += cw; w -= cw;
    } else {
      const rh = area / w;
      let cx = x;
      for (const r of row) { const rw = r.area / rh; out.push({ ...r, x: cx, y, w: rw, h: rh }); cx += rw; }
      y += rh; h -= rh;
    }
    rest = rest.slice(row.length);
  }
  return out;
}

const heat = { tiles: new Map(), key: '', period: '24h' };
const MAP_TILES = 15;
// Stepped colours: a handful of clear shades instead of a smooth blend, so the map reads at a glance.
const STEPS = { '24h': [0.4, 2, 5], '7d': [1, 5, 12] };
function mapChange(t) {
  return heat.period === '7d' ? state.market[t]?.change7d : state.live.get(t)?.change24h;
}
function stepClass(change) {
  if (typeof change !== 'number' || !Number.isFinite(change)) return 'hm-flat';
  const [a, b, c] = STEPS[heat.period];
  const m = Math.abs(change);
  if (m < a) return 'hm-flat';
  const n = m < b ? 1 : m < c ? 2 : 3;
  return (change > 0 ? 'hm-up' : 'hm-down') + n;
}
function paintMapKey() {
  const host = $('hm-key');
  if (!host) return;
  const [a, b, c] = STEPS[heat.period];
  const cells = [['hm-down3', `−${c}%`], ['hm-down2', `−${b}%`], ['hm-down1', `−${a}%`], ['hm-flat', '0'], ['hm-up1', `+${a}%`], ['hm-up2', `+${b}%`], ['hm-up3', `+${c}%`]];
  host.replaceChildren(...cells.map(([cls, text]) => { const s = el('span', 'hm-key-cell ' + cls); s.append(el('i', ''), el('small', '', text)); return s; }));
}
function paintHeatmap(force = false) {
  const host = $('heatmap');
  const all = state.coins
    .filter(c => !isStable(c.ticker))
    .map(c => ({ ticker: c.ticker, name: c.name, cap: liveCap(c.ticker) }))
    .filter(i => i.cap)
    .sort((a, b) => b.cap - a.cap);
  if (all.length < 6) return;
  $('heat').hidden = false;
  const W = host.clientWidth, H = host.clientHeight;
  if (!W || !H) return;
  const top = all.slice(0, MAP_TILES);
  const rest = all.slice(MAP_TILES);
  const key = top.map(i => i.ticker).join() + ':' + rest.length + ':' + W + 'x' + H;
  if (key !== heat.key || force) {
    heat.key = key;
    heat.tiles.clear();
    // Square-root-ish sizing keeps Bitcoin from swallowing the whole map.
    const items = top.map(i => ({ ...i, weight: i.cap ** 0.62 }));
    if (rest.length) items.push({ ticker: '', more: rest.length, weight: top.at(-1).cap ** 0.62 * 0.9 });
    const laid = squarify(items, 0, 0, W, H);
    host.replaceChildren(...laid.map(t => {
      const a = el(t.more ? 'a' : 'a', 'hm-tile');
      a.style.left = (t.x / W) * 100 + '%';
      a.style.top = (t.y / H) * 100 + '%';
      a.style.width = (t.w / W) * 100 + '%';
      a.style.height = (t.h / H) * 100 + '%';
      a.classList.add(t.w > 120 && t.h > 78 ? 'lg' : t.w > 62 && t.h > 46 ? 'md' : 'sm');
      if (t.more) {
        a.href = '/#markets';
        a.classList.add('hm-more');
        a.append(el('b', 'hm-sym', `+${t.more}`), el('span', 'hm-chg', 'More coins'));
        a.setAttribute('aria-label', `${t.more} more coins in the markets list`);
        return a;
      }
      a.href = '/coin/' + t.ticker;
      const sym = el('b', 'hm-sym', t.ticker);
      const chg = el('span', 'hm-chg num');
      const price = el('span', 'hm-price num');
      a.append(sym, chg, price);
      heat.tiles.set(t.ticker, { a, chg, price });
      return a;
    }));
  }
  paintMapKey();
  for (const [t, r] of heat.tiles) {
    const c = state.live.get(t);
    if (!c) continue;
    const change = mapChange(t);
    const ch = pct(change);
    r.chg.textContent = ch.text;
    r.price.textContent = money(c.price);
    r.a.className = r.a.className.replace(/\bhm-(?:up|down)\d|\bhm-flat\b/g, '').trim() + ' ' + stepClass(change);
    r.a.setAttribute('aria-label', `${c.name}, ${money(c.price)}, ${ch.text} over ${heat.period === '7d' ? '7 days' : '24 hours'}`);
  }
}

// ---------------------------------------------------------------- fear and greed
const fng = { gauge: null };
function paintSentiment(data) {
  const o = data?.overall;
  if (!o) return;
  if (!fng.gauge) {
    fng.gauge = createGauge({ label: 'Fear and greed index' });
    $('fng-dial').prepend(fng.gauge.svg);
  }
  fng.gauge.set(o.value);
  fng.gauge.svg.dataset.band = moodClass(o.value);
  $('fng-val').textContent = String(o.value);
  $('fng-label').textContent = o.label;
  $('fng-read').className = 'mm-read mood-read ' + moodClass(o.value);
  const hist = [['Yesterday', o.yesterday], ['Last week', o.lastWeek], ['Last month', o.lastMonth]].filter(([, v]) => v != null);
  $('fng-hist').replaceChildren(...hist.map(([l, v]) => {
    const s = el('span'); s.append(el('small', '', l), el('b', moodClass(v), `${v} · ${labelOf(v).replace('Extreme ', 'Ext. ')}`)); s.title = `${l}: ${v}, ${labelOf(v)}`; return s;
  }));
  $('fng-src').hidden = o.source !== 'alternative.me';
  $('fng').hidden = false;
}
const labelOf = v => (v < 25 ? 'Extreme fear' : v < 45 ? 'Fear' : v <= 55 ? 'Neutral' : v < 75 ? 'Greed' : 'Extreme greed');

// ---------------------------------------------------------------- latest moves
const FRESH_MS = 6 * 3600 * 1000; // an alert older than this is history, not news
let alertData = [];
let moves = [];

function buildMoves() {
  const out = [];
  for (const a of alertData) {
    if (Date.now() - Date.parse(a.at) > FRESH_MS) continue;
    const down = a.direction === 'down';
    out.push({ ticker: a.ticker, down, verb: down ? 'Fell to' : 'Rose to', price: a.price, time: ago(a.at), alert: true, stable: isStable(a.ticker) });
    if (out.length >= 4) break;
  }
  const rated = [...state.live.values()].filter(c => c.price && typeof c.change24h === 'number' && !isStable(c.ticker));
  const used = new Set(out.map(m => m.ticker));
  const add = (c, verb) => {
    if (!c || used.has(c.ticker) || out.length >= 6) return;
    used.add(c.ticker);
    out.push({ ticker: c.ticker, down: c.change24h < 0, verb, price: c.price, time: 'Today', stable: false });
  };
  if (rated.length) {
    const byChg = rated.slice().sort((a, b) => b.change24h - a.change24h);
    const top = byChg[0], bottom = byChg.at(-1);
    if (top.change24h > 0) add(top, `Leading gainer · ${pct(top.change24h).text}`);
    if (bottom.change24h < 0) add(bottom, `Biggest drop · ${pct(bottom.change24h).text}`);
    const nearHigh = rated.filter(c => state.market[c.ticker]?.high24h && c.price >= state.market[c.ticker].high24h * 0.996).sort((a, b) => b.change24h - a.change24h)[0];
    add(nearHigh, 'Near its 24 hour high');
    const nearLow = rated.filter(c => state.market[c.ticker]?.low24h && c.price <= state.market[c.ticker].low24h * 1.004).sort((a, b) => a.change24h - b.change24h)[0];
    add(nearLow, 'Near its 24 hour low');
    const busiest = rated.filter(c => state.market[c.ticker]?.volume24h).sort((a, b) => state.market[b.ticker].volume24h - state.market[a.ticker].volume24h)[0];
    if (busiest) add(busiest, `Most traded · ${compactMoney(state.market[busiest.ticker].volume24h)}`);
    for (const c of byChg) add(c, `${c.change24h >= 0 ? 'Up' : 'Down'} ${pct(Math.abs(c.change24h)).text.replace(/^[+−]/, '')} today`);
  }
  return out;
}

function paintMoves() {
  moves = buildMoves();
  const chip = $('hero-alert');
  const first = moves[0];
  if (!first) { chip.hidden = true; } else {
    chip.hidden = false;
    chip.className = 'alert-chip ' + (first.down ? 'down' : 'up');
    $('ac-text').textContent = first.alert ? `${first.ticker} ${first.verb.toLowerCase()} ${money(first.price, { stable: first.stable })}` : `${first.ticker}: ${first.verb}`;
    $('ac-time').textContent = first.alert ? first.time : 'Live';
  }
  const list = $('alert-list');
  $('alert-empty').hidden = moves.length > 0;
  list.replaceChildren(...moves.map(a => {
    const live = state.live.get(a.ticker);
    const li = el('li');
    const link = el('a', 'alert ' + (a.down ? 'down' : 'up'));
    link.href = '/coin/' + a.ticker;
    const logo = el('span', 'a-logo');
    logo.append(logoEl(live || { ticker: a.ticker, logo: '/api/logos/' + a.ticker + '.png' }));
    const badge = el('span', 'a-dir ' + (a.down ? 'down' : 'up'));
    badge.innerHTML = DIR_SVG[a.down ? 'down' : 'up'];
    logo.append(badge);
    const body = el('span', 'a-body');
    body.append(el('strong', 'a-sym', a.ticker), el('span', 'a-verb', a.verb));
    const right = el('span', 'a-right');
    right.append(el('strong', 'a-price num', money(live?.price ?? a.price, { stable: a.stable })), el('span', 'a-time', a.time));
    link.append(logo, body, right);
    li.append(link);
    return li;
  }));
}
let movesAt = 0;
function paintMovesSoon() {
  const now = Date.now();
  if (now - movesAt < 6000 && moves.length) return;
  movesAt = now;
  paintMoves();
}

async function loadAlerts() {
  try {
    alertData = (await getJSON('/api/alerts?limit=12')).alerts;
    movesAt = 0;
    paintMovesSoon();
  } catch { /* keep what is on screen */ }
}

// ---------------------------------------------------------------- boot

// ---------- In the news: one lead story and three more headlines ----------
async function loadNews() {
  if (!API) return;
  try {
    const data = await getJSON('/api/news', { timeoutMs: 20000 });
    const items = (data.items || []).slice(0, 4);
    if (items.length < 2) return;
    const tags = i => {
      const row = el('div', 'nw-tags');
      for (const t of i.coins.slice(0, 3)) row.append(el('span', 'tag', t));
      return row;
    };
    const [lead, ...rest] = items;
    const a = el('a', 'panel hn-lead');
    a.href = lead.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const kick = el('span', 'hn-kick'); kick.append(el('i'), document.createTextNode('Top story'));
    const meta = el('div', 'hn-meta'); meta.append(el('b', '', lead.publisher), el('time', '', ago(lead.at)));
    a.append(kick, el('h3', '', lead.title));
    if (lead.summary) a.append(el('p', '', lead.summary));
    a.append(meta);
    if (lead.coins.length) a.append(tags(lead));
    const list = el('ul', 'panel hn-list');
    for (const i of rest) {
      const li = el('li'); const l = el('a', 'hn-item');
      l.href = i.link; l.target = '_blank'; l.rel = 'noopener noreferrer';
      const m = el('div', 'hn-meta'); m.append(el('b', '', i.publisher), el('time', '', ago(i.at)));
      l.append(m, el('strong', '', i.title));
      if (i.coins.length) l.append(tags(i));
      li.append(l); list.append(li);
    }
    $('hn-grid').replaceChildren(a, list);
    $('home-news').hidden = false;
  } catch { /* the section stays hidden when the feeds are unreachable */ }
}

async function boot() {
  state.coins = await initChrome();
  if (!state.coins.length) return;
  buildRows();
  wireTable();
  paintTable();
  onCurrency(() => { paintTable(); paintMoves(); paintSnapshot(); paintMovers(); paintHeatmap(); });

  if (!API) {
    $('board-note').hidden = false;
    $('board-note').textContent = 'The price service is not connected yet.';
    return;
  }

  pollPrices(
    data => {
      state.live = new Map(data.coins.map(c => [c.ticker, c]));
      for (const c of data.coins) if (c.price && state.market[c.ticker] && !state.marketRef[c.ticker]) state.marketRef[c.ticker] = c.price;
      paintTable();
      paintSnapshot();
      paintMovers();
      paintHeatmap();
      paintMovesSoon();
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
    try {
      state.market = (await getJSON('/api/market')).coins;
      for (const [t, c] of state.live) if (c.price) state.marketRef[t] = c.price;
      paintTable();
      paintSnapshot();
      paintHeatmap(true);
      movesAt = 0;
      paintMovesSoon();
    } catch { /* optional detail */ }
  };
  loadMarket();
  setInterval(loadMarket, 5 * 60 * 1000);

  const loadSentiment = async () => { try { paintSentiment(await getJSON('/api/sentiment')); } catch { /* optional */ } };
  loadSentiment();
  setInterval(loadSentiment, 10 * 60 * 1000);
  $('hm-tabs')?.addEventListener('click', e => {
    const b = e.target.closest('[data-hm]');
    if (!b || b.dataset.hm === heat.period) return;
    heat.period = b.dataset.hm;
    $('hm-tabs').querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t === b)));
    paintHeatmap(true);
  });

  loadAlerts();
  setInterval(loadAlerts, 20 * 1000);
  loadNews();
  setInterval(loadNews, 10 * 60 * 1000);
  setInterval(paintMoves, 30 * 1000); // keeps "5 min ago" honest between fetches
  new ResizeObserver(() => paintHeatmap(true)).observe($('heatmap'));
}

boot();
