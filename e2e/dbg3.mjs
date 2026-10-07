import { open } from './harness.mjs';
const h = await open({ standalone: false }); const { page, url } = h;
page.on('pageerror', e => console.log('STACK', e.stack.split('\n').slice(0, 4).join(' | ')));
await page.goto(url + '/settings/alerts?noshell'); await page.waitForTimeout(1500);
await h.close();
