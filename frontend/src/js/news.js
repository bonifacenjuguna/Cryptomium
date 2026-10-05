// News: headlines from the backend's feed reader. Titles, a short excerpt and a link to the original.
import { initChrome, getJSON, el, ago, API } from './common.js';

const $ = id => document.getElementById(id);
const CATS = [['', 'All'], ['bitcoin', 'Bitcoin'], ['ethereum', 'Ethereum'], ['altcoins', 'Altcoins'], ['defi', 'DeFi'], ['regulation', 'Regulation'], ['etf', 'ETFs'], ['exchanges', 'Exchanges'], ['security', 'Security'], ['network', 'Network'], ['macro', 'Macro']];
const state = { items: [], cat: '', pub: '', q: '', coin: '' };
const catLabel = Object.fromEntries(CATS);

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.cat = CATS.some(([k]) => k === p.get('topic')) ? p.get('topic') : '';
  state.coin = (p.get('coin') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  state.q = p.get('q') || '';
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.cat) p.set('topic', state.cat);
  if (state.coin) p.set('coin', state.coin);
  if (state.q) p.set('q', state.q);
  history.replaceState(null, '', location.pathname + ([...p].length ? '?' + p : ''));
}

function paint() {
  const q = state.q.toLowerCase();
  const shown = state.items.filter(i =>
    (!state.cat || i.categories.includes(state.cat)) &&
    (!state.pub || i.publisherId === state.pub) &&
    (!state.coin || i.coins.includes(state.coin)) &&
    (!q || `${i.title} ${i.summary}`.toLowerCase().includes(q)));
  $('nw-none').hidden = shown.length > 0;
  $('nw-list').replaceChildren(...shown.slice(0, 80).map(i => {
    const li = el('li', 'nw-item');
    const a = el('a', 'nw-title', i.title);
    a.href = i.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const meta = el('div', 'nw-meta');
    meta.append(el('b', '', i.publisher), el('time', '', ago(i.at)));
    meta.lastChild.dateTime = i.at;
    li.append(meta, a);
    if (i.summary) li.append(el('p', 'nw-sum', i.summary));
    const tags = el('div', 'nw-tags');
    for (const t of i.coins) { const c = el('a', 'tag coin', t); c.href = '/coin/' + t; tags.append(c); }
    for (const c of i.categories.slice(0, 3)) tags.append(el('span', 'tag', catLabel[c] || c));
    if (tags.children.length) li.append(tags);
    return li;
  }));
}

function paintCats() {
  const box = $('nw-cats');
  box.replaceChildren(...CATS.map(([k, label]) => {
    const b = el('button', 'seg', label); b.type = 'button';
    b.setAttribute('aria-pressed', String(state.cat === k));
    b.addEventListener('click', () => { state.cat = k; paintCats(); paint(); writeUrl(); });
    return b;
  }));
}

async function boot() {
  await initChrome();
  readUrl();
  paintCats();
  $('nw-q').value = state.q;
  $('nw-q').addEventListener('input', e => { state.q = e.target.value.trim(); paint(); writeUrl(); });
  $('nw-pub').addEventListener('change', e => { state.pub = e.target.value; paint(); });
  if (!API) return;
  $('nw-status').textContent = 'Loading headlines…';
  try {
    const data = await getJSON('/api/news', { timeoutMs: 20000 });
    state.items = data.items;
    for (const p of data.publishers) { const o = el('option', '', p.name); o.value = p.id; $('nw-pub').append(o); }
    $('nw-status').textContent = `${data.items.length} headlines from ${data.publishers.map(p => p.name).join(', ')}, updated ${ago(data.updatedAt)}.` + (data.unavailable.length ? ` ${data.unavailable.join(', ')} could not be reached right now.` : '') + (data.stale ? ' Showing the last good copy.' : '');
    paint();
  } catch {
    $('nw-status').textContent = 'The news feeds are not reachable right now. Try again in a few minutes.';
  }
}
boot();
