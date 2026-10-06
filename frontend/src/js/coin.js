import {
  API, initChrome, getJSON, pollPrices, onRecover, currency, currencySymbol, onCurrency, money, compactMoney, pct, ago,
  isFav, toggleFav, onFavs, el, logoEl, tileEl, paintTile, DIR_SVG, prefs, setNum, copyText, toast,
} from './common.js';
import { createChart } from './chart.js';
import { coinPicker } from './ui.js';
import { pushLayer } from './backstack.js';
import { createGauge, moodClass } from './gauge.js';
import { loadTargets, addTarget, removeTarget, describe } from './targets.js';
import { buildRows, insights, stableInsights, tag, distText, dateText, RULES } from './intel.js';
import { ABOUT } from './about-coins.js';

const $ = id => document.getElementById(id);

const OLD_TICKERS = { TON: 'GRAM' }; // renamed coins: an old bookmark or shared link still lands on the right page
const rawTicker = (location.pathname.split('/').filter(Boolean).pop() || '').replace(/\.html$/, '').toUpperCase();
const ticker = OLD_TICKERS[rawTicker] || rawTicker;
if (ticker !== rawTicker) history.replaceState(null, '', '/coin/' + ticker);
const RANGES = ['24h', '7d', '30d', '90d', '1y'];
const state = {
  coin: null, coins: [], live: new Map(), market: null, alerts: [],
  range: RANGES.includes(prefs.get('chartRange')) ? prefs.get('chartRange') : '7d',
  type: prefs.get('chartType') === 'candles' ? 'candles' : 'line',
  marketRef: null,
  cmp: '', // ticker of the coin laid over this one, or ''
};
const compactNum = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
let chart = null;
let convertFrom = 'coin';
let cmpPick = null;
let acDir = 'above';

// ------------------------------------------------------------------ header block
function setChg(node, change) {
  const ch = pct(change);
  node.textContent = ch.text;
  node.className = 'num chg ' + ch.cls;
}

function paintHead() {
  const c = state.coin;
  if (!c) return;
  setNum($('c-price'), money(c.price, { stable: c.stable }), c.price);
  if (prefs.get('tabPrice') !== false) document.title = `${money(c.price, { stable: c.stable })} ${c.name} (${ticker}) | ${window.CRYPTOMIUM?.brand || 'Cryptomium'}`;
  const ch = pct(c.change24h);
  $('c-chg').textContent = ch.text === '–' ? '' : ch.text + ' 24h';
  $('c-chg').className = 'chg num ' + ch.cls;
  setChg($('p-24h'), c.change24h);
}

function paintInsights() {
  const r = buildRows(state.coins, state.live, state.market).find(x => x.ticker === ticker);
  const sec = $('coin-insights');
  const dl = $('ci-dl');
  const rows = [];
  const add = (label, v, extra = '') => { if (!v) return; const dd = el('dd'); dd.append(tag(v[0], v[1])); if (extra) dd.append(el('span', 'cp-x num', ' ' + extra)); rows.push(el('dt', '', label), dd); };
  const s = r?.stable ? stableInsights(r) : null;
  const i = r?.stable ? null : insights(r);
  if (s) {
    add('Peg to $1', s.peg, (s.dev < 0.005 ? 'on the dot' : s.dev.toFixed(2) + '% away'));
    add('24h range', s.range == null ? null : [s.range < 0.3 ? 'Tight' : s.range < 1 ? 'Normal' : 'Wide', s.range < 1 ? 'flat' : 'warn'], s.range != null ? s.range.toFixed(2) + '%' : '');
    add('Volume activity', s.activity, r.volCap != null ? r.volCap.toFixed(1) + '% of cap' : '');
    $('ci-rules').replaceChildren(...[RULES.peg, RULES.activity].map(v => el('li', '', v)));
  } else if (i && r.price) {
    add('Momentum', i.momentum);
    add('7-day trend', i.trend, r.c7 != null ? (r.c7 > 0 ? '+' : '−') + Math.abs(r.c7).toFixed(1) + '%' : '');
    add('Volatility', i.volatility, i.range != null ? i.range.toFixed(1) + '% 24h range' : '');
    add('Volume activity', i.activity, r.volCap != null ? r.volCap.toFixed(1) + '% of cap' : '');
    rows.push(el('dt', '', 'From all-time high'), el('dd', 'num', `${distText(r.athDist)} (high on ${dateText(r.athDate)})`));
    rows.push(el('dt', '', 'Above all-time low'), el('dd', 'num', `${distText(r.atlUp)} (low on ${dateText(r.atlDate)})`));
    $('ci-rules').replaceChildren(...Object.entries(RULES).filter(([k]) => k !== 'peg').map(([, v]) => el('li', '', v)));
  }
  // The section is always on the page so every coin looks the same; it says so when the numbers are not in yet.
  $('ci-empty').hidden = rows.length > 0;
  $('ci-panel-body').hidden = rows.length === 0;
  dl.replaceChildren(...rows);
}

let newsLoaded = false;
async function loadCoinNews() {
  if (newsLoaded) return;
  newsLoaded = true;
  const row = n => {
    const li = el('li', 'nw-item');
    const a = el('a', 'nw-title', n.title); a.href = n.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const meta = el('div', 'nw-meta'); meta.append(el('b', '', n.publisher), el('span', '', ago(n.at)));
    li.append(meta, a);
    return li;
  };
  try {
    const data = await getJSON('/api/news', { timeoutMs: 20000 });
    const mine = data.items.filter(n => n.coins.includes(ticker)).slice(0, 4);
    if (mine.length) { $('cn-list').replaceChildren(...mine.map(row)); $('cn-note').hidden = true; return; }
    // No headline names this coin right now: say so, and show the latest general ones so the section is never empty.
    const latest = data.items.slice(0, 3);
    $('cn-note').textContent = `No recent headlines name ${state.coin?.name || ticker}. Here is the latest from the wider market.`;
    $('cn-note').hidden = false;
    $('cn-list').replaceChildren(...latest.map(row));
  } catch {
    $('cn-note').textContent = 'Headlines are not reachable right now. Try again in a few minutes.';
    $('cn-note').hidden = false;
    newsLoaded = false;
  }
}

function paintStats() {
  const m = state.market?.[ticker];
  const c = state.coin;
  if (!m) return;
  const ref = state.marketRef;
  const scale = c?.price && ref ? c.price / ref : 1; // market size follows the live price
  const cap = m.marketCap ? m.marketCap * scale : null;
  $('s-cap').textContent = cap ? compactMoney(cap) : '–';
  $('s-vol').textContent = m.volume24h ? compactMoney(m.volume24h) : '–';
  $('s-turn').textContent = cap && m.volume24h ? ((m.volume24h / cap) * 100).toFixed(1) + '%' : '–';
  $('s-circ').textContent = m.circulating ? compactNum.format(m.circulating) + ' ' + ticker : '–';
  $('s-max').textContent = m.maxSupply ? compactNum.format(m.maxSupply) + ' ' + ticker : (m.circulating ? 'No fixed limit' : '–');
  if (m.rank) { $('c-rank').hidden = false; $('c-rank').textContent = 'Rank #' + m.rank; }
  setChg($('p-1h'), m.change1h);
  setChg($('p-7d'), m.change7d);
  setChg($('p-30d'), m.change30d);
  setChg($('p-1y'), m.change1y);
  if (m.ath) {
    $('s-ath').textContent = money(m.ath, { stable: c?.stable });
    const when = m.athDate ? new Date(m.athDate).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const away = c?.price ? ((c.price - m.ath) / m.ath) * 100 : null;
    const awayText = away == null ? '' : (away >= -0.05 ? 'At its high' : pct(away).text + ' from the high');
    $('s-ath-sub').textContent = [when, awayText].filter(Boolean).join(' · ') || '\u00a0';
  }
  if (m.low24h && m.high24h && m.high24h > m.low24h) {
    const stable = c?.stable;
    // A new high or low reached while the page is open widens the range straight away.
    const hi = Math.max(m.high24h, c?.price || 0);
    const lo = Math.min(m.low24h, c?.price || Infinity);
    $('rb-low').textContent = money(lo, { stable });
    $('rb-high').textContent = money(hi, { stable });
    if (c?.price) {
      const at = Math.min(1, Math.max(0, (c.price - lo) / (hi - lo)));
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

async function loadChart() {
  const { type, range, cmp } = state;
  const mode = cmp ? 'compare' : type;
  chart.setData({ type: mode, range, message: 'Loading chart' });
  const same = () => state.type === type && state.range === range && state.cmp === cmp;
  try {
    if (cmp) {
      const [a, b] = await Promise.all([
        getJSON(`/api/history/${ticker}?range=${range}`),
        getJSON(`/api/history/${cmp}?range=${range}`),
      ]);
      if (!same()) return;
      chart.setData({ type: 'compare', range, series: [{ label: ticker, points: a.points }, { label: cmp, points: b.points }] });
      return;
    }
    const h = await getJSON(`/api/history/${ticker}?range=${range}${type === 'candles' ? '&style=candles' : ''}`);
    if (!same()) return; // the visitor already picked something else
    chart.setData(type === 'candles' ? { type, range, candles: h.candles } : { type, range, points: h.points });
    if (state.coin?.price) chart.tick(state.coin.price);
  } catch {
    if (same()) chart.setData({ type: mode, range, message: 'The chart is not available right now. Please try again in a moment.' });
  }
}

function paintToolbar() {
  $('ranges').querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.range === state.range)));
  $('chart-type').querySelectorAll('.seg').forEach(t => t.setAttribute('aria-pressed', String(!state.cmp && t.dataset.type === state.type)));
  cmpPick?.set(state.cmp);
  $('cmp-clear').hidden = !state.cmp;
  $('chart-card').classList.toggle('is-compare', Boolean(state.cmp));
}

let fullRelease = null;
function setFull(on) {
  const card = $('chart-card');
  if (on && !fullRelease) fullRelease = pushLayer(() => { fullRelease = null; setFull(false); });
  if (!on && fullRelease) { const r = fullRelease; fullRelease = null; r(); }
  card.classList.toggle('is-full', on);
  document.body.classList.toggle('chart-open', on);
  const b = $('chart-full');
  b.setAttribute('aria-label', on ? 'Close full screen' : 'Full screen chart');
  b.setAttribute('title', on ? 'Close' : 'Full screen');
  b.classList.toggle('on', on);
  requestAnimationFrame(() => chart.redraw());
}

// ------------------------------------------------------------------ converter
function paintConverter(force = false) {
  const c = state.coin;
  if (!c?.price) return;
  const perCoin = c.price * currency.rate;
  const coinIn = $('cv-coin'), fiatIn = $('cv-fiat');
  $('cv-code').textContent = currency.code;
  $('cv-sym').textContent = ticker;
  const fmt = (v, small) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: small }) : '');
  const num = x => Number(String(x).replace(/,/g, ''));
  if (convertFrom === 'coin') {
    if (force || document.activeElement !== fiatIn) fiatIn.value = fmt(num(coinIn.value) * perCoin, perCoin < 1 ? 6 : 2);
  } else if (force || document.activeElement !== coinIn) {
    coinIn.value = fmt(num(fiatIn.value) / perCoin, 8);
  }
}
function wireConverter() {
  $('cv-coin').addEventListener('input', () => { convertFrom = 'coin'; paintConverter(true); });
  $('cv-fiat').addEventListener('input', () => { convertFrom = 'fiat'; paintConverter(true); });
}

// ------------------------------------------------------------------ alerts + others
function paintAlerts() {
  $('alert-empty').hidden = state.alerts.length > 0;
  $('alert-list').replaceChildren(...state.alerts.map(a => {
    const down = a.direction === 'down';
    const li = el('li');
    const link = el('div', 'alert ' + (down ? 'down' : 'up'));
    const logo = el('span', 'a-logo');
    logo.append(logoEl(state.coin || { ticker, logo: null }));
    const badge = el('span', 'a-dir ' + (down ? 'down' : 'up'));
    badge.innerHTML = DIR_SVG[down ? 'down' : 'up'];
    logo.append(badge);
    const body = el('span', 'a-body');
    body.append(el('strong', 'a-sym', ticker), el('span', 'a-verb', down ? 'Fell to' : 'Rose to'));
    const right = el('span', 'a-right');
    right.append(el('strong', 'a-price num', money(a.price, { stable: state.coin?.stable })), el('span', 'a-time', ago(a.at)));
    link.append(logo, body, right);
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

// ------------------------------------------------------------------ price alert card
const parseNum = text => Number(String(text).replace(/,/g, '').trim());
const QUICK = { above: [5, 10, 25, 50], below: [-5, -10, -25, -50] };

function paintAlertCard(rebuild = false) {
  const c = state.coin;
  if (!c?.price) return;
  $('ac-code').textContent = currency.code;
  $('ac-now').textContent = money(c.price, { stable: c.stable });
  const chips = $('ac-chips');
  if (rebuild || !chips.children.length || chips.dataset.dir !== acDir) {
    chips.dataset.dir = acDir;
    chips.replaceChildren(...QUICK[acDir].map(p => {
      const b = el('button', 'ac-chip', (p > 0 ? '+' : '−') + Math.abs(p) + '%');
      b.type = 'button';
      b.addEventListener('click', () => {
        const target = state.coin.price * currency.rate * (1 + p / 100);
        $('ac-price').value = target.toLocaleString('en-US', { maximumFractionDigits: target < 1 ? 6 : 2, useGrouping: false });
        setHint('');
      });
      return b;
    }));
  }
  const input = $('ac-price');
  if (!input.value) input.placeholder = money(c.price, { stable: c.stable }).replace(/[^\d.,]/g, '');
  paintAlertList();
}

function setHint(text, bad = false) {
  const h = $('ac-hint');
  h.textContent = text || 'We will tell you here, and with a notification, while Cryptomium is open.';
  h.classList.toggle('bad', bad);
}

function paintAlertList() {
  const mine = loadTargets().filter(t => t.ticker === ticker);
  $('ac-list').replaceChildren(...mine.map(t => {
    const li = el('li', 'ac-item' + (t.firedAt ? ' reached' : ''));
    const text = el('span', 'ac-item-t');
    if (t.dir !== 'above' && t.dir !== 'below') text.append(el('b', '', describe(t)), el('span', '', t.firedAt ? 'Reached ' + ago(new Date(t.firedAt).toISOString()) : 'Watching'));
    else text.append(el('b', 'num', money(t.price, { stable: state.coin?.stable })), el('span', '', t.firedAt ? 'Reached ' + ago(new Date(t.firedAt).toISOString()) : (t.dir === 'above' ? 'Rises to' : 'Falls to')));
    const del = el('button', 'icon-btn');
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete this alert');
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.addEventListener('click', () => removeTarget(t.id));
    li.append(text, del);
    return li;
  }));
}

function wireAlertCard() {
  setHint('');
  $('ac-form').querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => {
    acDir = b.dataset.dir;
    $('ac-form').querySelectorAll('[data-dir]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    paintAlertCard(true);
    setHint('');
  }));
  $('ac-form').addEventListener('submit', e => {
    e.preventDefault();
    const shown = parseNum($('ac-price').value);
    if (!(shown > 0)) { setHint('Enter the price you are waiting for.', true); return; }
    const usd = shown / currency.rate;
    const now = state.coin?.price;
    if (now) {
      if (acDir === 'above' && now >= usd) { setHint(`${ticker} is already above that. Pick a higher price.`, true); return; }
      if (acDir === 'below' && now <= usd) { setHint(`${ticker} is already below that. Pick a lower price.`, true); return; }
    }
    addTarget({ ticker, dir: acDir, price: usd });
    $('ac-price').value = '';
    setHint(`Done. We will tell you when ${ticker} ${acDir === 'above' ? 'reaches' : 'drops to'} ${money(usd, { stable: state.coin?.stable })}.`);
    if ('Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch { /* optional */ }
    }
  });
  document.addEventListener('cm:targets', paintAlertList);
  setInterval(paintAlertList, 30000);
  paintAlertList();
}

// ------------------------------------------------------------------ fear and greed for this coin
const moodGauge = { g: null };
async function loadSentiment() {
  try {
    const data = await getJSON('/api/sentiment');
    const mine = data.coins?.[ticker];
    if (!mine) return;
    if (!moodGauge.g) { moodGauge.g = createGauge({ label: ticker + ' fear and greed' }); $('cm-dial').prepend(moodGauge.g.svg); }
    moodGauge.g.set(mine.value);
    moodGauge.g.svg.dataset.band = moodClass(mine.value);
    $('cm-val').textContent = String(mine.value);
    $('cm-label').textContent = mine.value < 25 ? 'Extreme fear' : mine.value < 45 ? 'Fear' : mine.value <= 55 ? 'Neutral' : mine.value < 75 ? 'Greed' : 'Extreme greed';
    $('cm-read').className = 'mm-read mood-read ' + moodClass(mine.value);
    const o = data.overall;
    $('cm-overall').textContent = o ? `${o.value} · ${o.label}` : '–';
    $('cm-overall').closest('.mc-row').hidden = !o;
    $('coin-mood').hidden = false;
  } catch { /* optional */ }
}

// Once the big price scrolls away, the coin's logo, ticker and live price move into the top bar (like a native finance app).
function initBarCoin(known) {
  const bar = document.querySelector('.site-header .bar');
  const price = $('c-price');
  if (!bar || !price || !('IntersectionObserver' in window)) return;
  const box = el('div', 'ab-coin');
  box.setAttribute('aria-hidden', 'true');
  const sym = el('b', '', ticker);
  const live = el('span', 'num');
  box.append(logoEl({ ticker, logo: known.logo || null }, 'sm'), sym, live);
  bar.appendChild(box);
  const sync = () => { live.textContent = price.textContent; };
  new MutationObserver(sync).observe(price, { childList: true, characterData: true, subtree: true });
  sync();
  const root = document.documentElement;
  new IntersectionObserver(([e]) => root.classList.toggle('coin-collapsed', !e.isIntersecting && e.boundingClientRect.top < 100),
    { rootMargin: '-64px 0px 0px 0px', threshold: 0 }).observe(price);
}

// ------------------------------------------------------------------ boot
async function boot() {
  state.coins = await initChrome();
  const known = state.coins.find(c => c.ticker === ticker);
  if (!known) {
    $('coin-root').replaceChildren(el('div', 'notfound'));
    const box = $('coin-root').firstChild;
    box.append(el('h1', '', 'We do not track that coin.'), el('p', 'lede', 'Pick one of the coins from the markets list.'));
    const a = el('a', 'btn btn-accent', 'Back to markets'); a.href = '/#markets'; box.append(a);
    document.title = 'Coin not found | ' + (window.CRYPTOMIUM?.brand || 'Cryptomium');
    return;
  }
  $('c-logo').replaceChildren(logoEl({ ticker, logo: known.logo || null }, 'xl'));
  if (String(known.name || '').trim().toUpperCase() === ticker) $('c-sym').hidden = true; // the name already is the ticker
  initBarCoin(known);
  $('c-fav').addEventListener('click', () => toggleFav(ticker));
  onFavs(paintFav);
  paintFav();
  paintOthers();

  chart = createChart($('chart'), { stable: known.stable, legend: $('c-legend') });
  $('about-text').textContent = ABOUT[ticker] || '';
  $('about-card').hidden = !ABOUT[ticker];
  cmpPick = coinPicker($('cmp-btn'), {
    coins: state.coins, live: state.live, exclude: ticker, placeholder: 'Compare with…', none: 'No comparison',
    onChange: v => { state.cmp = v; paintToolbar(); loadChart(); },
  });
  $('cmp-clear').addEventListener('click', () => { state.cmp = ''; paintToolbar(); loadChart(); });
  $('chart-full').addEventListener('click', () => setFull(!$('chart-card').classList.contains('is-full')));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('chart-card').classList.contains('is-full')) setFull(false); });
  $('c-price').addEventListener('click', async () => {
    if (!state.coin?.price) return;
    const text = $('c-price').textContent.replace(/[^\d.,]/g, '');
    if (await copyText(text)) toast('Price copied: ' + $('c-price').textContent, { ms: 2200 });
  });
  $('c-share').addEventListener('click', async () => {
    const url = location.origin + '/coin/' + ticker;
    if (navigator.share) { try { await navigator.share({ title: `${known.name} price`, url }); return; } catch { return; } }
    if (await copyText(url)) toast('Link copied', { ms: 2200 });
  });
  wireAlertCard();
  loadSentiment();
  setInterval(loadSentiment, 10 * 60 * 1000);
  paintToolbar();
  wireConverter();
  $('ranges').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b || b.dataset.range === state.range) return;
    state.range = b.dataset.range;
    paintToolbar();
    loadChart();
  });
  $('chart-type').addEventListener('click', e => {
    const b = e.target.closest('[data-type]');
    if (!b || (b.dataset.type === state.type && !state.cmp)) return;
    state.type = b.dataset.type;
    state.cmp = '';
    paintToolbar();
    loadChart();
  });
  document.addEventListener('themechange', () => chart.redraw());
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => chart.redraw(), 120); }).observe($('chart'));
  onCurrency(() => { paintHead(); paintStats(); paintAlerts(); paintOtherValues(); chart.redraw(); paintConverter(true); paintAlertCard(true); });

  if (!API) return;
  loadChart();

  pollPrices(
    data => {
      state.live = new Map(data.coins.map(c => [c.ticker, c]));
      const coin = state.live.get(ticker);
      if (coin) {
        if (!state.coin) $('c-logo').replaceChildren(logoEl(coin, 'xl'));
        state.coin = coin;
        if (state.market && state.marketRef == null) state.marketRef = coin.price;
        paintHead(); paintStats(); paintFav(); paintConverter(); paintAlertCard();
        chart.tick(coin.price);
        if (state.alerts.length) paintAlerts();
      }
      paintOtherValues();
    },
    () => {}
  );

  const loadMarket = async () => {
    try {
      state.market = (await getJSON('/api/market')).coins;
      state.marketRef = state.coin?.price ?? null; // market size follows the live price from here
      paintStats();
      paintInsights();
    } catch { /* optional */ }
  };
  loadMarket();
  setInterval(loadMarket, 5 * 60 * 1000);
  if (window.requestIdleCallback) window.requestIdleCallback(loadCoinNews, { timeout: 4000 }); else setTimeout(loadCoinNews, 1500);

  const loadAlerts = async () => {
    try { state.alerts = (await getJSON(`/api/alerts?ticker=${ticker}&limit=8`)).alerts; paintAlerts(); } catch { /* keep */ }
  };
  loadAlerts();
  setInterval(loadAlerts, 20 * 1000);
  setInterval(paintAlerts, 30 * 1000);
  onRecover(() => { loadMarket(); loadAlerts(); loadChart(); }); // connection is back: refresh in place, no reload
}

boot();
