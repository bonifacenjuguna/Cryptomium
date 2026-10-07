import { open } from './harness.mjs';
const h = await open({ standalone: false }); const { page, url, errs } = h;
await page.goto(url + '/settings/alerts'); await page.waitForTimeout(2200);
await page.click('#al-types [data-kind="move"]'); await page.waitForTimeout(200);
console.log('label (move):', await page.textContent('#al-price-l'));
await page.click('#al-types [data-kind="above"]'); await page.waitForTimeout(200);
console.log('label (above):', await page.textContent('#al-price-l'), '| al-code present:', await page.locator('#al-code').count());
console.log('errors:', JSON.stringify(errs));
await h.close();
