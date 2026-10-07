import { open } from './harness.mjs';
const [,, path = '/app', out = 'shot.png', scroll = '0', theme = ''] = process.argv;
const h = await open(); const { page, url } = h;
if (theme) await page.addInitScript(t => localStorage.setItem('cm-prefs', JSON.stringify(t)), JSON.parse(theme));
await page.goto(url + path); await page.waitForTimeout(3500);
if (+scroll) { const f = page.frames().find(x => x.url() === url + '/') ; await f.evaluate(y => window.scrollTo(0, y), +scroll); await page.waitForTimeout(500); }
await page.screenshot({ path: '/home/claude/e2e/' + out });
await h.close();
