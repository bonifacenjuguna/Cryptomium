// App side of the site: service worker, install card, "installed" detection and the phone tab bar.
const FLAG = 'cm-pwa-installed';
const standaloneQuery = window.matchMedia('(display-mode: standalone)');
const isStandalone = () => standaloneQuery.matches || window.navigator.standalone === true;
export const isApp = isStandalone;
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

// 1. Service worker
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
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

// 5. Phone tab bar. The bar itself is plain HTML in every page (so it is there on the very first
// frame and never pops in), and the highlighted tab is decided by <html data-tab> which theme-init.js sets
// before the page paints. This only adds the instant tap response and keeps assistive text in step.
const TAB_OF = { '': 'home', coin: 'home', markets: 'markets', screener: 'screener', news: 'news', portfolio: 'portfolio' };
function initTabBar() {
  const bar = document.querySelector('.app-tabbar');
  if (!bar) return;
  const root = document.documentElement;
  const mark = tab => {
    root.dataset.tab = tab;
    bar.querySelectorAll('a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  };
  mark(root.dataset.tab || '');
  bar.addEventListener('click', e => {
    const a = e.target.closest('a[data-tab]');
    if (!a) return;
    if (a.dataset.tab === root.dataset.tab) {
      // Tapping the tab you are already on: back to the top of that screen (like a native app), no reload.
      e.preventDefault();
      const here = location.pathname.replace(/\/+$/, '') || '/';
      const own = a.getAttribute('href');
      if (here === own || (own === '/' && here.startsWith('/coin'))) {
        window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        return;
      }
    }
    mark(a.dataset.tab); // answer the tap now; the page follows
  });
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
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"], [data-selectable], pre, code')) return;
    e.preventDefault();
  });
  document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('a, img')) e.preventDefault(); });
  // Pinch / double-tap zoom is a web habit; the app has its own text size setting.
  document.addEventListener('gesturestart', e => e.preventDefault());
}

function boot() { initCard(); initTabBar(); initAppTouch(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
