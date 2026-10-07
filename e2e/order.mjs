import { open } from './harness.mjs';
const h = await open(); const { page, url, errs } = h;
await page.goto(url + '/app'); await page.waitForTimeout(3500);
const f = page.frames().find(x => x.url() === url + '/');
const rows = await f.evaluate(() => [...document.querySelectorAll('#coin-list .coin-row, .coin-list .row, [data-ticker]')].slice(0, 12).map(r => (r.dataset.ticker || r.textContent.trim().slice(0, 6))));
console.log('rows', rows);
console.log(await f.evaluate(() => { const l = document.querySelector('#coin-list, .coin-list'); return l ? { id: l.id, cls: l.className, flex: getComputedStyle(l).flexDirection, disp: getComputedStyle(l).display } : 'nolist'; }));
console.log(await f.evaluate(() => [...document.querySelectorAll('select, [data-sort]')].slice(0,6).map(e => e.id + ':' + (e.value||e.dataset.sort))));
await h.close();
