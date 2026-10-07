import assert from 'node:assert/strict';
import { open } from './harness.mjs';
const h = await open({ standalone: false }); const { page, url, state } = h;
state.setDist('/tmp/feA/dist');
await page.goto(url + '/markets'); await page.waitForTimeout(3000); await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(9000);                       // past the "just opened" window, so only the idle rule can install it
state.setDist('/tmp/feB/dist');
await page.evaluate(async () => { const m = await import('/js/pwa.js'); await m.updates.check({ silent: true }); });
await page.waitForTimeout(3000);
console.log('mode:', await page.evaluate(() => localStorage.getItem('cm-update-mode') || 'auto (default)'), '| still running:', await page.evaluate(() => window.CRYPTOMIUM.version));
await page.waitForTimeout(58000);
const v = await page.evaluate(() => window.CRYPTOMIUM.version);
console.log('after ~1 minute idle:', v);
assert.equal(v, '9.0.1', 'automatic mode installed the update by itself');
console.log('ok: auto mode installs while idle');
await h.close();
