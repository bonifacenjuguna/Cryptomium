// Native-app feel for the installed app only (does nothing in a browser tab):
// header hairline on scroll, large title that collapses into the bar, light haptics, pull to refresh.
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
  const h1 = document.querySelector('main h1');
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

  // 3. Haptics: a short tick on switches, tabs, segmented controls and the bottom bar (where the device allows it)
  const tick = () => { if (!motionOff() && navigator.vibrate) { try { navigator.vibrate(8); } catch { /* not allowed */ } } };
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    if (e.target.closest('.switch, [role="switch"], [role="tab"], [role="radio"], .seg, .app-tabbar a, .theme-card, .cur-chip')) tick();
  }, { passive: true });

  // 4. Pull to refresh (only from the very top of a plain page, never inside charts, sheets, tables or the menu)
  const ptr = document.createElement('div');
  ptr.className = 'ptr';
  ptr.setAttribute('aria-hidden', 'true');
  ptr.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';
  document.body.appendChild(ptr);
  const LIMIT = 72;
  let y0 = 0, x0 = 0, pull = 0, live = false, busy = false;
  const blocked = el => el.closest('.chart-card, .sheet-back, .table-wrap, .menu, .search-list, input, textarea, select, [data-no-ptr]') || root.classList.contains('menu-open');
  const place = d => {
    const p = Math.min(d, LIMIT * 1.4);
    ptr.style.opacity = String(Math.min(1, p / LIMIT));
    ptr.style.transform = `translate3d(0, ${p - 60}px, 0) rotate(${p * 4}deg)`;
  };
  document.addEventListener('touchstart', e => {
    live = false; pull = 0;
    if (busy || e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; live = true;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!live) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (window.scrollY > 0 || dy < 0 || Math.abs(dx) > Math.abs(dy)) { live = false; ptr.style.opacity = '0'; return; }
    pull = dy * .55; place(pull);
  }, { passive: true });
  const end = () => {
    if (!live) return;
    live = false;
    if (pull >= LIMIT * .8 && !busy) {
      busy = true; tick();
      ptr.classList.add('spin'); ptr.style.opacity = '1'; ptr.style.transform = 'translate3d(0, 12px, 0)';
      setTimeout(() => location.reload(), 350);
    } else {
      ptr.style.transition = 'opacity .2s, transform .2s'; ptr.style.opacity = '0'; ptr.style.transform = 'translate3d(0, -60px, 0)';
      setTimeout(() => { ptr.style.transition = ''; }, 220);
    }
    pull = 0;
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}
