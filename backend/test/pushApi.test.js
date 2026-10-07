import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiHandler, createRateLimiter } from '../src/api.js';
import { generateVapidKeys, createWebPush, decryptPayload } from '../src/webpush.js';
import { createPushService, createMemoryPushStore } from '../src/push.js';

const COINS = [{ ticker: 'BTC', name: 'Bitcoin' }, { ticker: 'ETH', name: 'Ethereum' }];
const SITE = 'https://cryptomium.example';

function browser() {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  return {
    subscription: {
      endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomBytes(12).toString('hex')}`,
      keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
    },
    uaPrivate: ua.getPrivateKey().toString('base64url'),
  };
}

async function boot({ origins = [SITE], withPush = true, writeLimit = 1000, registerLimit = 1000 } = {}) {
  const pushed = [];
  const keys = generateVapidKeys();
  const push = withPush
    ? createPushService({
        store: createMemoryPushStore(),
        webpush: createWebPush({ ...keys, subject: 'mailto:ops@example.com', fetchImpl: async (url, init) => { pushed.push({ url, init }); return { status: 201 }; } }),
        coins: COINS,
        getSnapshot: async () => ({ stale: false, coins: COINS.map(c => ({ ticker: c.ticker, price: c.ticker === 'BTC' ? 95000 : 3000, change24h: 0 })) }),
        log: { log() {}, error() {}, warn() {} },
      })
    : null;
  const handler = createApiHandler({
    getSnapshot: async () => ({ coins: [], updatedAt: 'x', stale: false }),
    logosDir: '/nonexistent',
    allowedOrigins: origins,
    push,
    allowWrite: createRateLimiter({ limit: writeLimit }),
    allowRegister: createRateLimiter({ limit: registerLimit }),
  });
  const server = http.createServer((req, res) => handler(req, res).catch(() => { res.writeHead(500); res.end(); }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, { body, headers = {}, raw } = {}) => fetch(base + path, {
    method,
    headers: { Origin: SITE, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  return { call, pushed, keys, push, close: () => { handler.stop(); server.close(); } };
}

const bearer = r => ({ Authorization: `Bearer ${r.deviceId}.${r.token}` });

test('without VAPID keys the push routes report that notifications are unavailable', async () => {
  const s = await boot({ withPush: false });
  const r = await s.call('GET', '/api/push/key');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).enabled, false);
  assert.equal((await s.call('POST', '/api/push/devices', { body: {} })).status, 405);
  s.close();
});

test('the public key is served, and it is only the PUBLIC key', async () => {
  const s = await boot();
  const r = await s.call('GET', '/api/push/key');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.publicKey, s.keys.publicKey);
  assert.ok(!JSON.stringify(body).includes(s.keys.privateKey));
  s.close();
});

test('full flow: register, sync an alert, send a test, then delete', async () => {
  const s = await boot();
  const b = browser();
  let r = await s.call('POST', '/api/push/devices', { body: { subscription: b.subscription, prefs: { milestones: true, coins: ['BTC'] } } });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const reg = await r.json();
  assert.ok(reg.deviceId && reg.token);

  r = await s.call('PUT', '/api/push/devices/me', { headers: bearer(reg), body: { targets: [{ id: 'a1', ticker: 'BTC', dir: 'above', price: 100000, rev: 5 }] } });
  assert.equal(r.status, 200);
  const synced = await r.json();
  assert.equal(synced.targets, 1);
  assert.deepEqual(synced.prefs, { milestones: true, coins: ['BTC'] });

  r = await s.call('POST', '/api/push/devices/me/test', { headers: bearer(reg), body: {} });
  assert.equal(r.status, 200);
  assert.equal(s.pushed.length, 1);
  const msg = JSON.parse(decryptPayload({ message: s.pushed[0].init.body, uaPrivate: b.uaPrivate, uaPublic: b.subscription.keys.p256dh, auth: b.subscription.keys.auth }));
  assert.equal(msg.kind, 'test');

  r = await s.call('DELETE', '/api/push/devices/me', { headers: bearer(reg) });
  assert.equal(r.status, 204);
  r = await s.call('PUT', '/api/push/devices/me', { headers: bearer(reg), body: { targets: [] } });
  assert.equal(r.status, 401, 'the token stops working once the device is deleted');
  s.close();
});

test('every device route needs the device secret', async () => {
  const s = await boot();
  const reg = await (await s.call('POST', '/api/push/devices', { body: { subscription: browser().subscription } })).json();
  const attempts = [
    ['PUT', '/api/push/devices/me', { body: { targets: [] } }],
    ['DELETE', '/api/push/devices/me', {}],
    ['POST', '/api/push/devices/me/test', { body: {} }],
    ['PUT', '/api/push/devices/me', { body: { targets: [] }, headers: { Authorization: `Bearer ${reg.deviceId}.${'A'.repeat(43)}` } }],
    ['PUT', '/api/push/devices/me', { body: { targets: [] }, headers: { Authorization: 'Bearer garbage' } }],
  ];
  for (const [m, p, o] of attempts) {
    const r = await s.call(m, p, o);
    assert.equal(r.status, 401, `${m} ${p}`);
    assert.equal(r.headers.get('www-authenticate'), 'Bearer');
  }
  s.close();
});

test("one device's secret cannot touch another device", async () => {
  const s = await boot();
  const a = await (await s.call('POST', '/api/push/devices', { body: { subscription: browser().subscription, targets: [{ id: 'x', ticker: 'BTC', dir: 'above', price: 1e6, rev: 1 }] } })).json();
  const b = await (await s.call('POST', '/api/push/devices', { body: { subscription: browser().subscription } })).json();
  const mixed = { Authorization: `Bearer ${a.deviceId}.${b.token}` };
  assert.equal((await s.call('DELETE', '/api/push/devices/me', { headers: mixed })).status, 401);
  assert.equal((await s.call('PUT', '/api/push/devices/me', { headers: bearer(a), body: {} })).status, 200);
  s.close();
});

test('requests must be JSON, small and well formed', async () => {
  const s = await boot();
  const sub = browser().subscription;
  assert.equal((await s.call('POST', '/api/push/devices', { raw: JSON.stringify({ subscription: sub }), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await s.call('POST', '/api/push/devices', { raw: JSON.stringify({ subscription: sub }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await s.call('POST', '/api/push/devices', { raw: '{not json', headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await s.call('POST', '/api/push/devices', { raw: '[1,2]', headers: { 'Content-Type': 'application/json' } })).status, 400);
  const big = JSON.stringify({ subscription: sub, pad: 'x'.repeat(40_000) });
  assert.equal((await s.call('POST', '/api/push/devices', { raw: big, headers: { 'Content-Type': 'application/json' } })).status, 413);
  s.close();
});

test('invalid subscriptions, alerts and preferences get a clear 400', async () => {
  const s = await boot();
  const sub = browser().subscription;
  const cases = [
    { subscription: { ...sub, endpoint: 'https://169.254.169.254/latest/meta-data/aaaa' } },
    { subscription: { ...sub, endpoint: 'https://internal.example.com/push/aaaaaaaaaaaaa' } },
    { subscription: sub, targets: [{ id: 'a', ticker: 'XXX', dir: 'above', price: 1, rev: 1 }] },
    { subscription: sub, targets: [{ id: 'a', ticker: 'BTC', dir: 'above', price: -5, rev: 1 }] },
    { subscription: sub, prefs: { milestones: true, coins: ['XXX'] } },
    {},
  ];
  for (const body of cases) assert.equal((await s.call('POST', '/api/push/devices', { body })).status, 400, JSON.stringify(body).slice(0, 80));
  s.close();
});

test('writes from another website are refused when the site address is configured', async () => {
  const s = await boot({ origins: [SITE] });
  const sub = browser().subscription;
  assert.equal((await s.call('POST', '/api/push/devices', { body: { subscription: sub }, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.call('POST', '/api/push/devices', { body: { subscription: sub }, headers: { Origin: '' } })).status, 403, 'a script without an Origin');
  assert.equal((await s.call('POST', '/api/push/devices', { body: { subscription: sub } })).status, 201);
  s.close();
});

test('CORS allows the Authorization header and write methods only when push is on', async () => {
  const on = await boot();
  const pre = await on.call('OPTIONS', '/api/push/devices/me', { headers: { 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
  on.close();
  const off = await boot({ withPush: false });
  const pre2 = await off.call('OPTIONS', '/api/prices');
  assert.equal(pre2.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  off.close();
});

test('push writes are rate limited, and registering is limited harder', async () => {
  const s = await boot({ writeLimit: 5, registerLimit: 2 });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await s.call('POST', '/api/push/devices', { body: { subscription: browser().subscription } })).status);
  assert.deepEqual(codes, [201, 201, 429, 429]);
  s.close();
});

test('there is no way to send a notification to someone else', async () => {
  const s = await boot();
  for (const path of ['/api/push/send', '/api/push/notify', '/api/push/broadcast', '/api/push/devices/send', '/api/push/devices/other/test']) {
    for (const method of ['GET', 'POST', 'PUT']) {
      const r = await s.call(method, path, method === 'GET' ? {} : { body: { title: 'scam' } });
      assert.ok([404, 405].includes(r.status), `${method} ${path} -> ${r.status}`);
    }
  }
  assert.equal(s.pushed.length, 0);
  s.close();
});

test('the existing read-only API is unchanged: other writes are still refused', async () => {
  const s = await boot();
  assert.equal((await s.call('POST', '/api/prices', { body: {} })).status, 405);
  assert.equal((await s.call('DELETE', '/api/alerts')).status, 405);
  assert.equal((await s.call('GET', '/health')).status, 200);
  assert.equal((await s.call('GET', '/api/prices')).status, 200);
  s.close();
});
