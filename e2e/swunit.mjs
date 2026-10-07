import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const src = fs.readFileSync('/home/claude/frontend/dist/sw.js', 'utf8');
function world({ windows = [] } = {}) {
  const handlers = {}; const shown = []; const opened = []; const msgs = [];
  const self = { location: { origin: 'https://cryptomium.example' }, addEventListener: (t, f) => (handlers[t] = f), skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async u => opened.push(u) }, registration: { showNotification: async (t, o) => shown.push({ t, o }), pushManager: {} } };
  vm.runInNewContext(src, { self, caches: { keys: async () => [], open: async () => ({ match: async () => null, addAll: async () => {}, put: async () => {}, delete: async () => {} }), match: async () => null, delete: async () => true }, fetch: async () => ({ ok: true }), URL, Response: class {}, Request: class {}, Promise, console, atob, Uint8Array, setTimeout, Date });
  const fire = async (type, ev) => { let p; await handlers[type]({ waitUntil: x => (p = x), ...ev }); await p; };
  return { fire, shown, opened, msgs };
}
const data = o => ({ data: { json: () => o, text: () => JSON.stringify(o) } });
// 1. background push shows a notification with actions and safe data
let w = world();
await w.fire('push', data({ kind: 'target', id: 'abc', ticker: 'BTC', title: 'BTC is above $90,000', body: 'Now $90,250.', tag: 'tgt-abc', url: '/coin/BTC' }));
assert.equal(w.shown.length, 1); const n = w.shown[0];
assert.equal(n.t, 'BTC is above $90,000'); assert.equal(n.o.data.url, '/coin/BTC'); assert.equal(n.o.actions.map(a => a.action).join(), 'open,manage');
assert.equal(n.o.badge, '/icons/badge-96.png'); assert.equal(n.o.tag, 'tgt-abc');
console.log('ok: background target push shows notification with 2 actions, tag, badge');
// 2. hostile / junk payloads are neutralised
for (const bad of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)', '/app', '/sw.js']) {
  w = world(); await w.fire('push', data({ kind: 'test', title: 'x', url: bad }));
  assert.equal(w.shown[0].o.data.url, '/', bad);
}
w = world(); await w.fire('push', { data: { json() { throw new Error('bad'); }, text: () => 'plain text' } });
assert.equal(w.shown[0].t, 'Cryptomium'); assert.equal(w.shown[0].o.body, 'plain text');
w = world(); await w.fire('push', { data: null }); assert.equal(w.shown.length, 1);
console.log('ok: evil/odd urls become "/", broken or empty payloads still show something');
// 3. app focused -> no system notification for alerts, but window is told; test notification still shows
const posted = []; const win = { focused: true, visibilityState: 'visible', url: 'https://cryptomium.example/app', postMessage: m => posted.push(m), focus: async () => {} };
w = world({ windows: [win] });
await w.fire('push', data({ kind: 'target', id: 'a', title: 't', url: '/coin/ETH' }));
assert.equal(w.shown.length, 0); assert.equal(posted[0].cm, 'push');
await w.fire('push', data({ kind: 'test', title: 'T' })); assert.equal(w.shown.length, 1);
console.log('ok: foreground = in-app message only; test notification always shows');
// 4. taps
const tap = async (windows, action, url = '/coin/BTC') => { const w = world({ windows }); await w.fire('notificationclick', { action, notification: { close() {}, data: { url } } }); return w; };
const shellPosts = []; const shell = { url: 'https://cryptomium.example/app?x', focus: async () => {}, postMessage: m => shellPosts.push(m) };
await tap([shell], '');                      assert.equal(JSON.stringify(shellPosts.pop()), JSON.stringify({ cm: 'open', url: '/coin/BTC' }));
await tap([shell], 'manage');                assert.equal(shellPosts.pop().url, '/settings/alerts');
await tap([shell], 'markets');               assert.equal(shellPosts.pop().url, '/markets');
let nav = null; const tab = { url: 'https://cryptomium.example/markets', focus: async () => {}, navigate: async u => (nav = u, {}) };
await tap([tab], '');                        assert.equal(nav, 'https://cryptomium.example/coin/BTC');
let cold = await tap([], '');                assert.equal(cold.opened.join(), '/coin/BTC');
cold = await tap([], '', 'https://evil.example/'); assert.equal(cold.opened.join(), '/');
console.log('ok: tap -> shell opens screen on top / browser tab navigates / cold start opens page; hostile url -> "/"');
