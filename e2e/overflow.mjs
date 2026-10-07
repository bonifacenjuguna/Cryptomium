import { open } from './harness.mjs';
const [,, path] = process.argv;
const h = await open(); const { page, url } = h;
await page.goto(url + path); await page.waitForTimeout(3000);
const f = page.frames().find(x => x.url().includes(path.split('go=')[1] || path)) || page.mainFrame();
console.log(await f.evaluate(() => { const vw = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > vw + 1).slice(0, 8).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right) + '/' + vw); return { vw, sw: document.documentElement.scrollWidth, bad }; }));
await h.close();
