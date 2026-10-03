// Runs before the page paints, so the chosen theme never flashes.
(function () {
  var t = null;
  try { t = localStorage.getItem('cm-theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
