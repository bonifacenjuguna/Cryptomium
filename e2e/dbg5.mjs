import { open } from './harness.mjs';
const h = await open({ standalone: true }); const { page, url, errs } = h;
await page.goto(url + '/app?go=/settings/notifications'); await page.waitForTimeout(3000);
const f = page.frames().filter(x => x.url().includes('/settings/notifications')).pop();
await f.tap('#qh-switch'); await page.waitForTimeout(600);
console.log(await f.evaluate(() => ({ hiddenAttr: document.getElementById('qh-row').hidden, sw: document.getElementById('qh-switch').getAttribute('aria-checked'), prefs: JSON.parse(localStorage.getItem('cm-prefs')).quietOn, ids: ['notif-switch','notif-text','push-prefs','dg-row','qh-row'].map(i => i + ':' + !!document.getElementById(i)).join(' ') })));
console.log('errors:', errs);
await h.close();
