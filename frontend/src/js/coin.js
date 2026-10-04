import {
  API, initChrome, getJSON, pollPrices, currency, currencySymbol, onCurrency, money, compactMoney, pct, ago,
  isFav, toggleFav, onFavs, el, logoEl, tileEl, paintTile, DIR_SVG, prefs, setNum,
} from './common.js';
import { createChart } from './chart.js';

const $ = id => document.getElementById(id);

const ticker = (location.pathname.split('/').filter(Boolean).pop() || '').replace(/\.html$/, '').toUpperCase();
const RANGES = ['24h', '7d', '30d', '90d', '1y'];
const state = {
  coin: null, coins: [], live: new Map(), market: null, alerts: [],
  range: RANGES.includes(prefs.get('chartRange')) ? prefs.get('chartRange') : '7d',
  type: prefs.get('chartType') === 'candles' ? 'candles' : 'line',
  marketRef: null,
};
let chart = null;
let convertFrom = 'coin';

// ------------------------------------------------------------------ header block
function paintHead() {
  const c = state.coin;
  if (!c) return;
  setNum($('c-price'), money(c.price, { stable: c.stable }), c.price);
  document.title = `${money(c.price, { stable: c.stable })} ${c.name} (${ticker}) | ${window.CRYPTOMIUM?.brand || 'Cryptomium'}`;
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
  const ref = state.marketRef;
  const scale = c?.price && ref ? c.price / ref : 1; // market size follows the live price
  if (m.marketCap) $('s-cap').textContent = compactMoney(m.marketCap * scale);
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
const RANGE_LABEL = { '24h': '24H', '7d': '7D', '30d': '30D', '90d': '90D', '1y': '1Y' };

async function loadChart() {
  const { type, range } = state;
  chart.setData({ type, range, message: 'Loading chart' });
  try {
    const h = await getJSON(`/api/history/${ticker}?range=${range}${type === 'candles' ? '&style=candles' : ''}`);
    if (state.type !== type || state.range !== range) return; // the visitor already picked something else
    chart.setData(type === 'candles' ? { type, range, candles: h.candles } : { type, range, points: h.points });
    if (state.coin?.price) chart.tick(state.coin.price);
  } catch {
    if (state.type === type && state.range === range) chart.setData({ type, range, message: 'The chart is not available right now. Please try again in a moment.' });
  }
}

function paintToolbar() {
  $('ranges').querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.range === state.range)));
  $('chart-type').querySelectorAll('.seg').forEach(t => t.setAttribute('aria-pressed', String(t.dataset.type === state.type)));
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
  $('c-logo').replaceChildren(logoEl({ ticker, logo: null }));
  $('c-fav').addEventListener('click', () => toggleFav(ticker));
  onFavs(paintFav);
  paintFav();
  paintOthers();

  chart = createChart($('chart'), {
    stable: known.stable,
    onChange: (ch, range) => {
      $('c-readout').replaceChildren(document.createTextNode('Past ' + RANGE_LABEL[range] + ' '), Object.assign(el('b', 'chg ' + ch.cls), { textContent: ch.text }));
    },
  });
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
    if (!b || b.dataset.type === state.type) return;
    state.type = b.dataset.type;
    paintToolbar();
    loadChart();
  });
  document.addEventListener('themechange', () => chart.redraw());
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => chart.redraw(), 120); }).observe($('chart'));
  onCurrency(() => { paintHead(); paintStats(); paintAlerts(); paintOtherValues(); chart.redraw(); paintConverter(true); });

  if (!API) return;
  loadChart();

  pollPrices(
    data => {
      state.live = new Map(data.coins.map(c => [c.ticker, c]));
      const coin = state.live.get(ticker);
      if (coin) {
        if (!state.coin) $('c-logo').replaceChildren(logoEl(coin, ''));
        state.coin = coin;
        if (state.market && state.marketRef == null) state.marketRef = coin.price;
        paintHead(); paintStats(); paintFav(); paintConverter();
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
    } catch { /* optional */ }
  };
  loadMarket();
  setInterval(loadMarket, 5 * 60 * 1000);

  const loadAlerts = async () => {
    try { state.alerts = (await getJSON(`/api/alerts?ticker=${ticker}&limit=8`)).alerts; paintAlerts(); } catch { /* keep */ }
  };
  loadAlerts();
  setInterval(loadAlerts, 20 * 1000);
  setInterval(paintAlerts, 30 * 1000);
}

boot();
