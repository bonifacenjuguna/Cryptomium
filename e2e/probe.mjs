import { open } from './harness.mjs';
const h = await open(); const { page, url, errs } = h;
const pages = ['appearance','preferences','home','watchlist','alerts','updates','learn','sources','data'];
for (const name of pages) {
  await page.goto(url + `/settings/${name}?noshell`); await page.waitForTimeout(1500);
  const n = await page.evaluate(() => document.querySelectorAll('main button, main [role=switch], main [role=radio], main [role=tab], main .seg *, main a.btn, main select, main input').length);
  const dead = [];
  const sel = 'main button, main [role=switch], main [role=radio], main [role=tab], main select, main input[type=checkbox], main input[type=radio]';
  const count = await page.locator(sel).count();
  for (let i = 0; i < count; i++) {
    const el = page.locator(sel).nth(i);
    const label = (await el.evaluate(e => (e.getAttribute('aria-label') || e.id || e.textContent || e.className).trim().replace(/\s+/g, ' ').slice(0, 40))).trim();
    if (!(await el.isVisible())) continue;
    if (/Clear|Reset|Erase|Remove|Delete|Restore|Update|Refresh|Check|Download|Export|Import/i.test(label)) continue; // destructive/leave-page
    const before = await page.evaluate(() => JSON.stringify([localStorage, document.documentElement.outerHTML.length, document.querySelector('main').innerHTML.length, [...document.querySelectorAll('[aria-checked],[aria-pressed],[aria-selected]')].map(x => x.outerHTML.slice(0,200))]));
    await el.click({ timeout: 2000, force: true }).catch(() => {});
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => JSON.stringify([localStorage, document.documentElement.outerHTML.length, document.querySelector('main').innerHTML.length, [...document.querySelectorAll('[aria-checked],[aria-pressed],[aria-selected]')].map(x => x.outerHTML.slice(0,200))]));
    if (before === after) dead.push(label);
    if (!page.url().includes(`/settings/${name}`)) { await page.goto(url + `/settings/${name}?noshell`); await page.waitForTimeout(800); }
  }
  console.log(name.padEnd(12), 'controls:', count, ' no-visible-effect:', JSON.stringify(dead));
}
console.log('ERRORS', errs.slice(0, 15));
await h.close();
