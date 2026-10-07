// The installed app on a phone: one thin page that keeps Home, Overview, Screener, News and Portfolio alive
// side by side, and works like a native app.
//  - Each tab is a stack of screens. A tab opens as its main screen; anything you open from it (a coin, a settings
//    page...) slides in on TOP of it, and the screen underneath stays exactly as it was, scroll position and all.
//  - Back (the arrow in the top bar or the phone's Back button) slides the top screen away and you are exactly
//    where you came from. Switching tabs is instant and every tab keeps its own stack.
//  - Tabs have a trail: the tabs you visited, most recent last, each listed ONCE. Overview > News > Overview > News
//    leaves the trail Home, Overview, News, so Back goes News > Overview > Home, never round the same loop again.
//    Home is always the first stop of the trail and the last one before the app closes.
//  - The browser history is only a sentinel: one spare entry exists while there is somewhere to go back to inside the
//    app, so the phone's Back button reaches us instead of leaving. When there is nowhere left to go, the sentinel is
//    dropped and the next Back leaves the app (or closes the Android app) as usual.
import './lock.js';
const ROOTS = { home: '/', markets: '/markets', screener: '/screener', news: '/news', portfolio: '/portfolio' };
const ORDER = ['home', 'markets', 'screener', 'news', 'portfolio'];
const TITLES = { home: 'Home', markets: 'Overview', screener: 'Screener', news: 'News', portfolio: 'Portfolio' };
const root = document.documentElement;
const host = document.getElementById('shell');
const bar = document.querySelector('.app-tabbar');
const stacks = { home: [], markets: [], screener: [], news: [], portfolio: [] };
const motion = () => root.getAttribute('data-motion') !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
let active = 'home';
let trail = ['home'];   // tabs visited, each once, most recent last; the last one is the active tab
let guard = false;      // is the spare history entry in place?
let quiet = 0;          // popstate events caused by our own history.back() that must be ignored

const tabOfPath = p => {
  const first = (p.replace(/\/+$/, '') || '/').split('/')[1] || '';
  return first === '' ? 'home' : ORDER.includes(first) ? first : null;
};
const clean = go => {
  try {
    const u = new URL(go, location.origin);
    if (u.origin !== location.origin || u.pathname === '/app' || u.pathname.startsWith('/app/')) return null;
    return u.pathname + u.search + u.hash;
  } catch { return null; }
};

function makeFrame(tab, url, pushed) {
  const f = document.createElement('iframe');
  f.className = 'tab-frame' + (pushed ? ' pushed' : '');
  f.title = TITLES[tab];
  f.dataset.tab = tab;
  f.setAttribute('inert', '');
  f.src = url;
  host.appendChild(f);
  return f;
}
const topOf = tab => stacks[tab][stacks[tab].length - 1];

// What is visible: the active tab's top screen, plus the one beneath it while a screen is sliding.
function show() {
  ORDER.forEach(t => stacks[t].forEach((f, i, a) => {
    const isTop = t === active && i === a.length - 1;
    const under = t === active && i === a.length - 2;
    f.classList.toggle('on', isTop);
    f.classList.toggle('under', under);
    f.toggleAttribute('inert', !isTop);
  }));
  root.dataset.tab = active;
  bar.querySelectorAll('a').forEach(a => { if (a.dataset.tab === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const top = topOf(active);
  const ui = (top && top._ui) || {}; // a screen that comes back with its menu open brings the bar's state back too
  root.classList.toggle('shell-away', !!ui.away || !!(top && top._hold)); // _hold: opened from the menu, so the bar stays away until you are back out
  root.classList.toggle('kb-open', !!ui.kb);
  try { topOf(active).contentWindow.focus(); } catch { /* ignore */ }
}

function ensureTab(tab) { if (!stacks[tab].length) stacks[tab].push(makeFrame(tab, ROOTS[tab], false)); }

function switchTo(tab) {
  ensureTab(tab);
  if (tab === active) return;
  // Home is where every visit begins and ends: going to Home clears the trail, so Back from Home leaves the app. Any other tab
  // moves to the front of the trail instead of appearing twice.
  trail = tab === 'home' ? ['home'] : ['home', ...trail.filter(t => t !== tab && t !== 'home'), tab];
  active = tab;
  show();
  syncGuard();
}

function pushScreen(url, { animate = true } = {}) {
  const path = clean(url);
  if (!path) return;
  const stack = stacks[active];
  const topPath = (() => { try { const l = topOf(active).contentWindow.location; return l.pathname + l.search; } catch { return ''; } })();
  if (topPath && path === topPath) return; // already there
  const from = topOf(active);
  const f = makeFrame(active, path, true);
  // Opened from the open menu (or from a screen that was): the tab bar stays hidden, like in a native app's drawer flow.
  f._hold = !!(from && ((from._ui && from._ui.away) || from._hold));
  stack.push(f);
  show();
  if (animate && motion()) { f.classList.add('enter'); setTimeout(() => f.classList.remove('enter'), 320); }
  syncGuard();
}

// Slide the top screen of the active tab away (a tab's main screen is never removed).
function popScreen() {
  const stack = stacks[active];
  if (stack.length < 2) return false;
  const f = stack.pop();
  show();
  if (motion()) { f.classList.add('leave', 'on'); setTimeout(() => f.remove(), 260); } else f.remove();
  return true;
}

const canBack = () => stacks[active].length > 1 || trail.length > 1;

// One step back: first the screens opened on top of the current tab, then the tabs in the order they were visited.
function stepBack() {
  if (popScreen()) return true;
  if (trail.length > 1) {
    trail.pop();
    active = trail[trail.length - 1];
    ensureTab(active);
    show();
    return true;
  }
  return false;
}

// Keep exactly one spare history entry while there is something to go back to; none when there is not.
function syncGuard() {
  const want = canBack();
  if (want && !guard) { try { history.pushState({ cmShell: 1 }, ''); guard = true; } catch { /* ignore */ } }
  else if (!want && guard) { guard = false; quiet += 1; try { history.back(); } catch { quiet -= 1; } }
}

function reselect(tab) {
  const stack = stacks[tab];
  if (stack.length > 1) {
    const f = stack[stack.length - 1];
    while (stack.length > 1) { const x = stack.pop(); if (x !== f) x.remove(); }
    if (motion()) { f.classList.add('leave', 'on'); setTimeout(() => f.remove(), 260); } else f.remove();
    show();
    syncGuard();
    return;
  }
  try { stack[0].contentWindow.scrollTo({ top: 0, behavior: motion() ? 'smooth' : 'auto' }); } catch { /* ignore */ }
}

// ---- start
let startPath = '/';
let start = 'home';
let restore = null;
try {
  const go = clean(new URLSearchParams(location.search).get('go') || '/');
  if (go) { startPath = go; start = tabOfPath(go.split(/[?#]/)[0]) || 'home'; }
  // The app just reloaded itself to install an update: come back to the same tab and screens (see saveForReload).
  const saved = JSON.parse(sessionStorage.getItem('cm-shell-restore') || 'null');
  sessionStorage.removeItem('cm-shell-restore');
  if (saved && Date.now() - saved.t < 30000 && ORDER.includes(saved.tab)) { restore = saved; start = saved.tab; startPath = ROOTS[start]; }
} catch { /* default */ }
const startIsRoot = startPath.split(/[?#]/)[0].replace(/\/+$/, '') === (ROOTS[start] === '/' ? '' : ROOTS[start]) && !/[?]/.test(startPath);
active = start;
trail = start === 'home' ? ['home'] : ['home', start]; // opened elsewhere (a link, an update): Back still ends at Home
stacks[start].push(makeFrame(start, ROOTS[start], false));
show();
try { history.replaceState({ cmShell: 1 }, ''); } catch { /* ignore */ }
if (restore) {
  (restore.s[start] || []).forEach(u => pushScreen(u, { animate: false }));
} else if (!startIsRoot) { // opened on a coin or another screen: its tab's main screen sits underneath, and Back has a real step to use
  pushScreen(startPath, { animate: false });
}

// Load the other tabs one at a time once the app is idle.
const rest = ORDER.filter(t => t !== start);
const idle = cb => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 300));
function loadNext() {
  const tab = rest.shift();
  if (!tab) return;
  if (stacks[tab].length) { loadNext(); return; }
  ensureTab(tab);
  show();
  const f = stacks[tab][0];
  let done = false;
  const next = () => { if (done) return; done = true; idle(loadNext); };
  f.addEventListener('load', next, { once: true });
  setTimeout(next, 4000);
}
stacks[start][0].addEventListener('load', () => idle(loadNext), { once: true });
setTimeout(() => { if (rest.length && ORDER.every(t => t === start || !stacks[t].length)) idle(loadNext); }, 6000);

bar.addEventListener('click', e => {
  const a = e.target.closest('a[data-tab]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  const tab = a.dataset.tab;
  if (tab === active) reselect(tab); else switchTo(tab);
});

// The phone's Back button: our spare entry was used up, so take one step back inside the app and put the entry back if
// there is still somewhere to go. (Screens that open their own overlays handle their own Back; see backstack.js.)
addEventListener('popstate', () => {
  if (quiet > 0) { quiet -= 1; return; }
  if (!guard) return;
  guard = false;
  stepBack();
  syncGuard();
});

addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || typeof e.data !== 'object' || !e.data.cm) return;
  const fromFrame = ORDER.flatMap(t => stacks[t].map(f => [t, f])).find(([, f]) => f.contentWindow === e.source);
  if (!fromFrame) return;
  const [from, frame] = fromFrame;
  const m = e.data;
  const isTop = from === active && frame === topOf(active);
  if (m.cm === 'ui') {                                            // a menu, sheet or the keyboard is open: the bar steps aside
    frame._ui = { away: !!m.away, kb: !!m.kb };
    if (isTop) { root.classList.toggle('shell-away', !!m.away || !!frame._hold); root.classList.toggle('kb-open', !!m.kb); }
  } else if (m.cm === 'tab' && ORDER.includes(m.tab) && isTop) {   // a link to another tab
    if (m.tab === active) reselect(m.tab); else switchTo(m.tab);
  } else if (m.cm === 'push' && isTop && typeof m.url === 'string') {
    pushScreen(m.url);
  } else if (m.cm === 'back' && isTop) {
    if (stepBack()) syncGuard();
  }
});

// Notifications. The service worker talks to this shell page only (screens inside it are not reachable by the worker):
//   push  a message arrived while the app is open: hand it to the screen in front, which shows it in the app
//   open  the person tapped a notification: show that screen on top of what they were doing, so Back returns there
function openFromNotification(url) {
  const path = clean(url);
  if (!path) return;
  const plain = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const tab = Object.keys(ROOTS).find(t => ROOTS[t] === plain);
  if (tab && !/[?]/.test(path)) { if (tab === active) reselect(tab); else switchTo(tab); return; }
  pushScreen(path);
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.cm === 'push' && m.msg && typeof m.msg === 'object') {
      const f = topOf(active);
      try { if (f && document.visibilityState === 'visible') f.contentWindow.postMessage({ cm: 'sw-push', msg: m.msg }, location.origin); } catch { /* screen still loading */ }
    } else if (m.cm === 'open' && typeof m.url === 'string') {
      openFromNotification(m.url);
    }
  });
}

// A new version of the app: this shell is the one page that is never reloaded by the pages inside it. It remembers the tab
// and the screens that were open, so an update brings the person back to exactly where they were.
function saveForReload() {
  try {
    const path = f => { try { const l = f.contentWindow.location; return l.pathname + l.search; } catch { return ''; } };
    const s = {};
    ORDER.forEach(t => { s[t] = stacks[t].slice(1).map(path).filter(Boolean); });
    sessionStorage.setItem('cm-shell-restore', JSON.stringify({ t: Date.now(), tab: active, s }));
  } catch { /* private mode: the app simply opens on its start screen */ }
}
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had || reloading) return;
    reloading = true;
    saveForReload();
    setTimeout(() => location.reload(), 400);
  });
}

// The shell page paints the tab bar, so it must follow the theme the person picks inside any screen (the gold
// bar above the active tab used to stay gold). Screens save preferences; the shell hears it and restyles itself.
const mq = matchMedia('(prefers-color-scheme: dark)');
function syncTheme() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('cm-prefs') || '{}') || {}; } catch { /* defaults */ }
  const resolved = p.theme === 'light' || p.theme === 'dark' ? p.theme : mq.matches ? 'dark' : 'light';
  const set = (k, v) => (v == null ? root.removeAttribute(k) : root.setAttribute(k, v));
  set('data-theme', resolved);
  set('data-accent', p.accent || 'citrine');
  set('data-motion', p.motion === false ? 'off' : null);
  set('data-size', p.textSize === 'large' || p.textSize === 'larger' ? p.textSize : null);
  set('data-palette', p.palette === 'clear' ? 'clear' : null);
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', resolved === 'dark' ? '#090f15' : '#f1f3f6');
}
addEventListener('storage', e => { if (e.key === 'cm-prefs' || e.key === null) syncTheme(); });
mq.addEventListener && mq.addEventListener('change', syncTheme);
