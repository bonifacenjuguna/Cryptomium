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
  root.setAttribute('data-accent', p.accent || 'citrine');
  root.setAttribute('data-density', p.density || 'comfortable');
  if (p.motion === false) root.setAttribute('data-motion', 'off');
})();
