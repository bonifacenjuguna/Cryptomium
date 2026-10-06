// The installed app on a phone: one thin page that keeps Home, Overview, Screener, News and Portfolio alive
// side by side (one frame each). Switching tabs only shows the one you tap, so there is no loading, and every
// tab keeps its scroll position, open sheets and typed text. The pages inside are the ordinary pages.
const ROOTS = { home: '/', markets: '/markets', screener: '/screener', news: '/news', portfolio: '/portfolio' };
const ORDER = ['home', 'markets', 'screener', 'news', 'portfolio'];
const TITLES = { home: 'Home', markets: 'Overview', screener: 'Screener', news: 'News', portfolio: 'Portfolio' };
const root = document.documentElement;
const host = document.getElementById('shell');
const bar = document.querySelector('.app-tabbar');
const frames = {};
let active = 'home';

const tabOfPath = p => {
  const first = (p.replace(/\/+$/, '') || '/').split('/')[1] || '';
  return first === '' ? 'home' : ORDER.includes(first) ? first : null;
};

// What to open first: the address handed over by theme-init.js (?go=), else Home.
let startUrl = ROOTS.home;
let start = 'home';
try {
  const go = new URLSearchParams(location.search).get('go');
  if (go && go.startsWith('/') && !go.startsWith('//') && !go.startsWith('/app')) {
    const path = go.split(/[?#]/)[0];
    start = tabOfPath(path) || 'home';          // a coin address opens inside the Home tab
    startUrl = go;
    if (ROOTS[start] === path.replace(/\/+$/, '') || (start === 'home' && path === '/')) startUrl = go;
  }
} catch { /* default */ }
active = start;

function frameFor(tab, url) {
  const f = document.createElement('iframe');
  f.className = 'tab-frame';
  f.title = TITLES[tab];
  f.dataset.tab = tab;
  f.setAttribute('inert', '');
  f.src = url || ROOTS[tab];
  host.appendChild(f);
  frames[tab] = f;
  return f;
}

const framePath = f => { try { return f.contentWindow.location.pathname.replace(/\/+$/, '') || '/'; } catch { return ROOTS[f.dataset.tab]; } };
const atRoot = tab => framePath(frames[tab]) === ROOTS[tab];

function show(tab) {
  active = tab;
  ORDER.forEach(t => {
    const f = frames[t];
    if (!f) return;
    const on = t === tab;
    f.classList.toggle('on', on);
    f.toggleAttribute('inert', !on);
  });
  root.dataset.tab = tab;
  bar.querySelectorAll('a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  root.classList.remove('shell-away', 'kb-open');
  try { frames[tab].contentWindow.focus(); } catch { /* ignore */ }
}

// Switching is a history step, so Back undoes the most recent thing you did (a tab switch or a screen inside a tab).
function switchTo(tab, { push = true } = {}) {
  if (!frames[tab]) frameFor(tab);
  if (tab === active) return;
  show(tab);
  if (push) { try { history.pushState({ cmShell: tab }, ''); } catch { /* ignore */ } }
}

function reselect(tab) {
  const f = frames[tab];
  if (!f) return;
  if (!atRoot(tab)) { try { f.contentWindow.location.replace(ROOTS[tab]); } catch { f.src = ROOTS[tab]; } return; }
  try { f.contentWindow.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch { /* ignore */ }
}

// Build: the opened tab first, then the others one at a time once the app is idle.
frameFor(start, startUrl);
show(start);
try { history.replaceState({ cmShell: start }, ''); } catch { /* ignore */ }
const rest = ORDER.filter(t => t !== start);
const idle = cb => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 300));
function loadNext() {
  const tab = rest.shift();
  if (!tab) return;
  if (frames[tab]) { loadNext(); return; }
  const f = frameFor(tab);
  show(active); // keeps the right frame visible
  let done = false;
  const next = () => { if (done) return; done = true; idle(loadNext); };
  f.addEventListener('load', next, { once: true });
  setTimeout(next, 4000); // a slow page never holds the others back
}
frames[start].addEventListener('load', () => idle(loadNext), { once: true });
setTimeout(() => { if (rest.length && !Object.keys(frames).some(t => t !== start)) idle(loadNext); }, 6000);

bar.addEventListener('click', e => {
  const a = e.target.closest('a[data-tab]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  const tab = a.dataset.tab;
  if (tab === active) reselect(tab); else switchTo(tab);
});

addEventListener('popstate', e => {
  const tab = e.state && e.state.cmShell;
  if (tab && ORDER.includes(tab)) { if (!frames[tab]) frameFor(tab); if (tab !== active) show(tab); }
});

// Messages from the pages inside the tabs.
addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || typeof e.data !== 'object' || !e.data.cm) return;
  const from = Object.keys(frames).find(t => frames[t].contentWindow === e.source);
  if (!from) return;
  const m = e.data;
  if (m.cm === 'ui' && from === active) {                       // a menu, sheet or the keyboard is open: the bar steps aside
    root.classList.toggle('shell-away', !!m.away);
    root.classList.toggle('kb-open', !!m.kb);
  } else if (m.cm === 'tab' && ORDER.includes(m.tab)) {          // a link inside a page that points at another tab
    if (m.tab === active) reselect(m.tab); else switchTo(m.tab);
  }
});

// A new version of the app: this shell is the one page that is never reloaded by the pages inside it.
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) setTimeout(() => location.reload(), 400); });
}
