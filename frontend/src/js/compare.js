// Compare: up to three coins as a metric matrix, with the better value marked and plain insights.
import { initChrome, pollPrices, el, money, compactMoney, onCurrency, API } from './common.js';
import { coinPicker } from './ui.js';
import { loadMarket, buildRows, coinCell, changeSpan, distText, dateText, supplyText, insights, tag, RULES } from './intel.js';

const $ = id => document.getElementById(id);
const state = { coins: [], live: new Map(), market: null, picks: [] };

// best: 1 = higher is better, -1 = lower is better, 0 = no winner marked (size, not quality).
const METRICS = [
  { label: 'Price', cell: r => el('span', 'num', money(r.price, { stable: r.stable })) },
  { label: '24h change', get: r => r.c24, best: 1, cell: r => changeSpan(r.c24) },
  { label: '7d change', get: r => r.c7, best: 1, cell: r => changeSpan(r.c7) },
  { label: '30d change', get: r => r.c30, best: 1, cell: r => changeSpan(r.c30) },
  { label: '1y change', get: r => r.c1y, best: 1, cell: r => changeSpan(r.c1y) },
  { label: 'Market cap', get: r => r.cap, best: 1, cell: r => el('span', 'num', compactMoney(r.cap)) },
  { label: 'Rank', get: r => r.rank, best: -1, cell: r => el('span', 'num', r.rank ? '#' + r.rank : '–') },
  { label: '24h volume', get: r => r.vol, best: 1, cell: r => el('span', 'num', compactMoney(r.vol)) },
  { label: 'Volume / market cap', get: r => r.volCap, best: 0, cell: r => el('span', 'num', r.volCap == null ? '–' : r.volCap.toFixed(1) + '%') },
  { label: 'All-time high', get: r => r.ath, best: 0, cell: r => el('span', 'num', money(r.ath)) },
  { label: 'From all-time high', get: r => r.athDist, best: 1, cell: r => el('span', 'num', distText(r.athDist)) },
  { label: 'ATH date', cell: r => el('span', 'num', dateText(r.athDate)) },
  { label: 'All-time low', get: r => r.atl, best: 0, cell: r => el('span', 'num', money(r.atl)) },
  { label: 'Above all-time low', get: r => r.atlUp, best: 0, cell: r => el('span', 'num', distText(r.atlUp)) },
  { label: 'Circulating supply', get: r => r.circ, best: 0, cell: r => el('span', 'num', supplyText(r.circ)) },
  { label: 'Maximum supply', get: r => r.maxSupply, best: 0, cell: r => el('span', 'num', r.maxSupply ? supplyText(r.maxSupply) : 'No cap') },
  { label: 'Share of supply out', get: r => (r.maxSupply && r.circ ? (r.circ / r.maxSupply) * 100 : null), best: 0, cell: r => el('span', 'num', r.maxSupply && r.circ ? ((r.circ / r.maxSupply) * 100).toFixed(1) + '%' : '–') },
];

const rows = () => buildRows(state.coins, state.live, state.market);
const picked = () => state.picks.map(t => rows().find(r => r.ticker === t)).filter(Boolean);

function paintTable() {
  const list = picked();
  const head = $('cp-head'), body = $('cp-body');
  const tr = el('tr'); tr.append(el('th', '', ''));
  list.forEach(r => { const th = el('th'); th.scope = 'col'; th.append(coinCell(r)); tr.append(th); });
  head.replaceChildren(tr);
  body.replaceChildren(...METRICS.map(m => {
    const row = el('tr');
    const th = el('th', 'cp-l', m.label); th.scope = 'row'; row.append(th);
    const vals = list.map(r => (m.get ? m.get(r) : null));
    const nums = vals.filter(v => typeof v === 'number');
    const win = m.best && list.length > 1 && nums.length > 1 && new Set(nums).size > 1 ? (m.best === 1 ? Math.max(...nums) : Math.min(...nums)) : null;
    list.forEach((r, i) => {
      const td = el('td'); td.append(m.cell(r));
      if (win != null && vals[i] === win) { td.classList.add('cp-best'); td.title = 'Better of the compared coins'; }
      row.append(td);
    });
    return row;
  }));
  $('cp-h1').textContent = list.length > 1 ? list.map(r => r.ticker).join(' vs ') : 'Compare';
  document.title = (list.length > 1 ? list.map(r => r.name).join(' vs ') + ' compared' : 'Compare Cryptocurrencies') + ' | Cryptomium';
}

function paintInsights() {
  const list = picked();
  const grid = $('cp-ins-grid');
  const shown = list.map(r => ({ r, i: insights(r) })).filter(x => x.i);
  $('cp-ins').hidden = shown.length === 0;
  grid.replaceChildren(...shown.map(({ r, i }) => {
    const box = el('div', 'panel cp-ins-box');
    box.append(coinCell(r, { name: false }));
    const dl = el('dl', 'cp-dl');
    const add = (label, v, extra = '') => {
      if (!v) return;
      const dd = el('dd'); dd.append(tag(v[0], v[1]));
      if (extra) dd.append(el('span', 'cp-x num', ' ' + extra));
      dl.append(el('dt', '', label), dd);
    };
    add('Momentum', i.momentum);
    add('7-day trend', i.trend, r.c7 != null ? (r.c7 > 0 ? '+' : '−') + Math.abs(r.c7).toFixed(1) + '%' : '');
    add('Volatility', i.volatility, i.range != null ? i.range.toFixed(1) + '% 24h range' : '');
    add('Volume activity', i.activity, r.volCap != null ? r.volCap.toFixed(1) + '% of cap' : '');
    dl.append(el('dt', '', 'From all-time high'), el('dd', 'num', distText(i.athDist)));
    box.append(dl);
    return box;
  }));
  $('cp-rules').replaceChildren(...Object.entries(RULES).map(([k, v]) => el('li', '', v)));
}

function paintPickers() {
  const box = $('cp-pick');
  box.replaceChildren();
  state.picks.forEach((t, i) => {
    const b = el('button', 'cpk');
    box.append(b);
    coinPicker(b, { coins: state.coins, live: state.live, value: t, placeholder: 'Choose a coin', onChange: v => { state.picks[i] = v; state.picks = [...new Set(state.picks)]; sync(); } });
    if (state.picks.length > 2) {
      const x = el('button', 'btn btn-ghost btn-sm', 'Remove'); x.type = 'button';
      x.setAttribute('aria-label', 'Remove ' + t);
      x.addEventListener('click', () => { state.picks.splice(i, 1); sync(); paintPickers(); });
      box.append(x);
    }
  });
  if (state.picks.length < 3) {
    const add = el('button', 'btn btn-ghost btn-sm', '+ Add a coin'); add.type = 'button';
    add.addEventListener('click', () => {
      const next = state.coins.find(c => !state.picks.includes(c.ticker));
      if (next) { state.picks.push(next.ticker); sync(); paintPickers(); }
    });
    box.append(add);
  }
}

function sync() {
  history.replaceState(null, '', '/compare?coins=' + state.picks.join(','));
  paintTable(); paintInsights();
}

async function boot() {
  state.coins = await initChrome();
  const want = (new URLSearchParams(location.search).get('coins') || '').toUpperCase().split(',').filter(t => state.coins.some(c => c.ticker === t));
  state.picks = [...new Set(want)].slice(0, 3);
  for (const d of ['BTC', 'ETH']) if (state.picks.length < 2 && !state.picks.includes(d) && state.coins.some(c => c.ticker === d)) state.picks.push(d);
  paintPickers(); sync();
  onCurrency(() => { paintTable(); });
  if (!API) return;
  let first = true;
  pollPrices(d => { for (const c of d.coins) state.live.set(c.ticker, c); if (first) { first = false; paintTable(); paintInsights(); } });
  loadMarket().then(m => { state.market = m.coins; paintTable(); paintInsights(); }).catch(() => {});
}
boot();
