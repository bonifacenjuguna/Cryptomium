import {
  API, initChrome, getJSON, pollPrices, currency, onCurrency, money, compactMoney, pct, ago,
  isFav, toggleFav, onFavs, el, logoEl, tileEl, paintTile, DIR_SVG,
} from './common.js';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

const ticker = (location.pathname.split('/').filter(Boolean).pop() || '').replace(/\.html$/, '').toUpperCase();
const state = { coin: null, coins: [], live: new Map(), market: null, range: '7d', history: null, alerts: [] };

// ------------------------------------------------------------------ header block
function paintHead() {
  const c = state.coin;
  if (!c) return;
  $('c-price').textContent = money(c.price, { stable: c.stable });
  const ch = pct(c.change24h);
  $('c-chg').textContent = ch.text === '–' ? '' : ch.text + ' in 24 hours';
  $('c-chg').className = 'chg num ' + ch.cls;
  $('s-24h').textContent = ch.text;
  $('s-24h').className = 'num chg ' + ch.cls;
}

function paintStats() {
  const m = state.market?.[ticker];
  const c = state.coin;
  if (!m) return;
  $('s-cap').textContent = m.marketCap ? compactMoney(m.marketCap) : '–';
  $('s-vol').textContent = m.volume24h ? compactMoney(m.volume24h) : '–';
  const c7 = pct(m.change7d);
  $('s-7d').textContent = c7.text;
  $('s-7d').className = 'num chg ' + c7.cls;
  if (m.low24h && m.high24h && m.high24h > m.low24h) {
    const stable = c?.stable;
    $('rb-low').textContent = money(m.low24h, { stable });
    $('rb-high').textContent = money(m.high24h, { stable });
    if (c?.price) {
      const at = Math.min(1, Math.max(0, (c.price - m.low24h) / (m.high24h - m.low24h)));
      $('rb-pin').style.left = (at * 100).toFixed(1) + '%';
      $('rb-pin').hidden = false;
    }
  }
}

function paintFav() {
  const b = $('c-fav');
  const on = isFav(ticker);
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', (on ? 'Unstar ' : 'Star ') + (state.coin?.name || ticker));
}

// ------------------------------------------------------------------ chart
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function timeLabel(ms, range) {
  const d = new Date(ms);
  if (range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '1y') return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function tipTime(ms, range) {
  const d = new Date(ms);
  if (range === '24h' || range === '7d') return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function svg(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function niceTicks(min, max, n = 4) {
  const span = max - min || Math.abs(max) * 0.02 || 1;
  const raw = span / n;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * 10 ** exp;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

let chartCleanup = null;
function drawChart() {
  const host = $('chart');
  if (chartCleanup) chartCleanup();
  host.replaceChildren();
  const h = state.history;
  if (!h) { host.append(el('div', 'chart-msg', 'Loading chart')); return; }
  if (h.error) { host.append(el('div', 'chart-msg', 'The chart is not available right now. Please try again in a moment.')); return; }

  const stable = state.coin?.stable;
  const pts = h.points.map(([t, p]) => [t, p * currency.rate]);
  const W = host.clientWidth || 640, H = host.clientHeight || 300;
  const padL = 4, padT = 12, padB = 26;
  const vals = pts.map(p => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  lo -= pad; hi += pad;
  // Room for the price labels on the right grows with the longest label (KES and NGN prices are long).
  const tickValues = niceTicks(lo, hi);
  const longest = Math.max(0, ...tickValues.map(v => money(v / currency.rate, { stable }).length));
  const padR = Math.min(W * 0.42, Math.max(62, longest * 6.8 + 16));
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = i => padL + (i / (pts.length - 1)) * iw;
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * ih;
  const up = vals.at(-1) >= vals[0];
  const color = cssVar(up ? '--up' : '--down');

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
  const defs = svg('defs');
  const grad = svg('linearGradient', { id: 'cg', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svg('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '.24' }), svg('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
  defs.append(grad);
  root.append(defs);

  for (const v of tickValues) {
    const yy = y(v);
    root.append(svg('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yy, y2: yy }));
    const t = svg('text', { class: 'axis-t', x: W - padR + 8, y: yy + 4 });
    t.textContent = money(v / currency.rate, { stable });
    root.append(t);
  }
  const ticks = W < 520 ? 2 : 4;
  for (let k = 0; k <= ticks; k++) {
    const i = Math.round((k / ticks) * (pts.length - 1));
    const t = svg('text', { class: 'axis-t', x: x(i), y: H - 6, 'text-anchor': k === 0 ? 'start' : k === ticks ? 'end' : 'middle' });
    t.textContent = timeLabel(pts[i][0], h.range);
    root.append(t);
  }

  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join('');
  root.append(svg('path', { d: `${d}L${x(pts.length - 1)} ${padT + ih}L${x(0)} ${padT + ih}Z`, fill: 'url(#cg)' }));
  root.append(svg('path', { class: 'line', d, stroke: color }));

  const cursor = svg('line', { class: 'cursor', y1: padT, y2: padT + ih, visibility: 'hidden' });
  const dot = svg('circle', { class: 'dot', r: 5, fill: color, visibility: 'hidden' });
  root.append(cursor, dot);
  host.append(root);

  const tip = el('div', 'chart-tip num');
  tip.hidden = true;
  host.append(tip);

  let idx = -1;
  const show = i => {
    idx = Math.max(0, Math.min(pts.length - 1, i));
    const [t, v] = pts[idx];
    const cx = x(idx), cy = y(v);
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren(document.createTextNode(money(v / currency.rate, { stable })), el('span', '', tipTime(t, h.range)));
    const w = tip.offsetWidth;
    tip.style.transform = `translate(${Math.max(0, Math.min(W - w, cx - w / 2))}px, ${Math.max(0, cy - 62)}px)`;
  };
  const hide = () => {
    idx = -1;
    cursor.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true;
  };
  const fromPointer = e => {
    const r = host.getBoundingClientRect();
    show(Math.round(((e.clientX - r.left - padL) / iw) * (pts.length - 1)));
  };
  const onKey = e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx < 0 ? pts.length - 1 : idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx < 0 ? 0 : idx + 1); }
    else if (e.key === 'Escape') hide();
  };
  host.addEventListener('pointermove', fromPointer);
  host.addEventListener('pointerdown', fromPointer);
  host.addEventListener('pointerleave', hide);
  host.addEventListener('keydown', onKey);
  host.addEventListener('blur', hide);
  chartCleanup = () => {
    host.removeEventListener('pointermove', fromPointer);
    host.removeEventListener('pointerdown', fromPointer);
    host.removeEventListener('pointerleave', hide);
    host.removeEventListener('keydown', onKey);
    host.removeEventListener('blur', hide);
  };

  const first = vals[0], last = vals.at(-1);
  const ch = pct(((last - first) / first) * 100);
  const label = `${state.coin?.name || ticker} over ${$('ranges').querySelector('[aria-selected="true"]').textContent}: ${ch.text}`;
  host.setAttribute('aria-label', label + '. Use the left and right arrow keys to read values.');
  $('c-readout').replaceChildren(document.createTextNode(label.split(': ')[0].replace(/^.* over /, 'Past ') + ' '), Object.assign(el('b', 'chg ' + ch.cls), { textContent: ch.text }));
}

async function loadHistory() {
  state.history = null;
  drawChart();
  try {
    const h = await getJSON(`/api/history/${ticker}?range=${state.range}`);
    if (state.range !== h.range) return; // the visitor already picked another range
    state.history = h;
  } catch {
    state.history = { error: true, range: state.range };
  }
  drawChart();
}

// ------------------------------------------------------------------ alerts + others
function paintAlerts() {
  $('alert-empty').hidden = state.alerts.length > 0;
  $('alert-list').replaceChildren(...state.alerts.map(a => {
    const li = el('li');
    const link = el('div', 'alert');
    const dir = el('span', 'a-dir ' + (a.direction || 'up'));
    dir.innerHTML = DIR_SVG[a.direction === 'down' ? 'down' : 'up'];
    const main = el('span', 'a-main');
    main.append(el('span', '', a.direction === 'down' ? 'Fell to ' : 'Rose to '), el('span', 'num', money(a.price, { stable: state.coin?.stable })));
    link.append(dir, main, el('span', 'a-time', ago(a.at)));
    li.append(link);
    return li;
  }));
}

function paintOthers() {
  const i = state.coins.findIndex(c => c.ticker === ticker);
  const n = state.coins.length;
  // The coins right around this one in the list, so every page links to a few neighbours.
  const picks = [];
  for (let k = 1; picks.length < 6 && k < n; k++) {
    const c = state.coins[(i + k) % n];
    if (c.ticker !== ticker) picks.push(c);
  }
  const root = $('others');
  root.replaceChildren(...picks.map((c, k) => {
    const t = tileEl(c, k);
    const li = el('li');
    li.append(t.a);
    li.tile = t;
    return li;
  }));
  paintOtherValues();
}
function paintOtherValues() {
  for (const li of $('others').children) {
    const coin = state.live.get(li.firstChild.dataset.ticker);
    if (coin) paintTile(li.tile, coin);
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  state.coins = await initChrome();
  const known = state.coins.find(c => c.ticker === ticker);
  if (!known) {
    $('coin-root').replaceChildren(el('div', 'notfound'));
    const box = $('coin-root').firstChild;
    box.append(el('h1', '', 'We do not track that coin.'), el('p', 'lede', 'Pick one of the 21 coins from the markets list.'));
    const a = el('a', 'btn btn-accent', 'Back to markets'); a.href = '/#markets'; box.append(a);
    document.title = 'Coin not found | ' + (window.CRYPTOMIUM?.brand || 'Cryptomium');
    return;
  }
  $('c-logo').replaceChildren(logoEl({ ticker, logo: null }));
  $('c-fav').addEventListener('click', () => toggleFav(ticker));
  onFavs(paintFav);
  paintFav();
  paintOthers();

  $('ranges').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b || b.dataset.range === state.range) return;
    state.range = b.dataset.range;
    $('ranges').querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t === b)));
    loadHistory();
  });
  document.addEventListener('themechange', drawChart);
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawChart, 120); }).observe($('chart'));
  onCurrency(() => { paintHead(); paintStats(); paintAlerts(); paintOtherValues(); drawChart(); });

  if (!API) return;
  loadHistory();

  pollPrices(
    data => {
      state.live = new Map(data.coins.map(c => [c.ticker, c]));
      const coin = state.live.get(ticker);
      if (coin) {
        if (!state.coin) $('c-logo').replaceChildren(logoEl(coin, ''));
        state.coin = coin;
        paintHead(); paintStats(); paintFav();
        if (state.alerts.length) paintAlerts();
      }
      paintOtherValues();
    },
    () => {}
  );

  const loadMarket = async () => {
    try { state.market = (await getJSON('/api/market')).coins; paintStats(); } catch { /* optional */ }
  };
  loadMarket();
  setInterval(loadMarket, 5 * 60 * 1000);

  const loadAlerts = async () => {
    try { state.alerts = (await getJSON(`/api/alerts?ticker=${ticker}&limit=8`)).alerts; paintAlerts(); } catch { /* keep */ }
  };
  loadAlerts();
  setInterval(loadAlerts, 60 * 1000);
  setInterval(paintAlerts, 30 * 1000);
}

boot();
