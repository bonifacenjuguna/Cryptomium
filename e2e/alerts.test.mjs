import assert from 'node:assert/strict';
import { open } from './harness.mjs';
const h = await open({ standalone: true }); const { page, ctx, url, errs, state } = h;
await page.goto(url + '/app?go=/settings/alerts'); await page.waitForTimeout(3500);
const f = page.frames().filter(x => x.url().includes('/settings/alerts')).pop();
await f.tap('#al-types [data-kind="below"]'); await page.waitForTimeout(300);
assert.equal(await f.locator('#al-dir').inputValue(), 'below');
const chips = await f.locator('#al-chips .al-chip').allTextContents();
console.log('quick targets for "Falls to":', chips.join(' '));
assert.ok(chips.length === 4 && chips[0].includes('5%'));
await f.locator('#al-chips .al-chip').first().tap(); await page.waitForTimeout(300);
console.log('price filled:', await f.locator('#al-price').inputValue(), '| preview:', await f.locator('#al-now').textContent());
await f.tap('.al-add'); await page.waitForTimeout(600);
const saved = await f.evaluate(() => JSON.parse(localStorage.getItem('cm-targets') || '[]'));
assert.equal(saved.length, 1); assert.equal(saved[0].dir, 'below'); assert.ok(saved[0].armedAt);
const rows = await f.locator('.al-row').count();
console.log('alerts listed:', rows, '| track bar:', await f.locator('.al-track').count());
assert.equal(rows, 1);
// sound toggle persists and is visible to the other screens
await f.tap('#push-card [data-toggle="sound"]'); await page.waitForTimeout(400);
const home = page.frames().find(x => x.url() === url + '/');
console.log('sound pref seen by Home screen:', await home.evaluate(() => JSON.parse(localStorage.getItem('cm-prefs')).sound));
// push is not configured on this mock server: the switch must say so, not lie
console.log('push switch:', await f.locator('#notif-switch').getAttribute('aria-checked'), '| text:', await f.locator('#notif-text').textContent());
console.log('errors', errs);
// offline page renders styled (no CSP block)
await page.goto(url + '/offline'); await page.waitForTimeout(800);
await page.screenshot({ path: '/home/claude/e2e/offline2.png' });
await h.close();
