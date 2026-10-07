import { open } from './harness.mjs';
const h = await open(); const { page, ctx, url, errs } = h;
await page.goto(url + '/app'); await page.waitForTimeout(4000);
await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(2500);
await ctx.setOffline(true); h.state.offline = true;
const home = page.frames().find(f => f.url() === url + '/');
await home.tap('#menu-toggle'); await page.waitForTimeout(400);
await home.tap('.menu a:has-text("Update app")'); await page.waitForTimeout(1500);
const info = await page.evaluate(() => { const f = document.querySelector('iframe.on'); const d = f.contentDocument; return { path: f.contentWindow.location.pathname, text: d.body.innerText.slice(0, 80) }; });
console.log('offline update screen:', JSON.stringify(info));
await page.screenshot({ path: '/home/claude/e2e/off1.png' });
// also: press the check button
const f = page.frames().find(x => x.url().includes('/settings/updates'));
if (f) { const btns = await f.$$eval('main button', b => b.map(x => x.textContent.trim() + '|' + x.id)); console.log(btns); }
console.log(errs);
await h.close();
