import { open } from './harness.mjs';
const h = await open(); const { page, url } = h;
await page.goto(url + '/app?go=/settings/alerts'); await page.waitForTimeout(3000);
console.log(page.frames().map(x=>x.url())); const f = page.frames().filter(x => x.url().includes('/settings/alerts')).pop(); console.log(await f.evaluate(() => document.body.innerHTML.slice(0,300)));
console.log(await f.evaluate(() => { const i = document.getElementById('al-price'); const cs = getComputedStyle(i); const w = document.querySelector('.al-input'); return { bg: cs.backgroundColor, h: cs.height, border: cs.borderTopWidth, wrapW: w.getBoundingClientRect().width, docW: document.documentElement.clientWidth, innerW: innerWidth, formW: document.getElementById('al-form').getBoundingClientRect().width, cardW: document.querySelector('.s-card').getBoundingClientRect().width, bodyW: document.body.getBoundingClientRect().width }; }));
console.log(await page.evaluate(() => ({ iw: innerWidth, ifr: document.querySelector('iframe.on').getBoundingClientRect().width })));
await h.close();
