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
  root.setAttribute('data-theme', resolved);
  var tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', resolved === 'dark' ? '#090f15' : '#e8ecef');
  var app = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (app) root.classList.add('is-app');
  if (window.navigator.standalone === true) root.classList.add('ios-app');
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
  if (p.palette === 'clear') root.setAttribute('data-palette', 'clear');
  if (Array.isArray(p.hide) && p.hide.length) root.setAttribute('data-hide', p.hide.filter(function (x) { return /^[a-z]+$/.test(x); }).join(' '));
})();
