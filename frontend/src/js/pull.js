// Pull down to refresh, for the installed app (the system's own gesture is switched off there so it cannot fight the app's own
// screens). Only starts from the very top of a page, never inside a sheet, a chart or a field, and reloads just the open screen.
import { isApp } from './pwa.js';

if (isApp() && window.matchMedia('(pointer: coarse)').matches) {
  const root = document.documentElement;
  const FIRE = 64;
  let startY = 0, pull = 0, active = false, ind = null;

  const blocked = t => {
    if (root.classList.contains('locked') || root.classList.contains('menu-open') || document.body.classList.contains('sheet-open') || document.body.classList.contains('chart-open')) return true;
    for (let n = t; n && n !== document.body; n = n.parentElement) {
      if (n.scrollTop > 0) return true;                                   // something inside is scrolled: that scroll wins
      if (n.matches && n.matches('input, textarea, select, canvas, .sheet, .panel, [data-no-pull], .chart, .tv-chart')) return true;
    }
    return false;
  };
  const make = () => {
    ind = document.createElement('div');
    ind.className = 'ptr';
    ind.setAttribute('aria-hidden', 'true');
    ind.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>';
    document.body.append(ind);
  };
  const paint = p => {
    if (!ind) make();
    ind.style.opacity = String(Math.min(1, p / FIRE));
    ind.style.transform = `translate(-50%, ${Math.min(p, 90) - 40}px) rotate(${p * 4}deg)`;
  };
  const reset = () => { active = false; pull = 0; if (ind) { ind.remove(); ind = null; } };

  addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || (document.scrollingElement || root).scrollTop > 0 || blocked(e.target)) return;
    startY = e.touches[0].clientY; pull = 0; active = true;
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (!active) return;
    if ((document.scrollingElement || root).scrollTop > 0) { reset(); return; }
    pull = (e.touches[0].clientY - startY) * 0.5;
    if (pull <= 0) { reset(); return; }
    paint(pull);
  }, { passive: true });
  addEventListener('touchend', () => {
    if (!active) return;
    if (pull >= FIRE && ind) { ind.classList.add('spin'); setTimeout(() => location.reload(), 220); active = false; return; }
    reset();
  }, { passive: true });
  addEventListener('touchcancel', reset, { passive: true });
}
