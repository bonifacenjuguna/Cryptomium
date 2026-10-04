// Portfolio: holdings kept on this device, valued with the live prices.
import { API, initChrome, pollPrices, holdings, money, pct, el, logoEl, setNum, currency, onCurrency } from './common.js';

const $ = id => document.getElementById(id);
const live = new Map();
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

function render() {
  const t = totals();
  paintSummary(t);
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
  $('pf-coin').replaceChildren(...coins.map(c => new Option(`${c.name} (${c.ticker})`, c.ticker)));
  const want = new URLSearchParams(location.search).get('coin');
  if (want && coins.some(c => c.ticker === want.toUpperCase())) $('pf-coin').value = want.toUpperCase();
  render();
  document.addEventListener('cm:holdings', () => { list = holdings.load(); render(); });
  onCurrency(render);

  $('pf-form').addEventListener('submit', e => {
    e.preventDefault();
    const err = $('pf-error');
    err.hidden = true;
    const amount = parse($('pf-amount').value);
    if (!(amount > 0) || !Number.isFinite(amount)) { err.textContent = 'Enter an amount greater than zero.'; err.hidden = false; return; }
    const ticker = $('pf-coin').value;
    const existing = list.find(h => h.ticker === ticker);
    if (existing) existing.amount += amount;
    else if (list.length >= 40) { err.textContent = 'That is plenty. Remove a holding to add another.'; err.hidden = false; return; }
    else list.push({ id: Math.random().toString(36).slice(2, 10), ticker, amount });
    holdings.save(list);
    $('pf-amount').value = '';
  });

  if (!API) return;
  let first = true;
  pollPrices(data => {
    for (const c of data.coins) live.set(c.ticker, c);
    if (first) { first = false; render(); } else refreshValues();
  });
}
boot();
