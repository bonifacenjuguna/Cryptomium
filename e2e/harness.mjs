import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { start } from './serve.mjs';
export const CHROME = process.env.CHROME;
export async function open({ standalone = true, width = 360, height = 800, port = 4173 } = {}) {
  const { server, state, url } = await start(port);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  if (standalone) await ctx.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = q => { const m = real(q); if (!/display-mode:\s*standalone/.test(q)) return m; return new Proxy(m, { get: (t, k) => k === 'matches' ? true : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }); };
  });
  const page = await ctx.newPage();
  const errs = [];
  const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 200)); }); };
  watch(page); ctx.on('page', watch);
  return { page, ctx, browser, server, state, url, errs, close: async () => { await browser.close(); server.close(); } };
}
