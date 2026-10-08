import { open } from './harness.mjs';
const h = await open({ standalone: true }); const { page, url } = h;
await page.addInitScript(() => localStorage.setItem('cm-prefs', JSON.stringify({ theme: 'dark' })));
for (const [p, n] of [['/settings', 'n_hub'], ['/settings/notifications', 'n_notif'], ['/settings/security', 'n_sec']]) {
  await page.goto(url + '/app?go=' + p); await page.waitForTimeout(3200); await page.screenshot({ path: `/home/claude/e2e/${n}.png` });
}
await h.close();
