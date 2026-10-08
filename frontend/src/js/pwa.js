// App side of the site: service worker, install card, "installed" detection and the phone tab bar.
const FLAG = 'cm-pwa-installed';
const standaloneQuery = window.matchMedia('(display-mode: standalone)');
const isStandalone = () => standaloneQuery.matches || window.navigator.standalone === true;
export const isApp = isStandalone;
export const inShell = () => document.documentElement.classList.contains('in-shell');
const TAB_ROOTS = { '/': 'home', '/markets': 'markets', '/screener': 'screener', '/news': 'news', '/portfolio': 'portfolio' };
/** Go to an address like a native app: inside the app shell a main screen switches tab and anything else opens on top of the current screen. */
export function navTo(href) {
  const u = new URL(href, location.href);
  if (u.origin !== location.origin) { location.href = u.href; return; }
  if (!inShell()) { location.href = u.href; return; }
  const path = u.pathname.replace(/\/+$/, '') || '/';
  try {
    if (TAB_ROOTS[path] && !u.search) parent.postMessage({ cm: 'tab', tab: TAB_ROOTS[path] }, location.origin);
    else parent.postMessage({ cm: 'push', url: path + u.search + u.hash }, location.origin);
  } catch { location.href = u.href; }
}
/** The back arrow: one screen back, to wherever this one was opened from. */
export function goBack() {
  if (inShell()) { try { parent.postMessage({ cm: 'back' }, location.origin); return true; } catch { /* fall through */ } }
  return false;
}
const ua = navigator.userAgent || '';
const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const iosSafari = isIOS && !/crios|fxios|edgios|opios/i.test(ua);

const flag = {
  get() { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } },
  set(v) { try { v ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch { /* private mode */ } },
};

let deferred = null;      // the browser's own install prompt, when it offers one
let graceOver = false;    // we wait a moment for that prompt before showing manual steps
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

// 1. Service worker and app updates
// A new version downloads quietly and waits. It is switched on only when the visitor taps Update now, or
// (automatic mode) at a moment nobody is using the screen: the app was just opened or has been put away.
import { onRecover } from './net.js';
const CFG = window.CRYPTOMIUM || {};
const MODE_KEY = 'cm-update-mode';
const CHECKED_KEY = 'cm-update-checked';
const sw = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost');
const pageOpened = Date.now();
let interacted = false;
['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { interacted = true; }, { once: true, passive: true, capture: true }));

const U = { status: 'idle', error: '', latest: null, checkedAt: Number(flagGet(CHECKED_KEY)) || 0 };
let reg = null, waitingWorker = null, applying = false;
let hadController = sw && Boolean(navigator.serviceWorker.controller); // becomes true after the first take-over, so a later update still reloads this page
const updateListeners = new Set();
function flagGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function flagSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
const snap = () => ({ ...U, version: CFG.version || '', build: CFG.build || '', mode: updates.mode(), supported: sw, online: navigator.onLine !== false });
function setU(patch) { Object.assign(U, patch); updateListeners.forEach(fn => fn(snap())); }

// Automatic mode installs a downloaded update by itself: when the app is opened, when it is put away, and (new) when
// nobody has touched it for a while. Activity from ANY screen counts (the installed app keeps several screens alive), so
// it is shared through storage rather than kept per screen.
const ACTIVE_KEY = 'cm-active';
const IDLE_MS = 45 * 1000;
let lastWrite = 0;
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => window.addEventListener(ev, () => {
  const now = Date.now();
  if (now - lastWrite > 4000) { lastWrite = now; flagSet(ACTIVE_KEY, String(now)); }
}, { passive: true, capture: true }));
const idleFor = () => Date.now() - Math.max(Number(flagGet(ACTIVE_KEY)) || 0, pageOpened);

const dirtyForm = () => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=search]):not([type=file]), textarea')].some(i => i.value && i.value !== i.defaultValue);

function askVersion(worker) {
  return new Promise(resolve => {
    try {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 1500);
      ch.port1.onmessage = e => { clearTimeout(t); resolve(e.data); };
      worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    } catch { resolve(null); }
  });
}

async function markReady(worker) {
  waitingWorker = worker;
  setU({ status: 'ready', error: '', latest: null });
  askVersion(worker).then(v => { if (v) setU({ latest: v }); });
  autoApply('ready');
}

const watched = new WeakSet();
function watch(worker) {
  if (!worker || !navigator.serviceWorker.controller || watched.has(worker)) return; // the very first install has nothing to replace
  watched.add(worker);
  if (U.status !== 'checking') setU({ status: 'downloading', error: '' });
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') markReady(worker);
    else if (worker.state === 'redundant' && U.status === 'downloading') setU({ status: 'failed', error: 'install' });
  });
}

function autoApply(reason) {
  if (updates.mode() !== 'auto' || U.status !== 'ready' || applying || dirtyForm()) return;
  const justOpened = !interacted && Date.now() - pageOpened < 8000;
  if (reason === 'hidden' || (reason === 'ready' && (document.hidden || justOpened))) updates.apply();
}

/**
 * Self-heal: this page and the worker serving it must be the same build. They differ when the worker switched while the
 * page could not reload (an Android app frozen in the background, a reload that never finished). Reload once so the page
 * matches again; a counter stops any chance of a reload loop.
 */
async function reconcile() {
  const ctl = sw && navigator.serviceWorker.controller;
  if (!ctl || applying || !CFG.build || U.status === 'applying') return;
  const v = await askVersion(ctl);
  if (!v || !v.build) return;
  if (v.build === CFG.build) { try { sessionStorage.removeItem('cm-reconcile'); } catch { /* ignore */ } return; }
  let n = 0;
  try { n = Number(sessionStorage.getItem('cm-reconcile') || 0); } catch { /* ignore */ }
  if (n >= 2 || dirtyForm()) return;
  try { sessionStorage.setItem('cm-reconcile', String(n + 1)); } catch { /* ignore */ }
  location.reload();
}

if (sw) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; } // first install taking control: nothing to reload (but later changes must)
    if (applying) { try { sessionStorage.setItem('cm-updated', (U.latest && U.latest.version) || CFG.version || '1'); } catch { /* ignore */ } location.reload(); return; }
    // Another window (or the old worker) switched versions under this page: reload when nobody is looking.
    const go = () => { if (document.hidden) location.reload(); };
    if (document.hidden) location.reload(); else document.addEventListener('visibilitychange', go, { once: true });
  });
  window.addEventListener('load', async () => {
    try {
      reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    } catch { return; }
    setTimeout(reconcile, 1500);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    if (reg.waiting && navigator.serviceWorker.controller) markReady(reg.waiting);
    else if (reg.installing) watch(reg.installing);
    if (updates.mode() === 'auto') setTimeout(() => updates.check({ silent: true }), 3000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { autoApply('hidden'); return; }
    reconcile();
    if (updates.mode() === 'auto' && Date.now() - U.checkedAt > 15 * 60 * 1000) updates.check({ silent: true });
  });
  setInterval(() => { if (!document.hidden && updates.mode() === 'auto') updates.check({ silent: true }); }, 30 * 60 * 1000);
  // Downloaded and waiting, and the person has been idle: install it now (automatic mode only).
  setInterval(() => {
    if (updates.mode() === 'auto' && U.status === 'ready' && !applying && !document.hidden && !dirtyForm() && idleFor() > IDLE_MS) updates.apply();
  }, 10 * 1000);
  onRecover(() => { if (updates.mode() === 'auto') updates.check({ silent: true }); });
}

export const updates = {
  get: snap,
  on(fn) { updateListeners.add(fn); return () => updateListeners.delete(fn); },
  mode() { return flagGet(MODE_KEY) === 'manual' ? 'manual' : 'auto'; },
  setMode(m) { flagSet(MODE_KEY, m === 'manual' ? 'manual' : 'auto'); updateListeners.forEach(fn => fn(snap())); },
  /** Look for a new version. silent: background check, shows nothing unless an update is found. */
  async check({ silent = false } = {}) {
    if (!sw) { if (!silent) setU({ status: 'failed', error: 'unsupported' }); return; }
    if (['checking', 'downloading', 'applying', 'ready'].includes(U.status)) return;
    if (!reg) { try { reg = await navigator.serviceWorker.getRegistration(); } catch { /* none */ } }
    if (!reg) { if (!silent) setU({ status: 'failed', error: 'unsupported' }); return; }
    if (navigator.onLine === false) { if (!silent) setU({ status: 'failed', error: 'offline' }); return; }
    if (!silent) setU({ status: 'checking', error: '' });
    try {
      await Promise.race([reg.update(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
    } catch (err) {
      if (!silent) setU({ status: 'failed', error: err && err.message === 'timeout' ? 'timeout' : 'network' });
      return;
    }
    U.checkedAt = Date.now();
    flagSet(CHECKED_KEY, String(U.checkedAt));
    if (reg.waiting && navigator.serviceWorker.controller) { markReady(reg.waiting); return; }
    if (reg.installing) {
      watch(reg.installing);
      if (U.status !== 'downloading') setU({ status: 'downloading', error: '' });
      // Never an endless spinner: if the download does not finish, say so.
      setTimeout(() => { if (U.status === 'downloading') setU({ status: 'failed', error: 'timeout' }); }, 90000);
      return;
    }
    setU({ status: silent && U.status === 'idle' ? 'idle' : 'uptodate', error: '' });
  },
  /** Switch to the downloaded version and reload the current screen (same address, saved data untouched). */
  apply() {
    const w = waitingWorker || (reg && reg.waiting);
    if (!w) { setU({ status: 'failed', error: 'activate' }); return; }
    applying = true;
    setU({ status: 'applying', error: '' });
    try { w.postMessage({ type: 'SKIP_WAITING' }); } catch { /* handled by the timeout */ }
    setTimeout(() => { if (applying && U.status === 'applying') { applying = false; setU({ status: 'failed', error: 'activate' }); } }, 10000);
  },
  /** Last resort for a stuck copy: forget every saved app file and start fresh. Settings and saved items stay. */
  async repair() {
    try { (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister()); } catch { /* ignore */ }
    try { for (const k of await caches.keys()) if (k.startsWith('cm-') || k.startsWith('cm3-')) await caches.delete(k); } catch { /* ignore */ }
    location.reload();
  },
};
/** Set once after an update reloaded the app: the version it moved to, then forgotten. */
export function takeUpdatedNote() {
  try { const v = sessionStorage.getItem('cm-updated'); sessionStorage.removeItem('cm-updated'); return v; } catch { return null; }
}

// 2. Keep the browser/status bar colour in step with the chosen theme
const THEME_COLOR = { dark: '#090f15', light: '#e8ecef' };
function syncThemeColor() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = THEME_COLOR[document.documentElement.dataset.theme] || THEME_COLOR.dark;
}
syncThemeColor();
new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// 3. Install state
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferred = e;
  flag.set(false); // the browser only offers this when the app is not installed, so an old "installed" note was wrong
  notify();
});
window.addEventListener('appinstalled', () => { deferred = null; flag.set(true); installedNow = true; notify(); });
standaloneQuery.addEventListener?.('change', () => { if (isStandalone()) flag.set(true); notify(); });
if (isStandalone()) flag.set(true);
setTimeout(() => { graceOver = true; notify(); }, 2500);
// Chrome on Android can say whether the app is installed (needs related_applications in the manifest).
navigator.getInstalledRelatedApps?.().then(apps => { if (apps && apps.length) { flag.set(true); notify(); } }).catch(() => {});

let installedNow = false;

function state() {
  if (isStandalone()) return 'hide';
  if (installedNow) return 'done';
  if (deferred) return 'native';
  if (flag.get()) return 'hide';
  if (isIOS) return 'ios';
  return graceOver ? 'manual' : 'hide';
}

// 4. Install card (Settings)
function initCard() {
  const card = document.getElementById('install');
  if (!card) return;
  const btn = document.getElementById('install-btn');
  const how = document.getElementById('install-how');
  const steps = document.getElementById('install-steps');
  const note = document.getElementById('install-note');
  const sub = document.getElementById('install-sub');
  const done = document.getElementById('install-done');
  const body = document.getElementById('install-body');
  const later = document.getElementById('install-added');
  const STEPS = {
    ios: iosSafari
      ? ['Tap the <b>Share</b> button at the bottom of Safari.', 'Scroll and choose <b>Add to Home Screen</b>.', 'Tap <b>Add</b>. The app appears on your home screen.']
      : ['Open this page in <b>Safari</b>, the only iPhone browser that can install apps.', 'Tap <b>Share</b>, then <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.'],
    manual: ['Open your browser menu (the three dots or the address bar icon).', 'Choose <b>Install app</b> or <b>Add to Home screen</b>.', 'Confirm. The app appears with your other apps.'],
  };
  let hideTimer = 0;
  const paint = () => {
    const s = state();
    clearTimeout(hideTimer);
    if (s === 'hide') { card.hidden = true; return; }
    card.hidden = false;
    card.classList.toggle('is-done', s === 'done');
    body.hidden = s === 'done';
    done.hidden = s !== 'done';
    if (s === 'done') { hideTimer = setTimeout(() => { card.hidden = true; }, 3500); return; }
    if (s === 'native') {
      btn.textContent = 'Install app'; how.hidden = true; later.hidden = true;
      note.textContent = 'Free. Takes a few seconds and can be removed any time.';
      sub.textContent = 'Add it to your home screen and open it like any other app.';
    } else {
      btn.textContent = how.hidden ? 'Show me how' : 'Hide steps';
      steps.innerHTML = STEPS[s].map(t => `<li>${t}</li>`).join('');
      later.hidden = s !== 'ios';
      note.textContent = s === 'ios' ? 'On iPhone and iPad the install happens from Safari\u2019s Share menu.' : 'Your browser did not offer a one-tap install, so here are the steps.';
      sub.textContent = 'Add it to your home screen and open it like any other app.';
    }
  };
  btn.addEventListener('click', async () => {
    if (state() === 'native' && deferred) {
      const ev = deferred;
      btn.disabled = true;
      try {
        ev.prompt();
        const { outcome } = await ev.userChoice;
        if (outcome === 'accepted') { deferred = null; flag.set(true); installedNow = true; }
      } catch { /* closed */ }
      btn.disabled = false;
      paint();
      return;
    }
    how.hidden = !how.hidden;
    paint();
  });
  later.addEventListener('click', () => { flag.set(true); paint(); });
  listeners.add(paint);
  paint();
}

// 5. Phone tab bar. The bar is plain HTML in every page and the current tab is decided once, before the
// first paint, by theme-init.js (<html data-tab>, with the same value copied to data-tab-at).
// This file only adds the instant answer to a tap, and puts the highlight back to that committed value if the
// page we left is shown again (Back, cancelled navigation), so no stale tab can ever linger.
// Inside the app shell (a frame of /app): the shell owns the bar, so this page only reports what the shell needs to know.
function initInShell() {
  const root = document.documentElement;
  const TABS = { '/': 'home', '/markets': 'markets', '/screener': 'screener', '/news': 'news', '/portfolio': 'portfolio' };
  const send = m => { try { parent.postMessage({ cm: m.cm, ...m }, location.origin); } catch { /* ignore */ } };
  // The first tap tells the shell the person is really using the app (it needs that to keep Back reliable).
  addEventListener('pointerup', () => send({ cm: 'act' }), { once: true, capture: true, passive: true });
  // Every ordinary link opens like a native screen: on top of this one, which stays exactly as it is underneath.
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
    if (a.pathname === location.pathname && a.search === location.search) return; // a jump inside this very page
    const menu = document.getElementById('menu');
    if (menu && menu.contains(a)) return; // the menu closes itself first, then goes (see initMenu)
    e.preventDefault();
    navTo(a.href);
  }, true);
  // Menu, sheets and the keyboard: the shell slides its bar away so they look exactly as before.
  let last = '';
  const report = () => {
    const away = root.classList.contains('menu-open') || document.body.classList.contains('sheet-open') || document.body.classList.contains('chart-open');
    const kb = root.classList.contains('kb-open');
    const key = away + '|' + kb;
    if (key !== last) { last = key; send({ cm: 'ui', away, kb }); }
  };
  new MutationObserver(report).observe(root, { attributes: true, attributeFilter: ['class'] });
  const watchBody = () => new MutationObserver(report).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (document.body) watchBody(); else document.addEventListener('DOMContentLoaded', watchBody);
  const typing = el => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|button|submit|range)$/.test(el.type || '');
  document.addEventListener('focusin', e => { if (typing(e.target)) root.classList.add('kb-open'); });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!typing(document.activeElement)) root.classList.remove('kb-open'); }, 60); });
}

function initTabBar() {
  if (document.documentElement.classList.contains('in-shell')) { initInShell(); return; }
  const bar = document.querySelector('.app-tabbar');
  const root = document.documentElement;
  const committed = () => root.dataset.tabAt || '';
  // Remember the tab for the next screen (a coin opened from Overview keeps Overview lit), per history entry.
  // A page that is only being prepared in the background must not write this: it waits until it is shown.
  const remember = () => {
    try {
      sessionStorage.setItem('cm-tab-last', committed());
      if (location.pathname.startsWith('/coin') && !(history.state && history.state.cmTab != null)) history.replaceState({ ...(history.state || {}), cmTab: committed() }, '');
    } catch { /* ignore */ }
  };
  if (document.prerendering) document.addEventListener('prerenderingchange', remember, { once: true }); else remember();
  // All five tabs are prepared in the background, so a tap shows a ready screen instead of loading one.
  if (isStandalone() && !document.prerendering && HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
    try {
      const here0 = location.pathname.replace(/\/+$/, '') || '/';
      const urls = ['/', '/markets', '/screener', '/news', '/portfolio'].filter(u => u !== here0);
      const sr = document.createElement('script');
      sr.type = 'speculationrules';
      sr.textContent = JSON.stringify({ prerender: [{ source: 'list', urls, eagerness: 'eager' }] });
      document.head.appendChild(sr);
    } catch { /* fall back to the warm-up below */ }
  }
  if (!bar) return;
  const mark = tab => {
    root.dataset.tab = tab;
    bar.querySelectorAll('a').forEach(a => { if (a.dataset.tab === tab && tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  };
  mark(committed());
  let revert = 0;
  // Warm the next screen the moment a finger lands, so the tap opens it almost instantly
  const warmed = new Set();
  if (!(HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules'))) bar.addEventListener('pointerdown', e => {
    const a = e.target.closest('a[data-tab]');
    const href = a && a.getAttribute('href');
    if (!href || warmed.has(href) || href === (location.pathname.replace(/\/+$/, '') || '/')) return;
    warmed.add(href);
    const l = document.createElement('link'); l.rel = 'prefetch'; l.href = href; document.head.appendChild(l);
  }, { passive: true });
  const here = () => location.pathname.replace(/\/+$/, '') || '/';
  bar.addEventListener('click', e => {
    const a = e.target.closest('a[data-tab]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (here() === a.getAttribute('href')) {
      // The tab's own main screen: back to the top, like a native app. No reload.
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    mark(a.dataset.tab); // answer the tap now; the screen follows
    clearTimeout(revert);
    revert = setTimeout(() => mark(committed()), 6000); // the navigation never happened: undo the guess
  });
  window.addEventListener('pageshow', e => { clearTimeout(revert); if (e.persisted) { mark(committed()); try { sessionStorage.setItem('cm-tab-last', committed()); } catch { /* ignore */ } } });
  // The on-screen keyboard pushes fixed bars up over the form: tuck the bar away while typing.
  const typing = el => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|button|submit|range)$/.test(el.type || '');
  document.addEventListener('focusin', e => { if (typing(e.target)) root.classList.add('kb-open'); });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!typing(document.activeElement)) root.classList.remove('kb-open'); }, 60); });
}

// 6. App behaviour that a website does not need
function initAppTouch() {
  if (!isStandalone()) return;
  // Long-press on a link, logo or button opens the browser's own context menu on Android. An app has none.
  // Typing fields and anything marked data-selectable keep it (copy, paste, select).
  document.addEventListener('contextmenu', e => {
    if (document.documentElement.dataset.select === 'on') return; // the visitor chose to allow selecting text
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"], [data-selectable], pre, code')) return;
    e.preventDefault();
  });
  document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('a, img')) e.preventDefault(); });
  // Pinch / double-tap zoom is a web habit; the app has its own text size setting.
  document.addEventListener('gesturestart', e => e.preventDefault());
}

function boot() { initCard(); initTabBar(); initAppTouch(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
