import { open } from './harness.mjs';
const h = await open(); const { page, url, errs } = h;
await page.goto(url + '/app'); await page.waitForTimeout(3500);
const tab = () => page.evaluate(() => document.documentElement.dataset.tab);
const click = t => page.click(`.app-tabbar a[data-tab="${t}"]`);
const seq = [];
for (const t of ['markets', 'news', 'markets', 'news']) { await click(t); await page.waitForTimeout(250); }
seq.push(await tab());
for (let i = 0; i < 4; i++) {
  await page.goBack().catch(() => {}); await page.waitForTimeout(450);
  seq.push(await tab() + '@' + new URL(page.url()).pathname);
}
console.log('BACK TRAIL (expect news, markets, home, then leaves app):', seq.join(' > '));
console.log('errors', errs);
await h.close();
