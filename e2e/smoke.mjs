import fs from 'node:fs';
import { open } from './harness.mjs';
const h = await open({ standalone: false }); const { page, url, errs } = h;
const pages = ['/', '/markets', '/screener', '/news', '/compare', '/converter', '/portfolio', '/about', '/privacy', '/offline', '/coin/BTC', '/coin/ETH',
  ...fs.readdirSync('/home/claude/frontend/dist/settings').filter(f => f.endsWith('.html')).map(f => '/settings/' + f.replace('.html', '')), '/settings'];
let bad = 0;
for (const p of pages) {
  errs.length = 0;
  await page.goto(url + p + '?noshell'); await page.waitForTimeout(1300);
  const ok = await page.evaluate(() => document.querySelector('main, #main') !== null || document.body.innerText.length > 20);
  const e = errs.filter(x => !/Failed to load|net::|status of 404/.test(x));
  if (e.length || !ok) { bad++; console.log('PROBLEM', p, e.slice(0, 2)); }
}
console.log(`${pages.length} pages loaded, ${bad} with problems`);
await h.close();
