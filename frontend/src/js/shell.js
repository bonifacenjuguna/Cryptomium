// The installed app on a phone: one thin page that keeps Home, Overview, Screener, News and Portfolio alive
// side by side, and works like a native app.
//  - Each tab is a stack of screens. A tab opens as its main screen; anything you open from it (a coin, a settings
//    page...) slides in on TOP of it, and the screen underneath stays exactly as it was, scroll position and all.
//  - Back (the arrow in the top bar or the phone's Back button) slides the top screen away and you are exactly
//    where you came from. Switching tabs is instant and every tab keeps its own stack.
const ROOTS = { home: '/', markets: '/markets', screener: '/screener', news: '/news', portfolio: '/portfolio' };
const ORDER = ['home', 'markets', 'screener', 'news', 'portfolio'];
const TITLES = { home: 'Home', markets: 'Overview', screener: 'Screener', news: 'News', portfolio: 'Portfolio' };
const root = document.documentElement;
const host = document.getElementById('shell');
const bar = document.querySelector('.app-tabbar');
const stacks = { home: [], markets: [], screener: [], news: [], portfolio: [] };
const motion = () => root.getAttribute('data-motion') !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
let active = 'home';

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
// Where you have been, each place once, most recent last. Back walks it in reverse, so going Overview, News, Overview,
// News and then Back gives Overview, then wherever you were before, never the same place twice.
const trail = [];
const visit = tab => { const i = trail.indexOf(tab); if (i >= 0) trail.splice(i, 1); trail.push(tab); try { localStorage.setItem('cm-last-tab', tab); } catch { /* ignore */ } };
const snap = () => ({ tab: active, d: Object.fromEntries(ORDER.map(t => [t, stacks[t].length || 1])) });

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

function switchTo(tab, { push = true } = {}) {
  ensureTab(tab);
  if (tab === active) return;
  active = tab;
  show();
  visit(tab);
}

function pushScreen(url, { animate = true, record = true } = {}) {
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
}

function removeFrame(tab, f, animate) {
  const i = stacks[tab].indexOf(f);
  if (i > 0) stacks[tab].splice(i, 1); // the main screen of a tab is never removed
  if (animate && motion() && tab === active) { f.classList.add('leave'); setTimeout(() => f.remove(), 260); } else f.remove();
}

// Apply a remembered state (Back / Forward): show that tab and shrink each stack to its remembered depth.
function applyState(st) {
  if (!st || !ORDER.includes(st.tab)) return;
  ensureTab(st.tab);
  const wasActive = active;
  ORDER.forEach(t => {
    const want = Math.max(1, (st.d && st.d[t]) || 1);
    while (stacks[t].length > want) {
      const f = stacks[t][stacks[t].length - 1];
      stacks[t].pop();
      if (t === st.tab && t === wasActive) { f.classList.add('leave'); f.classList.add('on'); setTimeout(() => f.remove(), motion() ? 260 : 0); if (!motion()) f.remove(); }
      else f.remove();
    }
  });
  active = st.tab;
  show();
  // The sliding-out screen is no longer in a stack, so show() has not touched it: keep it visible while it leaves.
}

function reselect(tab) {
  const stack = stacks[tab];
  if (stack.length > 1) {
    const f = stack[stack.length - 1];
    while (stack.length > 1) { const x = stack.pop(); if (x !== f) x.remove(); }
    if (motion()) { f.classList.add('leave', 'on'); setTimeout(() => f.remove(), 260); } else f.remove();
    show();
    return;
  }
  try { stack[0].contentWindow.scrollTo({ top: 0, behavior: motion() ? 'smooth' : 'auto' }); } catch { /* ignore */ }
}

// ---- start
// After an app update restarts the shell, come back to the screen the person was on (not always Home).
const RESUME = 'cm-resume';
function stashResume() {
  try { const f = topOf(active); const l = f && f.contentWindow.location; if (l && l.pathname) sessionStorage.setItem(RESUME, l.pathname + l.search + l.hash); } catch { /* start from the launch address */ }
}
function takeResume() { try { const v = sessionStorage.getItem(RESUME); sessionStorage.removeItem(RESUME); return v; } catch { return null; } }
let startPath = '/';
let start = 'home';
try {
  const resumed = takeResume();
  const asked = new URLSearchParams(location.search).get('go');
  const go = clean(resumed || asked || '/');
  if (go) { startPath = go; start = tabOfPath(go.split(/[?#]/)[0]) || 'home'; }
  // Plain launch (no deep link, not a restart after an update): open on the tab chosen in Settings, Preferences.
  if (!resumed && !asked) {
    let p = {}; try { p = JSON.parse(localStorage.getItem('cm-prefs') || '{}') || {}; } catch { /* defaults */ }
    const want = p.startTab === 'last' ? localStorage.getItem('cm-last-tab') : p.startTab;
    if (want && ORDER.includes(want)) { start = want; startPath = ROOTS[want]; }
  }
} catch { /* default */ }
const startIsRoot = startPath.split(/[?#]/)[0].replace(/\/+$/, '') === (ROOTS[start] === '/' ? '' : ROOTS[start]) && !/[?]/.test(startPath);
active = start;
stacks[start].push(makeFrame(start, startIsRoot ? ROOTS[start] : ROOTS[start], false));
show();
if (start !== 'home') trail.push('home');   // Home is always the bottom of the trail, even when the app was opened straight onto another screen
visit(start);
if (!startIsRoot) { // opened on a coin or another screen: its tab's main screen sits underneath, and Back has a real history step to use
  pushScreen(startPath, { animate: false, record: true });
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

// Android Back. The browser keeps two entries for us (base, then a guard on top). Back lands on base, we step back one place
// inside the app and put the guard back; with nowhere left to go we let the real Back through, which leaves the app.
function goBackInApp() {
  const stack = stacks[active];
  if (stack.length > 1) {
    const f = stack.pop();
    f.classList.add('leave', 'on');
    if (motion()) setTimeout(() => f.remove(), 260); else f.remove();
    show();
    return true;
  }
  if (trail.length > 1) {
    trail.pop();
    active = trail[trail.length - 1];
    ensureTab(active);
    show();
    return true;
  }
  if (active !== 'home') {            // never leave the app from another tab: Home comes first
    active = 'home';
    trail.length = 0; trail.push('home');
    ensureTab('home');
    show();
    return true;
  }
  return false;
}
try { history.replaceState({ cmBase: 1 }, ''); history.pushState({ cmGuard: 1 }, ''); } catch { /* no history API */ }
addEventListener('popstate', e => {
  if (!e.state || !e.state.cmBase) return;
  if (goBackInApp()) { try { history.pushState({ cmGuard: 1 }, ''); } catch { /* ignore */ } } else { try { history.back(); } catch { /* ignore */ } }
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
    goBackInApp();
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

// A new version of the app: this shell is the one page that is never reloaded by the pages inside it.
if ('serviceWorker' in navigator) {
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had) { had = true; return; } // the first take-over of this session; later switches must reload
    stashResume();
    setTimeout(() => location.reload(), 400);
  });
  // Same build as the worker serving it? If not (the app was frozen in the background during a switch), reload once.
  const sameBuild = async () => {
    const ctl = navigator.serviceWorker.controller; const mine = (window.CRYPTOMIUM || {}).build;
    if (!ctl || !mine) return;
    const v = await new Promise(resolve => { try { const ch = new MessageChannel(); const t = setTimeout(() => resolve(null), 1500); ch.port1.onmessage = e => { clearTimeout(t); resolve(e.data); }; ctl.postMessage({ type: 'GET_VERSION' }, [ch.port2]); } catch { resolve(null); } });
    if (!v || !v.build) return;
    let n = 0; try { n = Number(sessionStorage.getItem('cm-reconcile-shell') || 0); } catch { /* ignore */ }
    if (v.build === mine) { try { sessionStorage.removeItem('cm-reconcile-shell'); } catch { /* ignore */ } return; }
    if (n >= 2) return;
    try { sessionStorage.setItem('cm-reconcile-shell', String(n + 1)); } catch { /* ignore */ }
    stashResume();
    location.reload();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sameBuild(); });
  setTimeout(sameBuild, 2000);
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

import('./lock.js').then(m => m.init({ top: true })).catch(() => {});
