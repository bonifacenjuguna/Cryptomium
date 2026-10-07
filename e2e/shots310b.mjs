import { open } from './harness.mjs';
const h = await open(); const { page, url } = h;
await page.goto(url + '/app'); await page.waitForTimeout(4000);
const f = page.frames().find(x => new URL(x.url()).pathname === '/');
await f.click('#menu-toggle'); await page.waitForTimeout(900); await page.screenshot({ path: '/tmp/menu.png' });
await h.close();
