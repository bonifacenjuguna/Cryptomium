// Shared interface pieces: the choose-from-a-list sheet (used for coins and currencies) and
// the coin picker button that replaces the plain browser dropdowns.
import { el, logoEl, money, pct } from './common.js';

const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const CHEV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/**
 * A sheet that slides up on phones and drops in on larger screens.
 * items: [{ value, title, sub, lead (Node), disabled, group }]. Returns { close }.
 */
export function openSheet({ title, items, value = null, searchLabel = 'Search', trigger = null, onPick, empty = 'Nothing matches that.', match = null }) {
  const back = el('div', 'sheet-back');
  const sheet = el('div', 'sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);
  const head = el('div', 'sheet-head');
  head.append(el('h2', '', title));
  const close = el('button', 'icon-btn');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = X_SVG;
  head.append(close);
  const search = el('input', 'sheet-search');
  search.type = 'search';
  search.placeholder = searchLabel;
  search.setAttribute('aria-label', searchLabel);
  search.autocomplete = 'off';
  search.spellcheck = false;
  const ul = el('ul', 'sheet-list');
  ul.setAttribute('role', 'listbox');
  sheet.append(head, search, ul);
  back.append(sheet);
  document.body.append(back);
  document.body.classList.add('sheet-open');
  trigger?.setAttribute('aria-expanded', 'true');

  const test = match || ((it, q) => `${it.title} ${it.sub || ''} ${it.value}`.toLowerCase().includes(q));
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const shown = q ? items.filter(it => test(it, q)) : items;
    const rows = [];
    let lastGroup = null;
    for (const it of shown) {
      if (!q && it.group && it.group !== lastGroup) { rows.push(Object.assign(el('li', 'sheet-group', it.group), { role: 'presentation' })); }
      lastGroup = it.group || lastGroup;
      const li = el('li');
      const b = el('button', 'sheet-item');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(it.value === value));
      b.disabled = Boolean(it.disabled);
      if (it.lead) b.append(it.lead());
      const t = el('span', 'si-t');
      t.append(el('b', '', it.title));
      if (it.sub) t.append(el('span', '', it.sub));
      b.append(t);
      if (it.trail) b.append(el('span', 'si-trail num ' + (it.trailClass || ''), it.trail));
      b.append(el('span', 'si-check'));
      b.addEventListener('click', () => { done(); onPick(it.value); });
      li.append(b);
      rows.push(li);
    }
    ul.replaceChildren(...rows);
    if (!shown.length) ul.append(el('li', 'sheet-none', empty));
  };
  function done() {
    back.remove();
    document.body.classList.remove('sheet-open');
    trigger?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    trigger?.focus?.();
  }
  const onKey = e => { if (e.key === 'Escape') done(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('pointerdown', e => { if (e.target === back) done(); });
  close.addEventListener('click', done);
  search.addEventListener('input', paint);
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') { ul.querySelector('.sheet-item:not(:disabled)')?.click(); }
  });
  paint();
  if (matchMedia('(min-width: 821px)').matches) search.focus();
  return { close: done };
}

/**
 * A coin chooser: a button showing the chosen coin that opens a searchable sheet with logos and
 * live prices. Replaces a plain <select>. Returns { set(ticker), get(), refresh() }.
 */
const logoOf = (live, t) => live.get(t) || { ticker: t, logo: `/api/logos/${t}.png` };

export function coinPicker(button, { coins, live = new Map(), value = '', placeholder = 'Choose a coin', none = null, exclude = '', onChange = () => {} }) {
  let current = value;
  const find = t => coins.find(c => c.ticker === t);
  const paint = () => {
    const c = find(current);
    button.classList.toggle('has-value', Boolean(c));
    button.replaceChildren();
    if (c) {
      button.append(logoEl(logoOf(live, c.ticker), 'sm'));
      const t = el('span', 'cpk-text');
      t.append(el('b', '', c.ticker), el('span', '', c.name));
      button.append(t);
    } else {
      button.append(el('span', 'cpk-ph', current === '' && none ? none : placeholder));
    }
    const chev = el('span', 'cpk-chev');
    chev.innerHTML = CHEV_SVG;
    button.append(chev);
  };
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => {
    const items = [];
    if (none) items.push({ value: '', title: none, sub: '', lead: () => { const d = el('span', 'logo sm mono', '—'); return d; } });
    for (const c of coins) {
      if (c.ticker === exclude) continue;
      const l = live.get(c.ticker);
      const ch = l ? pct(l.change24h) : null;
      items.push({
        value: c.ticker, title: c.ticker, sub: c.name,
        lead: () => logoEl(logoOf(live, c.ticker), 'sm'),
        trail: l?.price ? money(l.price, { stable: l.stable }) : '', trailClass: '',
        ch,
      });
    }
    openSheet({
      title: placeholder, items, value: current, trigger: button, searchLabel: 'Search coins',
      empty: 'No coin matches that.',
      onPick: v => { current = v; paint(); onChange(v); },
    });
  });
  paint();
  return {
    set(v) { current = v; paint(); },
    get: () => current,
    refresh: () => paint(),
    live,
  };
}
