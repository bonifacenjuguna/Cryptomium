import { open } from './harness.mjs';
const h = await open(); const { page, url, errs } = h;
await page.goto(url + '/app'); await page.waitForTimeout(3500);
const f = page.frames().find(x => new URL(x.url()).pathname === '/');
console.log('tabbar blur removed:', await page.evaluate(() => getComputedStyle(document.querySelector('.app-tabbar')).backdropFilter));
await page.goto(url + '/coin/BTC'); await page.waitForTimeout(2500);
console.log('chart contain:', await page.evaluate(() => { const c = document.querySelector('.chart'); return c ? getComputedStyle(c).contain : 'no chart'; }));
console.log('errors', JSON.stringify(errs));
await h.close();
