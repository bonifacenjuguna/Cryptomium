import assert from 'node:assert/strict';
import { open } from './harness.mjs';
const ok = m => console.log('ok:', m);

// ---------- 1. comparison in candles, every range, plus the screen underneath being hidden
{
  const h = await open({ standalone: true }); const { page, url, errs } = h;
  await page.addInitScript(() => localStorage.setItem('cm-prefs', JSON.stringify({ chartType: 'candles', liveMode: 'saver' })));
  await page.goto(url + '/app?source=app'); await page.waitForTimeout(2500);
  const shellFrame = () => page.frames().find(f => f.url().endsWith('/coin/BTC'));
  await page.frames().find(f => f.url() === url + '/').evaluate(() => parent.postMessage({ cm: 'push', url: '/coin/BTC' }, location.origin));
  await page.waitForTimeout(3500);
  const f = shellFrame();
  // under screen hidden after the slide
  const under = await page.evaluate(() => { const fr = [...document.querySelectorAll('iframe.tab-frame')].find(x => x.classList.contains('under')); const cs = fr && getComputedStyle(fr); return fr ? { vis: cs.visibility, filter: cs.filter } : null; });
  assert.ok(under, 'there is an under screen'); assert.equal(under.vis, 'hidden'); assert.equal(under.filter, 'none');
  ok('screen under a coin page is hidden and unfiltered');
  // legacy liveMode:'saver' no longer pauses charts
  assert.ok(await f.evaluate(() => !!document.querySelector('#chart svg')), 'chart drawn although old liveMode=saver is stored');
  ok('old live-updates choice does not switch Data saver on');
  // pick a comparison
  await f.evaluate(() => document.getElementById('cmp-btn').click()); await page.waitForTimeout(400);
  await f.evaluate(() => [...document.querySelectorAll('.sheet-item:not(:disabled)')].find(b => /ETH/.test(b.textContent)).click()); await page.waitForTimeout(1500);
  for (const r of ['24h', '7d', '30d', '90d', '1y']) {
    await f.evaluate(r => document.querySelector(`#ranges [data-range="${r}"]`).click(), r); await page.waitForTimeout(900);
    const info = await f.evaluate(() => { const s = document.querySelector('#chart svg'); return { n: s ? s.querySelectorAll('*').length : -1, candle: s ? s.querySelectorAll('path.candle').length : 0, cmp: document.getElementById('chart-card').classList.contains('is-compare'), legend: document.getElementById('c-legend').textContent.replace(/\s+/g, ' ').slice(0, 80), pressed: document.querySelector('#chart-type [aria-pressed="true"]')?.dataset.type }; });
    assert.ok(info.cmp, `${r}: comparison active`); assert.ok(info.candle >= 2, `${r}: candles drawn for both coins ` + JSON.stringify(info)); assert.ok(info.n < 90, `${r}: small svg ${info.n}`);
    assert.equal(info.pressed, 'candles');
    if (r === '7d') { await page.screenshot({ path: '/tmp/cmp-candles-7d.png' }); console.log('  legend:', info.legend); }
  }
  ok('candle comparison draws on 24H, 7D, 30D, 90D, 1Y with a small svg');
  // selection works in candle comparison
  await page.mouse.click(150, 400); await page.waitForTimeout(300);
  const sel = await f.evaluate(() => document.getElementById('c-legend').classList.contains('is-sel'));
  assert.ok(sel, 'tapping selects a moment'); ok('crosshair works on candle comparison');
  // switching to line keeps the comparison
  await f.evaluate(() => document.querySelector('#chart-type [data-type="line"]').click()); await page.waitForTimeout(1200);
  assert.ok(await f.evaluate(() => document.getElementById('chart-card').classList.contains('is-compare')), 'comparison kept when switching to line');
  assert.ok(await f.evaluate(() => !!document.querySelector('#chart svg path.line')), 'two lines'); ok('comparison survives switching chart style');
  console.log('errors', errs); assert.deepEqual(errs, []);
  await h.close();
}

// ---------- 2. back retraces the way you came
{
  const h = await open({ standalone: true }); const { page, url } = h;
  await page.goto(url + '/app?source=app'); await page.waitForTimeout(2500);
  const tab = () => page.evaluate(() => document.documentElement.dataset.tab);
  const go = async t => { await page.evaluate(t => document.querySelector(`.app-tabbar a[data-tab="${t}"]`).click(), t); await page.waitForTimeout(300); };
  // a first real tap so the extra guard is armed, like a person would
  await page.touchscreen.tap(180, 300); await page.waitForTimeout(300);
  for (const t of ['markets', 'news', 'markets', 'portfolio']) await go(t);
  const seen = [];
  for (let i = 0; i < 2; i++) { await page.evaluate(() => history.back()); await page.waitForTimeout(700); seen.push(await tab()); }
  console.log('  Home, Overview, News, Overview, Portfolio, Back x2 ->', seen.join(' -> '));
  assert.deepEqual(seen, ['markets', 'home']); ok('back: Overview then Home, the News detour is gone');
  // Home tapped from elsewhere cuts the trail: back goes nowhere inside the app
  await go('news'); await go('home');
  await page.evaluate(() => history.back()); await page.waitForTimeout(700);
  assert.notEqual(await page.evaluate(() => document.documentElement.dataset.tab).catch(() => 'left'), 'news', 'Home then Back does not loop to News');
  ok('Home is the last place before the app closes'); await h.close();
}

// ---------- 3. no dead space, notification switch, taglines
{
  const h = await open({ standalone: false, width: 360, height: 800 }); const { page, url } = h;
  await page.goto(url + '/settings/notifications'); await page.waitForTimeout(2000);
  const lede = await page.evaluate(() => document.querySelectorAll('.s-head .lede, .s-label span:not([id])').length);
  assert.equal(lede, 0, 'no taglines or grey explanations in settings'); ok('settings: no taglines');
  const before = await page.evaluate(() => document.getElementById('notif-switch').getAttribute('aria-checked'));
  await page.evaluate(() => document.getElementById('notif-switch').click()); await page.waitForTimeout(3500);
  const note = await page.evaluate(() => document.getElementById('notif-switch-s').textContent.trim());
  console.log('  switch before:', before, ' note after tap:', JSON.stringify(note));
  assert.ok(note.length > 0, 'the status line is never left empty after a tap');
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => document.getElementById('notif-switch-s').textContent.trim()), note, 'the reason stays on screen'); ok('notifications: reason stays visible');
  await h.close();
}
console.log('ALL OK');
