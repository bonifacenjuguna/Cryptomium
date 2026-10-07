import { open } from './harness.mjs';
const run = async (label, taps, backs) => {
  const h = await open(); const { page, url } = h;
  await page.goto(url + '/app'); await page.waitForTimeout(3500);
  for (const t of taps) { await page.click(`.app-tabbar a[data-tab="${t}"]`); await page.waitForTimeout(250); }
  const seq = [await page.evaluate(() => document.documentElement.dataset.tab)];
  for (let i = 0; i < backs; i++) { await page.goBack().catch(() => {}); await page.waitForTimeout(450); seq.push(await page.evaluate(() => document.documentElement.dataset.tab).catch(() => 'left-app')); }
  console.log(label, seq.join(' > ')); await h.close();
};
await run('loop  ', ['markets', 'news', 'markets', 'news'], 4);
await run('home  ', ['markets', 'news', 'home', 'markets'], 3);
