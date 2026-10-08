// Runs before the page paints, so the chosen theme, accent and density never flash.
(function () {
  var p = {};
  try { p = JSON.parse(localStorage.getItem('cm-prefs') || '{}') || {}; } catch (e) {}
  var t = p.theme;
  if (t !== 'light' && t !== 'dark' && t !== 'auto') {
    // Older versions kept the theme under its own key.
    try { t = localStorage.getItem('cm-theme'); } catch (e) {}
  }
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var resolved = t === 'light' || t === 'dark' ? t : dark ? 'dark' : 'light';
  var root = document.documentElement;
  var framed = false;
  try { framed = window.top !== window; } catch (e) { framed = true; }
  var path0 = (location.pathname.replace(/\/+$/, '') || '/'), first0 = path0.split('/')[1] || '';
  var isTab0 = ['', 'markets', 'screener', 'news', 'portfolio', 'coin', 'settings'].indexOf(first0) >= 0; // settings: a notification can open Price alerts directly
  // Installed app on a phone: the five tabs live together in one shell page (/app). A tab page opened on its own
  // (old link, shortcut, deep link) is handed to the shell, which shows it in the right place.
  var appNow = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (!framed && appNow && isTab0 && window.matchMedia && window.matchMedia('(max-width: 820px)').matches && !/[?&]noshell\b/.test(location.search)) {
    location.replace('/app?go=' + encodeURIComponent(location.pathname + location.search + location.hash));
    return;
  }
  if (framed) root.classList.add('in-shell');
  root.setAttribute('data-theme', resolved);
  var tc = document.querySelector('meta[name="theme-color"]');
  var app = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (tc) tc.setAttribute('content', resolved === 'dark' ? '#090f15' : app ? '#f1f3f6' : '#e8ecef');
  if (app) {
    root.classList.add('is-app');
    // Launch splash: once per app launch (per session), pure CSS
    try { if (!framed && !sessionStorage.getItem('cm-splashed')) { sessionStorage.setItem('cm-splashed', '1'); root.classList.add('splash'); } } catch (e) {}
  }
  if (window.navigator.standalone === true) root.classList.add('ios-app');
  // Which bottom tab is current, decided here once, before the page paints, from the address alone:
  // a main screen lights its own tab; a coin page keeps the tab it was opened from (remembered per history
  // entry, so Back and reload agree); everything else lights none. pwa.js only ever reverts to this value.
  var path = (location.pathname.replace(/\/+$/, '') || '/'), first = path.split('/')[1] || '';
  var tabs = { '': 'home', markets: 'markets', screener: 'screener', news: 'news', portfolio: 'portfolio' };
  var main = Object.prototype.hasOwnProperty.call(tabs, first) && first !== 'coin';
  var tab = main ? tabs[first] : '';
  if (first === 'coin') {
    var from = null;
    try { from = history.state && history.state.cmTab; } catch (e) {}
    if (from == null) { try { from = sessionStorage.getItem('cm-tab-last'); } catch (e) {} }
    tab = ['', 'home', 'markets', 'screener', 'news', 'portfolio'].indexOf(from) >= 0 && from !== null ? from : 'home';
  }
  root.setAttribute('data-tab', tab);
  root.setAttribute('data-tab-at', tab);
  root.setAttribute('data-depth', path === '/' || (main && path === '/' + first) ? 'root' : 'sub');
  root.setAttribute('data-accent', p.accent || 'citrine');
  var d = p.density;
  var migrated = false;
  try { migrated = localStorage.getItem('cm-prefs-v') === '2'; } catch (e) {}
  if (!migrated || (d !== 'comfortable' && d !== 'compact')) {
    d = window.matchMedia && window.matchMedia('(max-width: 820px)').matches ? 'compact' : 'comfortable';
  }
  root.setAttribute('data-density', d);
  if (p.motion === false) root.setAttribute('data-motion', 'off');
  if (p.tape === false) root.setAttribute('data-tape', 'off');
  if (p.textSize === 'large' || p.textSize === 'larger') root.setAttribute('data-size', p.textSize);
  if (p.selectText === true) root.setAttribute('data-select', 'on');
  if (p.palette === 'clear') root.setAttribute('data-palette', 'clear');
  if (Array.isArray(p.hide) && p.hide.length) root.setAttribute('data-hide', p.hide.filter(function (x) { return /^[a-z]+$/.test(x); }).join(' '));
})();
