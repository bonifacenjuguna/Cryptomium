import { open } from './harness.mjs';
const h = await open(); const { page, url, errs } = h;
const labels = ['Watchlist','Converter','Price alerts','Update app','Settings','Learn crypto','Help and about','Data sources','Data and privacy'];
for (const label of labels) {
  await page.goto(url + '/app'); await page.waitForTimeout(1800);
  const home = page.frames().find(f => f.url() === url + '/');
  await home.tap('#menu-toggle'); await page.waitForTimeout(500);
  await home.tap(`.menu a:has-text("${label}")`).catch(() => console.log('tap fail', label));
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => { const f = document.querySelector('iframe.on'); const d = f.contentDocument; return { path: f.contentWindow.location.pathname + f.contentWindow.location.hash, h1: (d.querySelector('h1')||{}).textContent, away: document.documentElement.classList.contains('shell-away'), body: d.body.innerText.length, switches: d.querySelectorAll('[role=switch],.switch').length }; });
  console.log(label.padEnd(16), JSON.stringify(info));
}
console.log('ERRORS', errs.slice(0, 15));
await h.close();
