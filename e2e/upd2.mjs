import { open } from './harness.mjs';
const h = await open({ standalone: true }); const { page, url, state, errs } = h;
const A = '/tmp/feA/dist', B = '/tmp/feB/dist';
state.setDist(A); await page.addInitScript(() => { try { localStorage.setItem('cm-update-mode', 'manual'); } catch {} });
await page.goto(url + '/app?go=/settings/updates'); await page.waitForTimeout(4500); await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(1500);
const frames = () => page.frames().filter(f => f !== page.mainFrame());
const fr = () => frames().filter(f => f.url().includes('/settings/updates')).pop();
console.log('frames running pwa.js:', frames().length, ' regs:', await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length));
// ---- failure: B cannot download one file
state.setDist(B); if (process.env.FAIL) state.block.add('/js/home.js');
await fr().evaluate(async () => { const m = await import('/js/pwa.js'); window.__upd = m.updates; await m.updates.check(); });
await page.waitForTimeout(3000);
console.log('FAIL install ->', JSON.stringify(await fr().evaluate(async () => ({ status: __upd.get().status, error: __upd.get().error, caches: (await caches.keys()).sort(), stillA: window.CRYPTOMIUM.version }))));
// ---- retry after fix
state.block.clear();
await fr().evaluate(async () => { await __upd.check(); }); await page.waitForTimeout(3500);
console.log('RETRY ->', JSON.stringify(await fr().evaluate(async () => ({ status: __upd.get().status, latest: __upd.get().latest && __upd.get().latest.version }))));
// how many screens know an update is ready?
const ready = []; for (const f of frames()) ready.push(await f.evaluate(async () => { const m = await import('/js/pwa.js'); return m.updates.get().status; }).catch(() => '?'));
console.log('per-screen status:', ready.join(','));
// ---- apply from the Update Center inside the shell
await page.evaluate(() => { window.__m = 1; }); await fr().evaluate(() => { window.__fm = 1; });
await fr().evaluate(() => __upd.apply()); await page.waitForTimeout(2500);
console.log('2.5s after apply:', JSON.stringify(await page.evaluate(async () => ({ caches: (await caches.keys()).sort(), shellLoadedAt: performance.timeOrigin | 0, ctrl: !!navigator.serviceWorker.controller }))));
await page.waitForTimeout(3000);
const after = await page.evaluate(() => ({ shellUrl: location.pathname + location.search, framesOn: [...document.querySelectorAll('iframe')].filter(f => f.classList.contains('on')).map(f => f.contentWindow.location.pathname) }));
for (const f of frames()) console.log('  frame', new URL(f.url()).pathname, await f.evaluate(() => window.CRYPTOMIUM && window.CRYPTOMIUM.version).catch(e => 'n/a'));
console.log('shell survived without reload:', await page.evaluate(() => window.__m === 1), ' settings frame survived:', await fr().evaluate(() => window.__fm === 1).catch(() => 'frame replaced'));
console.log('AFTER apply: ', JSON.stringify(after), 'version', await page.frames().find(f => f.url().endsWith('/'))?.evaluate(() => window.CRYPTOMIUM.version));
console.log('errors', errs);
await h.close();
