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
  root.classList.remove('shell-away', 'kb-open');
  try { topOf(active).contentWindow.focus(); } catch { /* ignore */ }
}

function ensureTab(tab) { if (!stacks[tab].length) stacks[tab].push(makeFrame(tab, ROOTS[tab], false)); }

function switchTo(tab, { push = true } = {}) {
  ensureTab(tab);
  if (tab === active) return;
  active = tab;
  show();
  if (push) { try { history.pushState({ cmShell: snap() }, ''); } catch { /* ignore */ } }
}

function pushScreen(url, { animate = true, record = true } = {}) {
  const path = clean(url);
  if (!path) return;
  const stack = stacks[active];
  const topPath = (() => { try { const l = topOf(active).contentWindow.location; return l.pathname + l.search; } catch { return ''; } })();
  if (topPath && path === topPath) return; // already there
  const f = makeFrame(active, path, true);
  stack.push(f);
  show();
  if (animate && motion()) { f.classList.add('enter'); setTimeout(() => f.classList.remove('enter'), 320); }
  if (record) { try { history.pushState({ cmShell: snap() }, ''); } catch { /* ignore */ } }
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
    try { history.replaceState({ cmShell: snap() }, ''); } catch { /* ignore */ }
    return;
  }
  try { stack[0].contentWindow.scrollTo({ top: 0, behavior: motion() ? 'smooth' : 'auto' }); } catch { /* ignore */ }
}

// ---- start
let startPath = '/';
let start = 'home';
try {
  const go = clean(new URLSearchParams(location.search).get('go') || '/');
  if (go) { startPath = go; start = tabOfPath(go.split(/[?#]/)[0]) || 'home'; }
} catch { /* default */ }
const startIsRoot = startPath.split(/[?#]/)[0].replace(/\/+$/, '') === (ROOTS[start] === '/' ? '' : ROOTS[start]) && !/[?]/.test(startPath);
active = start;
stacks[start].push(makeFrame(start, startIsRoot ? ROOTS[start] : ROOTS[start], false));
if (!startIsRoot) { // opened on a coin or another screen: its tab's main screen sits underneath so Back has somewhere to go
  show();
  pushScreen(startPath, { animate: false, record: false });
}
show();
try { history.replaceState({ cmShell: snap() }, ''); } catch { /* ignore */ }

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

addEventListener('popstate', e => { if (e.state && e.state.cmShell) applyState(e.state.cmShell); });

addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || typeof e.data !== 'object' || !e.data.cm) return;
  const fromFrame = ORDER.flatMap(t => stacks[t].map(f => [t, f])).find(([, f]) => f.contentWindow === e.source);
  if (!fromFrame) return;
  const [from, frame] = fromFrame;
  const m = e.data;
  const isTop = from === active && frame === topOf(active);
  if (m.cm === 'ui' && isTop) {                                   // a menu, sheet or the keyboard is open: the bar steps aside
    root.classList.toggle('shell-away', !!m.away);
    root.classList.toggle('kb-open', !!m.kb);
  } else if (m.cm === 'tab' && ORDER.includes(m.tab) && isTop) {   // a link to another tab
    if (m.tab === active) reselect(m.tab); else switchTo(m.tab);
  } else if (m.cm === 'push' && isTop && typeof m.url === 'string') {
    pushScreen(m.url);
  } else if (m.cm === 'back' && isTop) {
    if (stacks[active].length > 1) history.back();
  }
});

// A new version of the app: this shell is the one page that is never reloaded by the pages inside it.
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) setTimeout(() => location.reload(), 400); });
}
