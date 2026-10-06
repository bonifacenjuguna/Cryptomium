// Shared interface pieces: the choose-from-a-list sheet (used for coins and currencies) and
// the coin picker button that replaces the plain browser dropdowns.
import { el, logoEl, money, pct } from './common.js';
import { pushLayer } from './backstack.js';

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
  let closed = false;
  let release = null;
  function hide() {
    if (closed) return;
    closed = true;
    document.body.classList.remove('sheet-open');
    trigger?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    // Slide away instead of vanishing (skipped when motion is off).
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';
    if (calm) back.remove(); else { back.classList.add('out'); setTimeout(() => back.remove(), 190); }
    if (!matchMedia('(pointer: coarse)').matches) trigger?.focus?.();
  }
  function done() { const r = release; release = null; hide(); r?.(); }
  release = pushLayer(() => { release = null; hide(); });
  const onKey = e => { if (e.key === 'Escape') done(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('pointerdown', e => { if (e.target === back) done(); });
  close.addEventListener('click', done);
  search.addEventListener('input', paint);
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') { ul.querySelector('.sheet-item:not(:disabled)')?.click(); }
  });
  // Pull the sheet down by its header to dismiss it, like a native bottom sheet.
  let y0 = 0, dy = 0, pulling = false;
  head.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; pulling = true; }, { passive: true });
  head.addEventListener('touchmove', e => {
    if (!pulling) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.animation = 'none'; sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const release2 = () => {
    if (!pulling) return;
    pulling = false;
    sheet.style.transition = ''; sheet.style.transform = ''; sheet.style.animation = '';
    if (dy > 90) done();
  };
  head.addEventListener('touchend', release2, { passive: true });
  head.addEventListener('touchcancel', release2, { passive: true });
  paint();
  if (matchMedia('(min-width: 821px)').matches) search.focus();
  return { close: done };
}


/**
 * A plain bottom sheet (drops in centred on wide screens) that shows whatever `build(body, api)` puts in it.
 * Same close behaviour as the coin sheet: Back, Escape, tapping outside, pulling the header down.
 * Returns { close, body, title(text) }.
 */
export function openPanel({ title, build, onClose = () => {}, wide = false }) {
  const back = el('div', 'sheet-back');
  const sheet = el('div', 'sheet panel-sheet' + (wide ? ' wide' : ''));
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  const head = el('div', 'sheet-head');
  const h = el('h2', '', title);
  head.append(h);
  const close = el('button', 'icon-btn');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = X_SVG;
  head.append(close);
  const body = el('div', 'panel-body');
  sheet.append(head, body);
  back.append(sheet);
  document.body.append(back);
  document.body.classList.add('sheet-open');
  let closed = false, release = null;
  const hide = () => {
    if (closed) return;
    closed = true;
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey);
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';
    if (calm) back.remove(); else { back.classList.add('out'); setTimeout(() => back.remove(), 190); }
    onClose();
  };
  const done = () => { const r = release; release = null; hide(); r?.(); };
  release = pushLayer(() => { release = null; hide(); });
  const onKey = e => { if (e.key === 'Escape') done(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('pointerdown', e => { if (e.target === back) done(); });
  close.addEventListener('click', done);
  let y0 = 0, dy = 0, pulling = false;
  head.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; pulling = true; }, { passive: true });
  head.addEventListener('touchmove', e => {
    if (!pulling) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.animation = 'none'; sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const let_go = () => {
    if (!pulling) return;
    pulling = false;
    sheet.style.transition = ''; sheet.style.transform = ''; sheet.style.animation = '';
    if (dy > 90) done();
  };
  head.addEventListener('touchend', let_go, { passive: true });
  head.addEventListener('touchcancel', let_go, { passive: true });
  const api = { close: done, body, title: t => { h.textContent = t; } };
  build(body, api);
  return api;
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
