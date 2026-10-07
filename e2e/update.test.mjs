// End-to-end test of the Update Center flow in a real browser: deploys build A, then B, and checks every step.
import assert from 'node:assert/strict';
import { open as openRaw } from './harness.mjs';
const opened = [];
const open = async o => { const h = await openRaw(o); opened.push(h); return h; };
const A = '/tmp/feA/dist', B = '/tmp/feB/dist';
const manual = () => { try { localStorage.setItem('cm-update-mode', 'manual'); } catch {} };
const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); console.log('ok   ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL ', name, '\n      ', e.message.split('\n')[0]); } finally { while (opened.length) await opened.pop().close().catch(() => {}); } };
const settle = (page, ms = 3500) => page.waitForTimeout(ms);
const ready = async page => { await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(1500); };
const cacheKeys = page => page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('cm3-')).sort());
const pwa = (f) => f.evaluate(async () => { const m = await import('/js/pwa.js?v=' + (window.CRYPTOMIUM.build)); window.__upd = m.updates; return true; });

await test('B downloads in the background while A keeps running (manual mode)', async () => {
  const h = await open({ standalone: false }); const { page, url, state } = h;
  await page.addInitScript(manual); state.setDist(A);
  await page.goto(url + '/markets'); await settle(page); await ready(page);
  state.setDist(B);
  await page.evaluate(async () => { const m = await import('/js/pwa.js'); window.__upd = m.updates; await m.updates.check(); }); await settle(page);
  const r = await page.evaluate(() => ({ s: __upd.get().status, latest: __upd.get().latest, running: window.CRYPTOMIUM.version }));
  assert.equal(r.s, 'ready'); assert.equal(r.latest.version, '9.0.1'); assert.equal(r.running, '9.0.0');
  assert.equal((await cacheKeys(page)).filter(k => k.startsWith('cm3-shell-')).length, 2, 'both builds are saved side by side');
  // an address the worker never saved, while B is deployed but not applied: must stay a consistent A page
  await page.goto(url + '/coin/ZZZ'); await settle(page, 2500);
  const mixed = await page.evaluate(() => ({ running: window.CRYPTOMIUM.build, mark: window.__MARK, htmlPointsAt: new URL(document.querySelector('script[src*="config.js"]').src).searchParams.get('v') }));
  assert.equal(mixed.mark, 'A');
  assert.equal(mixed.htmlPointsAt, mixed.running, `page html is build ${mixed.htmlPointsAt} but the scripts running are build ${mixed.running}: two builds mixed`);
  // a page that exists only on the network (B's 404 page): fully B, never half and half
  await page.goto(url + '/no-such-page'); await settle(page, 2500);
  const four = await page.evaluate(() => ({ running: window.CRYPTOMIUM && window.CRYPTOMIUM.build, htmlPointsAt: new URL(document.querySelector('script[src*="config.js"]').src).searchParams.get('v') }));
  assert.equal(four.htmlPointsAt, four.running, 'a network-only page must run entirely on its own build');
  assert.equal(h.errs.filter(e => /PAGEERROR/.test(e)).length, 0, h.errs.join(' | '));
});

await test('Update now switches builds, reloads, and removes the old cache', async () => {
  const h = await open({ standalone: false }); const { page, url, state } = h;
  await page.addInitScript(manual); state.setDist(A);
  await page.goto(url + '/markets'); await settle(page); await ready(page);
  state.setDist(B);
  await page.evaluate(async () => { const m = await import('/js/pwa.js'); window.__upd = m.updates; await m.updates.check(); }); await settle(page);
  await page.evaluate(() => __upd.apply()); await settle(page, 4500);
  assert.equal(await page.evaluate(() => window.CRYPTOMIUM.version), '9.0.1');
  const keys = await cacheKeys(page);
  assert.ok(keys.every(k => !/9a44|feA/.test(k)) && keys.filter(k => k.startsWith('cm3-shell-')).length === 1, keys.join());
});

await test('failed download leaves A intact, reports it, and a retry succeeds', async () => {
  const h = await open({ standalone: false }); const { page, url, state } = h;
  await page.addInitScript(manual); state.setDist(A);
  await page.goto(url + '/markets'); await settle(page); await ready(page);
  state.setDist(B); state.block.add('/js/home.js');
  await page.evaluate(async () => { const m = await import('/js/pwa.js'); window.__upd = m.updates; await m.updates.check(); }); await settle(page);
  let r = await page.evaluate(() => ({ s: __upd.get().status, e: __upd.get().error, v: window.CRYPTOMIUM.version }));
  assert.deepEqual(r, { s: 'failed', e: 'install', v: '9.0.0' });
  assert.equal((await cacheKeys(page)).filter(k => k.startsWith('cm3-shell-')).length, 1, 'no half-saved B left behind');
  state.block.clear();
  await page.evaluate(() => __upd.check()); await settle(page);
  assert.equal(await page.evaluate(() => __upd.get().status), 'ready');
});

await test('installed app (shell): first session after install can still be updated, and returns to the same screen', async () => {
  const h = await open({ standalone: true }); const { page, url, state } = h;
  await page.addInitScript(manual); state.setDist(A);
  await page.goto(url + '/app?source=app'); await settle(page, 4500); await ready(page);   // first launch: no worker in control at start
  // open Price alerts from the menu (a pushed screen over Home)
  const home = page.frames().find(f => f.url() === url + '/');
  await home.tap('#menu-toggle'); await page.waitForTimeout(500); await home.tap('.menu a:has-text("Price alerts")'); await page.waitForTimeout(1200);
  state.setDist(B);
  const fr = () => page.frames().filter(f => f.url().includes('/settings/alerts')).pop();
  await fr().evaluate(async () => { const m = await import('/js/pwa.js'); window.__upd = m.updates; await m.updates.check(); }); await settle(page);
  assert.equal(await fr().evaluate(() => __upd.get().status), 'ready');
  await fr().evaluate(() => __upd.apply()); await settle(page, 6000);
  const out = await page.evaluate(() => ({ top: document.querySelector('iframe.on').contentWindow.location.pathname, ver: document.querySelector('iframe.on').contentWindow.CRYPTOMIUM.version }));
  assert.equal(out.ver, '9.0.1', 'every screen is on the new build');
  assert.equal(out.top, '/settings/alerts', 'back on the screen the person was using');
});

await test('a page left behind by a worker switch (frozen app) repairs itself on return', async () => {
  const h = await open({ standalone: false }); const { page, url, state } = h;
  await page.addInitScript(manual); state.setDist(A);
  await page.goto(url + '/markets'); await settle(page); await ready(page);
  state.setDist(B);
  await page.evaluate(async () => { const m = await import('/js/pwa.js'); window.__upd = m.updates; await m.updates.check(); }); await settle(page);
  // the worker switches but this page does not get to reload (app frozen in the background)
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); r.waiting.postMessage({ type: 'SKIP_WAITING' }); });
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.CRYPTOMIUM.version), '9.0.0', 'page is still the old build for now');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // the person comes back
  await settle(page, 3500);
  assert.equal(await page.evaluate(() => window.CRYPTOMIUM.version), '9.0.1');
});

const failed = results.filter(r => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} update tests passed`);
process.exit(failed.length ? 1 : 0);
