import { open } from './harness.mjs';
const h = await open({ standalone: false }); const { page, url, errs } = h;
const out = [];
for (const p of ['/settings', '/settings/notifications', '/settings/lock', '/settings/backup', '/settings/alerts', '/compare', '/coin/BTC', '/portfolio', '/convert']) {
  const before = errs.length;
  await page.goto(url + p); await page.waitForTimeout(1800);
  out.push(p + ' ' + (errs.length === before ? 'ok' : 'ERR ' + JSON.stringify(errs.slice(before))));
}
console.log(out.join('\n'));
await page.goto(url + '/settings/notifications'); await page.waitForTimeout(1500);
console.log('quiet switch present:', await page.locator('#quiet-switch').count(), 'recap:', await page.locator('#recap-switch').count());
await page.evaluate(async () => { const m = await import('/js/push.js'); await m.setQuiet({ on: true, from: 0, to: 1439 }); });
console.log('quiet stored in worker cache:', await page.evaluate(async () => { const r = await (await caches.open('cmpush-v1')).match('/__cm/quiet'); return r ? await r.text() : null; }));
await page.goto(url + '/compare'); await page.waitForTimeout(1800);
await page.click('#cp-save'); await page.waitForTimeout(300);
console.log('compare sets saved:', await page.evaluate(() => localStorage.getItem('cm-compare-sets')));
await page.goto(url + '/coin/BTC'); await page.waitForTimeout(2000);
await page.click('#c-share'); await page.waitForTimeout(700);
console.log('share sheet items:', await page.locator('.sheet-list li, .sheet-list button').count());
await page.screenshot({ path: '/tmp/share-sheet.png' });
await h.close();
