// Markets: the whole-market pulse, breadth, and ranked movers.
import { initChrome, pollPrices, getJSON, el, compactMoney, pct, money, setNum, onCurrency, onRecover, API } from './common.js';
import { loadMarket, buildRows, coinCell, changeSpan, distText, dateText, sparkLine, insights, tag } from './intel.js';

const $ = id => document.getElementById(id);
const state = { coins: [], live: new Map(), market: null, kind: 'moves', period: 'c24', glob: null };
const LABEL = { c1h: '1 hour', c24: '24 hours', c7: '7 days', c30: '30 days' };

const rows = () => buildRows(state.coins, state.live, state.market);

function paintPulse() {
  const g = state.glob;
  const r = rows();
  const tracked = r.reduce((a, x) => a + (x.cap || 0), 0);
  const cap = g?.marketCap ?? (tracked || null);
  setNum($('pu-cap'), compactMoney(cap), cap);
  const ch = pct(g?.marketCapChange24h ?? null);
  $('pu-cap-ch').textContent = g?.marketCapChange24h == null ? (g ? '' : 'tracked coins') : ch.text + ' 24h';
  $('pu-cap-ch').className = 'num chg ' + ch.cls;
  const vol = g?.volume24h ?? (r.reduce((a, x) => a + (x.vol || 0), 0) || null);
  $('pu-vol').textContent = compactMoney(vol);
  $('pu-vol-s').textContent = cap && vol ? (vol / cap * 100).toFixed(1) + '% of cap' : '';
  $('pu-btc').textContent = g?.btcDominance != null ? g.btcDominance.toFixed(1) + '%' : (() => {
    const btc = r.find(x => x.ticker === 'BTC');
    return btc?.cap && tracked ? ((btc.cap / tracked) * 100).toFixed(1) + '%' : '–';
  })();
  $('pu-eth').textContent = g?.ethDominance != null ? 'ETH ' + g.ethDominance.toFixed(1) + '%' : '';
  const b = g?.breadth;
  if (b) {
    $('pu-stable').textContent = b.stableShare != null ? b.stableShare.toFixed(1) + '%' : compactMoney(b.stableCap);
    $('pu-stable-s').textContent = compactMoney(b.stableCap) + ' tracked';
    $('pu-assets').textContent = g.activeAssets != null ? g.activeAssets.toLocaleString('en-US') : String(b.tracked);
    $('pu-assets-s').textContent = g.activeAssets != null ? b.tracked + ' tracked here' : 'tracked';
  }
}

// The day's standouts, moved here from the home page: the leading gainer and the biggest drop (stablecoins left out).
function paintSpotlight() {
  const host = $('mk-spot');
  const r = rows().filter(x => !x.stable && x.price && typeof x.c24 === 'number');
  if (!host || !r.length) return;
  const sorted = r.slice().sort((a, b) => b.c24 - a.c24);
  const chips = [];
  const chip = (x, label, cls) => {
    const a = el('a', 'alert-chip ' + cls);
    a.href = '/coin/' + x.ticker;
    a.append(el('span', 'ac-dot'), el('span', 'ac-text', `${x.ticker}: ${label} · ${pct(x.c24).text}`), el('span', 'ac-time num', money(x.price)));
    return a;
  };
  if (sorted[0].c24 > 0) chips.push(chip(sorted[0], 'Leading gainer', 'up'));
  if (sorted.at(-1).c24 < 0) chips.push(chip(sorted.at(-1), 'Biggest drop', 'down'));
  host.hidden = chips.length === 0;
  host.replaceChildren(...chips);
}

function paintFng(s) {
  const o = s?.overall;
  if (!o) return;
  $('pu-fng').textContent = String(Math.round(o.value));
  $('pu-fng-s').textContent = o.label;
}

function paintBreadth() {
  const r = rows().filter(x => !x.stable && typeof x.c24 === 'number');
  if (!r.length) return;
  const up = r.filter(x => x.c24 > 0.05).length, down = r.filter(x => x.c24 < -0.05).length, flat = r.length - up - down;
  const bar = $('br-bar');
  bar.replaceChildren(...[['up', up], ['flat', flat], ['down', down]].filter(([, n]) => n).map(([k, n]) => {
    const s = el('i', 'br-seg ' + k); s.style.flexGrow = String(n); return s;
  }));
  bar.setAttribute('aria-label', `${up} up, ${flat} flat, ${down} down over 24 hours`);
  $('br-legend').replaceChildren(el('span', 'up', `${up} up`), el('span', 'flat', `${flat} flat`), el('span', 'down', `${down} down`));
  const lean = up / r.length;
  $('mk-lede').textContent = lean >= .7 ? `Broad strength: ${up} of ${r.length} tracked coins are up today.`
    : lean <= .3 ? `Broad weakness: ${down} of ${r.length} tracked coins are down today.`
    : `A mixed market: ${up} tracked coins up, ${down} down today.`;

  // Tracked market value over 7 days = sum of (7d price points x circulating supply), stablecoins excluded.
  const parts = rows().filter(x => !x.stable && x.spark.length > 8 && x.circ);
  if (!parts.length) return;
  const n = Math.min(...parts.map(x => x.spark.length));
  const series = Array.from({ length: n }, (_, i) => parts.reduce((a, x) => a + x.spark[x.spark.length - n + i] * x.circ, 0));
  const change = ((series.at(-1) / series[0]) - 1) * 100;
  const p = pct(change);
  $('br-ch7').textContent = p.text;
  $('br-ch7').className = 'num chg ' + p.cls;
  $('br-spark').replaceChildren(sparkLine(series, change >= 0, { w: 360, h: 72 }));
}

const EXPLAIN = {
  moves: p => `Biggest price changes over ${LABEL[p]}. Stablecoins are left out.`,
  active: () => 'Most active = 24h volume as a share of market cap. A high share means the coin is trading unusually hard for its size. It is measured from volume, not from page views.',
  ath: () => 'Highs: closest to their all-time high. Lows: furthest below it, and the biggest recoveries from the all-time low.',
};

function list(title, items, render, tone) {
  const box = el('section', 'panel mv-box');
  const h = el('h3', 'mv-h ' + (tone || ''), title);
  const ol = el('ol', 'mv-list');
  if (!items.length) ol.append(el('li', 'empty', 'Nothing to show yet.'));
  items.forEach((r, i) => {
    const li = el('li', 'mv-row');
    li.append(el('span', 'mv-i num', String(i + 1)), coinCell(r, { name: false }));
    const v = render(r);
    li.append(...v);
    ol.append(li);
  });
  box.append(h, ol);
  return box;
}

const priceNode = r => el('span', 'mv-p num', money(r.price, { stable: r.stable }));

function paintMovers() {
  const all = rows().filter(r => !r.stable && r.price);
  const k = state.kind, p = state.period;
  $('mv-period').hidden = k !== 'moves';
  $('mv-explain').textContent = EXPLAIN[k](p);
  const grid = $('mv-grid');
  const top = (arr, n = 8) => arr.slice(0, n);
  const num = key => r => (typeof r[key] === 'number' ? r[key] : null);
  const by = (key, dir = -1) => all.filter(r => num(key)(r) != null).sort((a, b) => dir * (a[key] - b[key]));
  if (k === 'moves') {
    const sorted = by(p, -1);
    grid.replaceChildren(
      list('Top gainers', top(sorted.filter(r => r[p] > 0)), r => [priceNode(r), changeSpan(r[p])], 'up'),
      list('Top losers', top(sorted.filter(r => r[p] < 0).reverse()), r => [priceNode(r), changeSpan(r[p])], 'down')
    );
  } else if (k === 'active') {
    grid.replaceChildren(
      list('Most active', top(by('volCap')), r => [el('span', 'mv-p num', r.volCap.toFixed(1) + '% of cap'), changeSpan(r.c24)]),
      list('Highest volume', top(by('vol')), r => [el('span', 'mv-p num', compactMoney(r.vol)), changeSpan(r.c24)])
    );
  } else {
    grid.replaceChildren(
      list('Closest to all-time high', top(by('athDist')), r => [el('span', 'mv-p num', distText(r.athDist)), el('span', 'mv-d', dateText(r.athDate))], 'up'),
      list('Furthest below all-time high', top(by('athDist', 1)), r => [el('span', 'mv-p num', distText(r.athDist)), el('span', 'mv-d', dateText(r.athDate))], 'down'),
      list('Biggest recovery from low', top(by('atlUp')), r => [el('span', 'mv-p num', distText(r.atlUp)), el('span', 'mv-d', dateText(r.atlDate))])
    );
  }
}

function repaint() { paintPulse(); paintSpotlight(); paintBreadth(); paintMovers(); }

async function boot() {
  state.coins = await initChrome();
  for (const [id, key, attr] of [['mv-kind', 'kind', 'k'], ['mv-period', 'period', 'p']]) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      state[key] = b.dataset[attr];
      for (const x of $(id).children) x.setAttribute('aria-pressed', String(x === b));
      paintMovers();
    });
  }
  onCurrency(repaint);
  if (!API) return;
  let first = true;
  pollPrices(data => {
    for (const c of data.coins) state.live.set(c.ticker, c);
    if (first) { first = false; repaint(); }
  });
  loadMarket().then(m => { state.market = m.coins; repaint(); }).catch(() => { $('mv-grid').replaceChildren(el('p', 'empty', 'Market details are not available right now. Try again shortly.')); });
  const loadGlobal = () => getJSON('/api/global').then(g => { state.glob = g; paintPulse(); }).catch(() => {});
  loadGlobal(); setInterval(loadGlobal, 3 * 60_000);
  getJSON('/api/sentiment').then(paintFng).catch(() => {});
  const refreshMarket = () => loadMarket(true).then(m => { state.market = m.coins; repaint(); }).catch(() => {});
  setInterval(refreshMarket, 5 * 60_000);
  onRecover(() => { refreshMarket(); loadGlobal(); getJSON('/api/sentiment').then(paintFng).catch(() => {}); });
}
boot();
