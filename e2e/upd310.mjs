import { open } from './harness.mjs';
import { execSync } from 'node:child_process';
const h = await open(); const { page, url, errs } = h;
await page.goto(url + '/app'); await page.waitForTimeout(4000);
await page.reload(); await page.waitForTimeout(4000); // second launch: the worker now controls the app, like every real launch after the first
await page.click('.app-tabbar a[data-tab="news"]'); await page.waitForTimeout(500);
const fr = () => page.frames().find(x => new URL(x.url()).pathname === '/news');
const buildOf = async () => page.evaluate(() => window.CRYPTOMIUM.build);
const before = await buildOf();
// deploy build B
execSync('rm -rf /home/claude/frontend/dist && cp -r /tmp/fe2/dist /home/claude/frontend/dist');
const f = fr();
const st = await f.evaluate(async () => {
  const { updates } = await import('/js/pwa.js');
  updates.setMode('manual');
  await updates.check();
  for (let i = 0; i < 40 && updates.get().status !== 'ready'; i++) await new Promise(r => setTimeout(r, 250));
  return { status: updates.get().status, latest: updates.get().latest, ctx: updates.get().context };
});
console.log('after check (manual):', JSON.stringify(st));
await page.waitForTimeout(3500);
console.log('still old build in manual mode:', (await buildOf()) === before);
await f.evaluate(async () => { const { updates } = await import('/js/pwa.js'); updates.apply(); });
await page.waitForTimeout(9000);
const after = await buildOf();
const opened = await page.evaluate(() => [...document.querySelectorAll('.tab-frame')].map(f => f.dataset.tab + (f.classList.contains('on') ? '*' : '')).join(','));
console.log('frames:', opened);
console.log('build changed after Update now:', before, '->', after, '| tab restored:', await page.evaluate(() => document.documentElement.dataset.tab));
const cachesNow = await page.evaluate(async () => (await caches.keys()).sort());
console.log('caches:', cachesNow.join(', '));
console.log('errors', errs);
await h.close();
