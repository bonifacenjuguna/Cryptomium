// Native-app feel for the installed app only (does nothing in a browser tab):
// header hairline on scroll, large title that collapses into the bar, light haptics.
import { isApp } from './pwa.js';

export function initAppFeel() {
  if (!isApp()) return;
  const root = document.documentElement;
  const motionOff = () => root.getAttribute('data-motion') === 'off';

  // 1. Hairline under the header once the page has scrolled
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { root.classList.toggle('scrolled', window.scrollY > 4); ticking = false; });
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // 2. Large title: the page's own heading moves into the bar when it scrolls out of view
  const h1 = document.querySelector('main h1:not(#c-name)'); // the coin page has its own bar content (logo, ticker, price)
  const bar = document.querySelector('.site-header .bar');
  if (h1 && bar && h1.offsetParent !== null && 'IntersectionObserver' in window) {
    const t = document.createElement('div');
    t.className = 'ab-title';
    t.setAttribute('aria-hidden', 'true');
    t.textContent = h1.textContent.trim();
    bar.appendChild(t);
    new IntersectionObserver(([e]) => root.classList.toggle('title-collapsed', !e.isIntersecting && e.boundingClientRect.top < 100),
      { rootMargin: '-64px 0px 0px 0px', threshold: 0 }).observe(h1);
  }

  // 3. Haptics (one setting: Settings > Experimental > Touch feedback, off by default; it also drives the chart): a short tick on switches, tabs, segmented controls and the bottom bar (where the device allows it)
  const hapticsOn = () => { try { return JSON.parse(localStorage.getItem('cm-prefs') || '{}').haptics === true; } catch { return false; } };
  const tick = () => { if (hapticsOn() && !motionOff() && navigator.vibrate) { try { navigator.vibrate(8); } catch { /* not allowed */ } } };
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    if (e.target.closest('.switch, [role="switch"], [role="tab"], [role="radio"], .seg, .app-tabbar a, .theme-card, .cur-chip')) tick();
  }, { passive: true });
}
