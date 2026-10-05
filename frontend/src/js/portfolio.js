// Portfolio: holdings kept on this device, valued with the live prices.
import { coinPicker } from './ui.js';
import { API, initChrome, pollPrices, holdings, money, pct, el, logoEl, setNum, currency, onCurrency } from './common.js';
import { loadMarket, sparkLine } from './intel.js';

const $ = id => document.getElementById(id);
const live = new Map();
let mk = {};
let coins = [];
let list = holdings.load();

const parse = text => Number(String(text).replace(/,/g, '').trim());
const amountText = n => n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 8 : 6 });

function totals() {
  let total = 0, ago = 0;
  const rows = list.map(h => {
    const c = live.get(h.ticker);
    const value = c?.price ? c.price * h.amount : null;
    if (value != null) {
      total += value;
      ago += typeof c.change24h === 'number' ? value / (1 + c.change24h / 100) : value;
    }
    return { h, c, value };
  });
  return { rows, total, ago };
}

function paintSummary(t) {
  const has = list.length > 0;
  $('pf-intro').hidden = has;
  $('alloc').hidden = !has;
  $('alloc-legend').hidden = !has;
  if (!has || !t.total) {
    $('pf-total').textContent = has ? '–' : money(1).replace(/[\d.,]+/, '0.00');
    $('pf-chg').textContent = ' ';
    $('pf-chg').className = 'pf-chg num chg flat';
    $('alloc').replaceChildren();
    $('alloc-legend').replaceChildren();
    return;
  }
  setNum($('pf-total'), money(t.total), t.total);
  const delta = t.total - t.ago;
  const ch = pct(((t.total - t.ago) / t.ago) * 100);
  $('pf-chg').textContent = `${delta >= 0 ? '+' : '−'}${money(Math.abs(delta))} (${ch.text}) today`;
  $('pf-chg').className = 'pf-chg num chg ' + ch.cls;

  const parts = t.rows.filter(r => r.value).sort((a, b) => b.value - a.value);
  const top = parts.slice(0, 5);
  const other = parts.slice(5).reduce((a, b) => a + b.value, 0);
  const segs = top.map((r, i) => ({ label: r.h.ticker, v: r.value, i }));
  if (other > 0) segs.push({ label: 'Other', v: other, i: 5 });
  $('alloc').replaceChildren(...segs.map(s => {
    const seg = el('i', 'al-seg c' + s.i);
    seg.style.flexGrow = String(s.v);
    return seg;
  }));
  $('alloc-legend').replaceChildren(...segs.map(s => {
    const li = el('li');
    li.append(el('i', 'al-dot c' + s.i), el('b', '', s.label), el('span', 'num', ((s.v / t.total) * 100).toFixed(1) + '%'));
    return li;
  }));
}

/** Share of a holding the recorded cost covers (all of it unless coins were added without a price). */
const covered = h => (h.cost > 0 ? Math.min(1, (h.costAmt ?? h.amount) / h.amount) : 0);
const signed = n => (n >= 0 ? '+' : '−') + money(Math.abs(n));

/** Value now vs. value `change`% ago for each holding, summed. Skips coins with no figure for the period. */
function periodChange(t, key) {
  let now = 0, then = 0;
  for (const { h, c, value } of t.rows) {
    if (!value) continue;
    const ch = key === 'c24' ? c?.change24h : mk[h.ticker]?.[{ c7: 'change7d', c30: 'change30d', c1y: 'change1y' }[key]];
    if (typeof ch !== 'number' || ch <= -100) continue;
    now += value; then += value / (1 + ch / 100);
  }
  return then > 0 ? { pct: (now / then - 1) * 100, delta: now - then } : null;
}

function paintAnalytics(t) {
  const sec = $('pf-an');
  sec.hidden = list.length === 0 || !t.total;
  if (sec.hidden) return;
  const withCost = t.rows.filter(r => r.value && r.h.cost > 0);
  const invested = withCost.reduce((a, r) => a + r.h.cost, 0);
  const worth = withCost.reduce((a, r) => a + r.value * covered(r.h), 0);
  const stat = (label, value, sub, cls = '') => { const d = el('div', 'pf-stat'); d.append(el('span', 'pf-label', label), el('b', 'num ' + cls, value)); if (sub) d.append(el('span', 'num chg ' + cls, sub)); return d; };
  const stats = [stat('Value', money(t.total))];
  if (invested > 0) {
    const pl = worth - invested, plPct = (pl / invested) * 100, cls = pl > 0 ? 'up' : pl < 0 ? 'down' : 'flat';
    stats.push(stat('Cost basis', money(invested), withCost.length < t.rows.length ? `covers ${withCost.length} of ${t.rows.length} holdings` : ''));
    stats.push(stat('Unrealized P/L', signed(pl), pct(plPct).text, cls));
  } else {
    stats.push(stat('Cost basis', '–', 'Add the price you paid'));
  }
  stats.push(stat('Holdings', String(t.rows.length), `${t.rows.filter(r => r.value).length} priced`));
  $('pf-stats').replaceChildren(...stats);

  $('pf-periods').replaceChildren(...[['24H', 'c24'], ['7D', 'c7'], ['30D', 'c30'], ['1Y', 'c1y']].map(([label, key]) => {
    const r = periodChange(t, key), p = pct(r?.pct);
    const d = el('div', 'pf-period');
    d.append(el('span', 'pf-label', label), el('b', 'num chg ' + p.cls, p.text), el('span', 'num s-hint', r ? signed(r.delta) : 'No data'));
    return d;
  }));

  const ranked = t.rows.filter(r => r.value).map(r => ({ r, v: r.h.cost > 0 ? ((r.value * covered(r.h)) / r.h.cost - 1) * 100 : r.c?.change24h })).filter(x => typeof x.v === 'number').sort((a, b) => b.v - a.v);
  const basis = withCost.length ? 'since you bought' : 'today';
  $('pf-extremes').textContent = ranked.length > 1 ? `Best performer ${basis}: ${ranked[0].r.h.ticker} (${pct(ranked[0].v).text}). Weakest: ${ranked.at(-1).r.h.ticker} (${pct(ranked.at(-1).v).text}).` : '';

  const parts = t.rows.filter(r => r.value && mk[r.h.ticker]?.spark?.length > 8);
  const n = parts.length ? Math.min(...parts.map(r => mk[r.h.ticker].spark.length)) : 0;
  if (n > 8 && parts.length === t.rows.filter(r => r.value).length) {
    const s = Array.from({ length: n }, (_, i) => parts.reduce((a, r) => a + r.h.amount * mk[r.h.ticker].spark.at(-n + i), 0));
    $('pf-spark').replaceChildren(sparkLine(s, s.at(-1) >= s[0], { w: 360, h: 72 }));
  } else {
    $('pf-spark').replaceChildren(el('p', 's-hint', 'Appears once every coin you hold has history.'));
  }
}

function render() {
  const t = totals();
  paintSummary(t);
  paintAnalytics(t);
  $('pf-none').hidden = list.length > 0;
  const ul = $('pf-list');
  ul.replaceChildren(...t.rows.map(({ h, c, value }) => {
    const info = coins.find(x => x.ticker === h.ticker) || { ticker: h.ticker, name: h.ticker };
    const li = el('li', 'pf-row');
    const logo = el('span', 'wl-logo');
    logo.append(logoEl(c || { ticker: h.ticker, logo: null }));
    const name = el('a', 'wl-name');
    name.href = '/coin/' + h.ticker;
    name.append(el('b', '', info.name), el('span', 'num', c?.price ? money(c.price, { stable: c.stable }) : h.ticker));
    if (h.cost > 0) name.append(el('span', 'num s-hint pf-avg', 'Avg buy ' + money(h.cost / (h.costAmt ?? h.amount), { stable: c?.stable })));
    const amt = el('input', 'pf-amt num');
    amt.value = amountText(h.amount);
    amt.setAttribute('inputmode', 'decimal');
    amt.setAttribute('aria-label', `Amount of ${info.name}`);
    amt.addEventListener('change', () => {
      const n = parse(amt.value);
      if (n > 0) { h.amount = n; holdings.save(list); } else { amt.value = amountText(h.amount); }
    });
    const val = el('span', 'pf-val');
    const v = el('b', 'num', value ? money(value) : '–');
    const ch = pct(c?.change24h);
    val.append(v, el('span', 'chg num ' + ch.cls, ch.text));
    if (h.cost > 0 && value) { const pl = pct(((value * covered(h)) / h.cost - 1) * 100); val.append(el('span', 'chg num pf-pl ' + pl.cls, pl.text + ' all time')); }
    const del = el('button', 'icon-btn');
    del.type = 'button';
    del.setAttribute('aria-label', 'Remove ' + info.name);
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.addEventListener('click', () => { list = list.filter(x => x !== h); holdings.save(list); });
    li.append(logo, name, amt, val, del);
    return li;
  }));
}

function refreshValues() {
  const t = totals();
  paintSummary(t);
  paintAnalytics(t);
  const rows = $('pf-list').children;
  t.rows.forEach(({ c, value }, i) => {
    const li = rows[i];
    if (!li) return;
    li.querySelector('.pf-val b').textContent = value ? money(value) : '–';
    const ch = pct(c?.change24h);
    const chg = li.querySelector('.pf-val .chg');
    chg.textContent = ch.text; chg.className = 'chg num ' + ch.cls;
    if (c?.price) li.querySelector('.wl-name span').textContent = money(c.price, { stable: c.stable });
  });
}

async function boot() {
  coins = await initChrome();
  const want = (new URLSearchParams(location.search).get('coin') || '').toUpperCase();
  const picker = coinPicker($('pf-coin'), { coins, live, value: coins.some(c => c.ticker === want) ? want : (coins[0]?.ticker || ''), placeholder: 'Choose a coin' });
  render();
  document.addEventListener('cm:holdings', () => { list = holdings.load(); render(); });
  onCurrency(render);

  $('pf-form').addEventListener('submit', e => {
    e.preventDefault();
    const err = $('pf-error');
    err.hidden = true;
    const amount = parse($('pf-amount').value);
    if (!(amount > 0) || !Number.isFinite(amount)) { err.textContent = 'Enter an amount greater than zero.'; err.hidden = false; return; }
    const ticker = picker.get();
    const paid = $('pf-cost').value.trim() ? parse($('pf-cost').value) : null;
    if (paid != null && (!(paid >= 0) || !Number.isFinite(paid))) { err.textContent = 'Enter the price you paid as a number, or leave it empty.'; err.hidden = false; return; }
    const addCost = paid > 0 ? (amount * paid) / currency.rate : 0; // stored in US dollars like everything else
    const existing = list.find(h => h.ticker === ticker);
    if (existing) {
      // costAmt = how much of the holding the recorded cost covers, so coins added without a price never distort profit and loss.
      const hadCost = existing.cost > 0;
      const coveredBefore = hadCost ? existing.costAmt ?? existing.amount : 0;
      if (addCost > 0) { existing.costAmt = coveredBefore + amount; existing.cost = (existing.cost || 0) + addCost; }
      else if (hadCost) existing.costAmt = coveredBefore; // the new coins have no price, so the cost stays tied to the old amount
      existing.amount += amount;
    }
    else if (list.length >= 40) { err.textContent = 'That is plenty. Remove a holding to add another.'; err.hidden = false; return; }
    else list.push({ id: Math.random().toString(36).slice(2, 10), ticker, amount, ...(addCost > 0 ? { cost: addCost } : {}) });
    holdings.save(list);
    $('pf-amount').value = '';
    $('pf-cost').value = '';
  });

  if (!API) return;
  loadMarket().then(m => { mk = m.coins; render(); }).catch(() => {});
  let first = true;
  pollPrices(data => {
    for (const c of data.coins) live.set(c.ticker, c);
    if (first) { first = false; render(); picker.refresh(); } else refreshValues();
  });
}
boot();
