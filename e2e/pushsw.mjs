import { open } from './harness.mjs';
const h = await open({ standalone: false }); const { page, ctx, url, errs } = h;
await ctx.grantPermissions(['notifications'], { origin: url });
await page.goto(url + '/markets'); await page.waitForTimeout(3000);
const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope }; });
const cdp = await ctx.newCDPSession(page);
const regs = []; cdp.on('ServiceWorker.workerRegistrationUpdated', e => regs.push(...e.registrations));
await cdp.send('ServiceWorker.enable'); await page.waitForTimeout(500);
const id = regs[0]?.registrationId;
// page hidden/unfocused case: open a second tab so the first is not focused+visible
const p2 = await ctx.newPage(); await p2.goto('about:blank'); await p2.bringToFront();
const msg = JSON.stringify({ kind: 'test', id: 'abc', ticker: 'BTC', title: 'BTC is above $90,000', body: 'Now $90,250. Tap to open the chart.', tag: 'tgt-abc', url: '/coin/BTC' });
await cdp.send('ServiceWorker.deliverPushMessage', { origin: url, registrationId: id, data: msg });
await page.waitForTimeout(1200);
const notes = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag, url: n.data.url, actions: n.actions.map(a => a.action), badge: n.badge.split('/').pop() })));
console.log('notifications:', JSON.stringify(notes));
// evil url is neutralised
await cdp.send('ServiceWorker.deliverPushMessage', { origin: url, registrationId: id, data: JSON.stringify({ kind: 'test', title: 'x', url: 'https://evil.example/phish', tag: 'e' }) });
await page.waitForTimeout(800);
console.log('evil url ->', (await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => n.data.url))).join(','));
console.log('errors', errs);
await h.close();
