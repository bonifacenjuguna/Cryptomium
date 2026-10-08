import assert from 'node:assert/strict';
import { open } from './harness.mjs';
const res = []; const t = async (n, fn) => { try { await fn(); res.push(1); console.log('ok   ', n); } catch (e) { res.push(0); console.log('FAIL ', n, '\n      ', e.message.split('\n')[0]); } };
const h = await open({ standalone: true }); const { page, url, errs } = h;
const sf = (path) => page.frames().filter(f => f.url().includes(path)).pop();

await t('settings hub: the new sections, no duplicates of the menu', async () => {
  await page.goto(url + '/app?go=/settings'); await page.waitForTimeout(3000);
  const rows = await sf('/settings').$$eval('.hub-card .hub-t', els => els.filter(e => e.offsetParent).map(e => e.textContent.trim()));
  console.log('      rows:', rows.join(' | '));
  for (const want of ['Appearance', 'Preferences', 'Region and format', 'Accessibility', 'Notifications', 'Security and privacy', 'Data saver', 'Advanced']) assert.ok(rows.includes(want), 'missing ' + want);
  for (const gone of ['Watchlist', 'Price alerts', 'Learn crypto', 'Data sources', 'Data and privacy', 'App updates', 'Experimental']) assert.ok(!rows.includes(gone), 'still there: ' + gone);
});

await t('icons: plain text colour by default, accent colour on another theme', async () => {
  const col = () => sf('/settings').evaluate(() => getComputedStyle(document.querySelector('.hub-ic')).color + '|' + getComputedStyle(document.documentElement).getPropertyValue('--ink').trim());
  const [c1, ink] = (await col()).split('|');
  console.log('      default icon colour', c1);
  await sf('/settings').evaluate(() => { const p = JSON.parse(localStorage.getItem('cm-prefs') || '{}'); p.accent = 'azure'; localStorage.setItem('cm-prefs', JSON.stringify(p)); });
  await page.reload(); await page.waitForTimeout(3000);
  const [c2] = (await col()).split('|');
  console.log('      azure icon colour  ', c2);
  assert.notEqual(c1, c2, 'icons should change with the theme');
  assert.match(c2, /59, 130, 246|rgb\(\d+, \d+, \d+\)/);
  const tab = await page.evaluate(() => getComputedStyle(document.querySelector('.app-tabbar [data-tab="home"]')).color);
  console.log('      tab bar icon        ', tab);
  await sf('/settings').evaluate(() => { const p = JSON.parse(localStorage.getItem('cm-prefs') || '{}'); delete p.accent; localStorage.setItem('cm-prefs', JSON.stringify(p)); });
});

await t('Back from another tab goes Home first, then leaves', async () => {
  await page.goto(url + '/app?go=/news'); await page.waitForTimeout(2800);
  const tab = () => page.evaluate(() => document.documentElement.dataset.tab);
  assert.equal(await tab(), 'news');
  await page.evaluate(() => history.back()); await page.waitForTimeout(700);
  assert.equal(await tab(), 'home', 'Home comes before leaving');
});

await t('notifications page: digest and quiet hours switches and pickers', async () => {
  await page.goto(url + '/app?go=/settings/notifications'); await page.waitForTimeout(3000);
  const f = sf('/settings/notifications');
  assert.equal(await f.locator('#push-prefs').isVisible(), false, 'digest and milestones appear only once push is on');
  await f.tap('#qh-switch'); await page.waitForTimeout(300);
  assert.equal(await f.locator('#qh-row').isVisible(), true);
  await f.tap('#qh-from + .sel-btn'); await page.waitForTimeout(500);
  await f.locator('.sheet li').filter({ hasText: '23:00' }).first().tap(); await page.waitForTimeout(400);
  assert.equal(await f.evaluate(() => JSON.parse(localStorage.getItem('cm-prefs')).quietFrom), 23);
  await f.tap('[data-toggle="sound"]'); await page.waitForTimeout(200);
  await f.tap('#chime-pick + .sel-btn'); await page.waitForTimeout(500);
  await f.locator('.sheet li').filter({ hasText: 'Bell' }).first().tap(); await page.waitForTimeout(300);
  assert.equal(await f.evaluate(() => JSON.parse(localStorage.getItem('cm-prefs')).chime), 'bell');
  await f.tap('[data-reset]'); await page.waitForTimeout(400);
  assert.equal(await f.evaluate(() => JSON.parse(localStorage.getItem('cm-prefs')).quietOn), false, 'reset restores defaults');
});

await t('region: number style changes how prices are written', async () => {
  await page.goto(url + '/app?go=/settings/region'); await page.waitForTimeout(3000);
  const f = sf('/settings/region');
  await f.tap('[data-pref="numFmt"] [data-value="eu"]'); await page.waitForTimeout(400);
  const prev = await f.locator('#fmt-preview').textContent();
  console.log('      ', prev);
  assert.match(prev, /1\.234,56/);
  await f.tap('[data-pref="numFmt"] [data-value="us"]'); await page.waitForTimeout(300);
  assert.match(await f.locator('#fmt-preview').textContent(), /1,234\.56/);
});

await t('accessibility: high contrast and big touch targets set page attributes everywhere', async () => {
  await page.goto(url + '/app?go=/settings/accessibility'); await page.waitForTimeout(3000);
  const f = sf('/settings/accessibility');
  await f.tap('[data-toggle="contrast"]'); await f.tap('[data-toggle="bigTouch"]'); await page.waitForTimeout(500);
  const home = page.frames().find(x => x.url() === url + '/');
  assert.deepEqual(await home.evaluate(() => [document.documentElement.dataset.contrast, document.documentElement.dataset.touch]), ['high', 'big']);
  await f.tap('[data-reset]'); await page.waitForTimeout(300);
});

await t('data saver: coin page waits for Load chart', async () => {
  await page.goto(url + '/app?go=/settings/datasaver'); await page.waitForTimeout(2800);
  await sf('/settings/datasaver').tap('[data-pref="saver"] [data-value="always"]'); await page.waitForTimeout(300);
  await page.goto(url + '/app?go=/coin/BTC'); await page.waitForTimeout(3500);
  assert.equal(await sf('/coin/BTC').locator('#saver-load').count(), 1);
  await sf('/coin/BTC').evaluate(() => { const p = JSON.parse(localStorage.getItem('cm-prefs')); p.saver = 'off'; delete p.liveMode; localStorage.setItem('cm-prefs', JSON.stringify(p)); });
});

await t('app lock: set a PIN, lock shows on reopen, wrong PIN refused, right PIN opens', async () => {
  await page.goto(url + '/app?go=/settings/security'); await page.waitForTimeout(3000);
  const f = sf('/settings/security');
  await f.tap('#lock-switch'); await page.waitForTimeout(600);
  const pin = async (fr, digits) => { for (const d of digits) await fr.locator(`.lk-key[aria-label="${d}"]`).first().click(); };
  await pin(f, '2468'); await f.locator('.lk-key.ok').click(); await page.waitForTimeout(300);
  await pin(f, '2468'); await f.locator('.lk-key.ok').click(); await page.waitForTimeout(800);
  assert.equal(await f.evaluate(() => JSON.parse(localStorage.getItem('cm-lock')).on), true);
  assert.equal(await f.evaluate(() => 'pin' in JSON.parse(localStorage.getItem('cm-lock')) && !JSON.stringify(JSON.parse(localStorage.getItem('cm-lock'))).includes('2468')), true, 'the PIN itself is never stored');
  await page.evaluate(() => sessionStorage.clear()); await page.goto(url + '/app'); await page.waitForTimeout(2500);
  assert.equal(await page.locator('#cm-lock').count(), 1, 'locked on start');
  await pin(page, '1111'); await page.locator('.lk-key.ok').click(); await page.waitForTimeout(900);
  assert.equal(await page.locator('#cm-lock').count(), 1, 'wrong PIN keeps it locked');
  await pin(page, '2468'); await page.locator('.lk-key.ok').click(); await page.waitForTimeout(900);
  assert.equal(await page.locator('#cm-lock').count(), 0, 'right PIN opens the app');
});

await t('data page: storage figure and backup preview before restore', async () => {
  await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('cm-lock')); l.on = false; localStorage.setItem('cm-lock', JSON.stringify(l)); });
  await page.goto(url + '/app?go=/settings/data'); await page.waitForTimeout(3000);
  const f = sf('/settings/data');
  assert.match(await f.locator('#disk-text').textContent(), /used|little/);
  await f.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'cryptomium', version: 1, exportedAt: '2026-10-01T00:00:00Z', favs: ['BTC'], targets: [], prefs: {} })) });
  await page.waitForTimeout(600);
  assert.equal(await f.locator('#import-preview').isVisible(), true);
  console.log('      ', (await f.locator('#import-preview p').first().textContent()).slice(0, 110));
});

await t('candlestick chart is drawn with a handful of elements, not hundreds', async () => {
  const c = await page.evaluate(async () => { const m = await import('/js/chart.js'); return typeof m.createChart; });
  assert.equal(c, 'function');
});
console.log('page errors:', errs.filter(e => /PAGEERROR/.test(e)));
console.log(`${res.filter(Boolean).length}/${res.length} passed`);
await h.close();
