import assert from 'node:assert/strict';
import { open } from './harness.mjs';
const h = await open({ standalone: true }); const { page, url } = h;
await page.goto(url + '/app?source=app'); await page.waitForTimeout(2500);
const tab = () => page.evaluate(() => document.documentElement.dataset.tab);
const go = async t => { await page.evaluate(t => document.querySelector(`#app-tabs a[data-tab="${t}"], .app-tabbar a[data-tab="${t}"], a[data-tab="${t}"]`).click(), t); await page.waitForTimeout(350); };
const back = async () => { await page.evaluate(() => history.back()); await page.waitForTimeout(700); };
for (const t of ['markets', 'news', 'markets', 'news']) await go(t);
assert.equal(await tab(), 'news');
const seen = [];
for (let i = 0; i < 2; i++) { await back(); seen.push(await tab()); }
console.log('back from News after Overview,News,Overview,News ->', seen.join(' -> '));
assert.deepEqual(seen, ['markets', 'home'], 'each place once, in reverse');
// a pushed screen is left first, then tabs
await go('news'); await go('portfolio');
await page.evaluate(() => { document.querySelector('iframe.on').contentWindow.postMessage('x', '*'); });
const fr = page.frames().find(f => f.url().endsWith('/portfolio'));
await fr.evaluate(() => parent.postMessage({ cm: 'push', url: '/settings/alerts' }, location.origin)); await page.waitForTimeout(700);
const depth = () => page.evaluate(() => document.querySelector('iframe.on').contentWindow.location.pathname);
assert.equal(await depth(), '/settings/alerts');
await back(); assert.equal(await depth(), '/portfolio', 'pushed screen closes first');
await back(); assert.equal(await tab(), 'news');
console.log('ok: navigation back-trail');
await h.close();
