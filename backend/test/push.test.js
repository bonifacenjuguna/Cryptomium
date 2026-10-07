import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateVapidKeys, createWebPush, decryptPayload } from '../src/webpush.js';
import {
  createPushService, createMemoryPushStore, validateTargets, validateSubscription, validatePrefs, PushError, MAX_TARGETS,
} from '../src/push.js';

const COINS = [
  { ticker: 'BTC', name: 'Bitcoin' },
  { ticker: 'ETH', name: 'Ethereum' },
  { ticker: 'USDT', name: 'Tether', stable: true },
];
const TICKERS = new Set(COINS.map(c => c.ticker));

function browser(n = 1) {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  return {
    subscription: {
      endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}-${crypto.randomBytes(6).toString('hex')}`,
      keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
    },
    uaPrivate: ua.getPrivateKey().toString('base64url'),
    read(message) {
      return JSON.parse(decryptPayload({ message, uaPrivate: this.uaPrivate, uaPublic: this.subscription.keys.p256dh, auth: this.subscription.keys.auth }));
    },
  };
}

function setup({ prices = { BTC: 80000, ETH: 3000, USDT: 1 }, changes = {}, market = null, stale = false } = {}) {
  const state = { prices: { ...prices }, changes: { ...changes }, market, stale, status: 201, calls: [], snapFails: false, clock: 1_800_000_000_000 };
  const webpush = createWebPush({
    ...generateVapidKeys(), subject: 'mailto:ops@example.com',
    fetchImpl: async (url, init) => {
      state.calls.push({ url, init });
      const status = typeof state.status === 'function' ? state.status(url) : state.status;
      return { status };
    },
  });
  const store = createMemoryPushStore();
  const service = createPushService({
    store, webpush, coins: COINS,
    getSnapshot: async () => {
      if (state.snapFails) throw new Error('no prices');
      return { stale: state.stale, coins: COINS.map(c => ({ ticker: c.ticker, stable: Boolean(c.stable), price: state.prices[c.ticker] ?? null, change24h: state.changes[c.ticker] ?? null })) };
    },
    getMarket: async () => state.market,
    now: () => state.clock,
    sleep: async () => {},
    log: { log() {}, error() {}, warn() {} },
  });
  return { state, store, service };
}

const target = (over = {}) => ({ id: 't1', ticker: 'BTC', dir: 'above', price: 90000, rev: 1, ...over });

// ---------------------------------------------------------------- registration and authentication

test('register stores a device and hands back a secret that authenticates later calls', async () => {
  const { service, store } = setup();
  const b = browser();
  const r = await service.register({ subscription: b.subscription, targets: [target()] });
  assert.equal(r.targets, 1);
  assert.match(r.token, /^[A-Za-z0-9_-]{43}$/);
  const stored = await store.getDevice(r.deviceId);
  assert.notEqual(stored.tokenHash, r.token, 'only a hash of the token is stored');
  assert.equal(stored.tokenHash.length, 64);
  const device = await service.authenticate(`Bearer ${r.deviceId}.${r.token}`);
  assert.equal(device.id, r.deviceId);
});

test('authentication rejects wrong, malformed and unknown credentials', async () => {
  const { service } = setup();
  const r = await service.register({ subscription: browser().subscription });
  const bad = [
    `Bearer ${r.deviceId}.${'A'.repeat(43)}`,
    `Bearer ${'B'.repeat(22)}.${r.token}`,
    `Bearer ${r.deviceId}`,
    `Basic ${r.deviceId}.${r.token}`,
    '', undefined, null,
  ];
  for (const h of bad) await assert.rejects(() => service.authenticate(h), e => e instanceof PushError && e.status === 401, String(h));
});

test('registering the same subscription again replaces the old record (a reinstall loses its token)', async () => {
  const { service, store } = setup();
  const b = browser();
  const first = await service.register({ subscription: b.subscription, targets: [target()] });
  const second = await service.register({ subscription: b.subscription });
  assert.notEqual(first.deviceId, second.deviceId);
  assert.equal(await store.count(), 1);
  await assert.rejects(() => service.authenticate(`Bearer ${first.deviceId}.${first.token}`), /Not signed in/);
});

test('several devices can be registered side by side', async () => {
  const { service, store } = setup();
  await service.register({ subscription: browser(1).subscription });
  await service.register({ subscription: browser(2).subscription });
  assert.equal(await store.count(), 2);
});

test('the device limit is enforced', async () => {
  const s = setup();
  const limited = createPushService({ store: s.store, webpush: createWebPush({ ...generateVapidKeys(), subject: 'mailto:a@b.co' }), coins: COINS, getSnapshot: async () => ({}), maxDevices: 1 });
  await limited.register({ subscription: browser(1).subscription });
  await assert.rejects(() => limited.register({ subscription: browser(2).subscription }), e => e.status === 503);
});

// ---------------------------------------------------------------- input validation

test('subscriptions from outside the push services are refused', () => {
  const b = browser().subscription;
  assert.throws(() => validateSubscription({ ...b, endpoint: 'https://169.254.169.254/latest/aaaaaaaaaaaa' }), PushError);
  assert.throws(() => validateSubscription({ ...b, endpoint: 'http://fcm.googleapis.com/fcm/send/aaaaaaaaaaaaaaa' }), PushError);
  assert.throws(() => validateSubscription({ ...b, keys: { ...b.keys, auth: 'short' } }), PushError);
  assert.throws(() => validateSubscription({ ...b, keys: { ...b.keys, p256dh: 'A'.repeat(87) } }), PushError);
  assert.throws(() => validateSubscription(null), PushError);
  assert.ok(validateSubscription(b));
});

test('alerts are validated: coin, type, price range, ids, duplicates and count', () => {
  const ok = validateTargets([target(), target({ id: 'm', dir: 'move', price: 5 }), target({ id: 'a', dir: 'ath', price: 123 })], TICKERS);
  assert.equal(ok.length, 3);
  assert.equal(ok[2].price, 0, 'ath/atl carry no price');
  const bad = [
    target({ ticker: 'DOGE9' }), target({ dir: 'sideways' }), target({ price: -1 }), target({ price: 'abc' }), target({ price: Infinity }),
    target({ dir: 'move', price: 0.1 }), target({ dir: 'move', price: 500 }), target({ id: 'has space' }), target({ id: '' }), target({ id: 'x'.repeat(41) }),
  ];
  for (const t of bad) assert.throws(() => validateTargets([t], TICKERS), PushError, JSON.stringify(t));
  assert.throws(() => validateTargets([target(), target()], TICKERS), PushError, 'duplicate id');
  assert.throws(() => validateTargets(Array.from({ length: MAX_TARGETS + 1 }, (_, i) => target({ id: `i${i}` })), TICKERS), PushError);
  assert.throws(() => validateTargets('nope', TICKERS), PushError);
  assert.equal(validateTargets([target({ ticker: 'btc' })], TICKERS)[0].ticker, 'BTC');
});

test('preferences are validated', () => {
  assert.deepEqual(validatePrefs({ milestones: true, coins: ['btc', 'ETH', 'BTC'] }, TICKERS), { milestones: true, coins: ['BTC', 'ETH'] });
  assert.deepEqual(validatePrefs({ milestones: 'yes' }, TICKERS), { milestones: false, coins: [] });
  assert.throws(() => validatePrefs({ milestones: true, coins: ['NOPE'] }, TICKERS), PushError);
  assert.throws(() => validatePrefs(null, TICKERS), PushError);
});

// ---------------------------------------------------------------- the alert loop

test('a reached alert sends one encrypted, correct notification and is never repeated', async () => {
  const { service, state } = setup();
  const b = browser();
  await service.register({ subscription: b.subscription, targets: [target()] });

  let r = await service.tick();
  assert.deepEqual([r.armed, r.sent], [1, 0], 'price is still below the target');
  assert.equal(state.calls.length, 0);

  state.prices.BTC = 90_250;
  r = await service.tick();
  assert.equal(r.sent, 1);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].url, b.subscription.endpoint);
  assert.equal(state.calls[0].init.headers.Urgency, 'high');
  const note = b.read(state.calls[0].init.body);
  assert.equal(note.title, 'BTC is above $90,000');
  assert.equal(note.body, 'Now $90,250. Tap to open the chart.');
  assert.equal(note.url, '/coin/BTC');
  assert.equal(note.kind, 'target');
  assert.equal(note.id, 't1');
  assert.equal(note.tag, 'tgt-t1');

  r = await service.tick();
  assert.deepEqual([r.armed, r.sent], [0, 0], 'a fired alert is not armed any more');
  assert.equal(state.calls.length, 1);
});

test('below, 24h move, all-time high and all-time low alerts all work', async () => {
  const { service, state } = setup({ prices: { BTC: 80000, ETH: 3000, USDT: 1 }, changes: { ETH: -7.4 }, market: { BTC: { ath: 79000, atl: 100 }, ETH: { ath: 9999, atl: 3100 } } });
  const b = browser();
  await service.register({
    subscription: b.subscription,
    targets: [
      target({ id: 'below', ticker: 'USDT', dir: 'below', price: 1.002 }),
      target({ id: 'move', ticker: 'ETH', dir: 'move', price: 5 }),
      target({ id: 'ath', ticker: 'BTC', dir: 'ath' }),
      target({ id: 'atl', ticker: 'ETH', dir: 'atl' }),
      target({ id: 'quiet', ticker: 'BTC', dir: 'atl' }),
    ],
  });
  const r = await service.tick();
  assert.equal(r.sent, 4);
  const titles = state.calls.map(c => b.read(c.init.body).title).sort();
  assert.deepEqual(titles, ['BTC hit a new all-time high', 'ETH hit a new all-time low', 'ETH moved -7.4% in 24h', 'USDT is below $1.002']);
});

test('alerts are never judged by stale prices, missing prices or an unreachable price feed', async () => {
  const { service, state } = setup({ prices: { BTC: 99999 } });
  await service.register({ subscription: browser().subscription, targets: [target()] });
  state.stale = true;
  assert.equal((await service.tick()).stale, true);
  state.stale = false; state.snapFails = true;
  assert.equal((await service.tick()).noPrices, true);
  state.snapFails = false; state.prices.BTC = null;
  assert.equal((await service.tick()).sent, 0);
  assert.equal(state.calls.length, 0);
  state.prices.BTC = 99999;
  assert.equal((await service.tick()).sent, 1, 'it still fires once good prices are back');
});

test('two devices with the same alert both get their own notification', async () => {
  const { service, state } = setup({ prices: { BTC: 95000 } });
  const a = browser(1), b = browser(2);
  await service.register({ subscription: a.subscription, targets: [target()] });
  await service.register({ subscription: b.subscription, targets: [target()] });
  assert.equal((await service.tick()).sent, 2);
  assert.deepEqual(state.calls.map(c => c.url).sort(), [a.subscription.endpoint, b.subscription.endpoint].sort());
});

test('a dead subscription (410) removes the device and its alerts', async () => {
  const { service, state, store } = setup({ prices: { BTC: 95000 } });
  const r0 = await service.register({ subscription: browser().subscription, targets: [target()] });
  state.status = 410;
  const r = await service.tick();
  assert.equal(r.removed, 1);
  assert.equal(await store.getDevice(r0.deviceId), null);
  assert.equal((await service.tick()).armed, 0);
});

test('a push service outage keeps the alert armed, retries, and eventually delivers', async () => {
  const { service, state } = setup({ prices: { BTC: 95000 } });
  const b = browser();
  await service.register({ subscription: b.subscription, targets: [target()] });
  state.status = 503;
  let r = await service.tick();
  assert.deepEqual([r.sent, r.retried], [0, 1]);
  assert.equal(state.calls.length, 3, 'one try plus two quick retries');
  assert.equal((await service.tick()).armed, 1, 'still armed for the next pass');
  state.status = 201;
  r = await service.tick();
  assert.equal(r.sent, 1);
  assert.equal((await service.tick()).armed, 0);
});

test('an alert that keeps failing is given up after a few passes instead of looping forever', async () => {
  const { service, state } = setup({ prices: { BTC: 95000 } });
  await service.register({ subscription: browser().subscription, targets: [target()] });
  state.status = 500;
  for (let i = 0; i < 5; i++) await service.tick();
  assert.equal((await service.tick()).armed, 0);
});

test('a device that fails over and over is dropped by cleanup', async () => {
  const { service, state, store } = setup({ prices: { BTC: 95000 } });
  const r0 = await service.register({ subscription: browser().subscription, targets: [target({ id: 'a' }), target({ id: 'b' }), target({ id: 'c' })] });
  state.status = 500;
  for (let i = 0; i < 8; i++) await service.tick();
  assert.ok((await store.getDevice(r0.deviceId)).failures >= 20);
  assert.equal(await service.prune(), 1);
  assert.equal(await store.getDevice(r0.deviceId), null);
});

test('only one pass runs at a time', async () => {
  const { service } = setup();
  await service.register({ subscription: browser().subscription, targets: [target()] });
  const [a, b] = await Promise.all([service.tick(), service.tick()]);
  assert.equal([a, b].filter(x => x.skipped).length, 1);
});

// ---------------------------------------------------------------- sync

test('sync replaces the alert list; removing an alert on the phone removes it on the server', async () => {
  const { service, store } = setup();
  const r = await service.register({ subscription: browser().subscription, targets: [target({ id: 'a' }), target({ id: 'b' })] });
  const device = await service.authenticate(`Bearer ${r.deviceId}.${r.token}`);
  const out = await service.sync(device, { targets: [target({ id: 'b' })] });
  assert.equal(out.targets, 1);
  assert.equal(await store.countTargets(r.deviceId), 1);
});

test('the phone learns which alerts fired while it was closed, and re-arming works', async () => {
  const { service, state } = setup({ prices: { BTC: 95000 } });
  const r = await service.register({ subscription: browser().subscription, targets: [target()] });
  await service.tick();
  const device = await service.authenticate(`Bearer ${r.deviceId}.${r.token}`);

  let out = await service.sync(device, { targets: [target()] }); // the phone still thinks it is armed
  assert.equal(out.fired.length, 1);
  assert.equal(out.fired[0].id, 't1');
  assert.equal(out.fired[0].price, 95000);

  out = await service.sync(device, { targets: [target({ rev: 2 })] }); // the user re-armed it (newer rev)
  assert.deepEqual(out.fired, []);
  state.prices.BTC = 80000;
  assert.equal((await service.tick()).armed, 1, 'armed again');
  state.prices.BTC = 91000;
  assert.equal((await service.tick()).sent, 1);
});

test('sync can move a device to a new subscription (the browser rotated it) without losing its alerts', async () => {
  const { service, store } = setup();
  const r = await service.register({ subscription: browser(1).subscription, targets: [target()] });
  const device = await service.authenticate(`Bearer ${r.deviceId}.${r.token}`);
  const fresh = browser(2);
  await service.sync(device, { subscription: fresh.subscription });
  const after = await store.getDevice(r.deviceId);
  assert.equal(after.endpoint, fresh.subscription.endpoint);
  assert.equal(await store.countTargets(r.deviceId), 1);
});

test('remove forgets the device and its alerts', async () => {
  const { service, store } = setup();
  const r = await service.register({ subscription: browser().subscription, targets: [target()] });
  await service.remove(await service.authenticate(`Bearer ${r.deviceId}.${r.token}`));
  assert.equal(await store.count(), 0);
  assert.equal((await service.tick()).armed, 0);
});

// ---------------------------------------------------------------- milestones from the Telegram channel

test('milestones go only to devices that opted in, for the coins they chose', async () => {
  const { service, state } = setup();
  const all = browser(1), btcOnly = browser(2), off = browser(3), ethOnly = browser(4);
  await service.register({ subscription: all.subscription, prefs: { milestones: true, coins: [] } });
  await service.register({ subscription: btcOnly.subscription, prefs: { milestones: true, coins: ['BTC'] } });
  await service.register({ subscription: off.subscription });
  await service.register({ subscription: ethOnly.subscription, prefs: { milestones: true, coins: ['ETH'] } });

  const r = await service.notifyMilestone({ ticker: 'BTC', price: 90000, direction: 'up' });
  assert.equal(r.sent, 2);
  assert.deepEqual(state.calls.map(c => c.url).sort(), [all.subscription.endpoint, btcOnly.subscription.endpoint].sort());
  const note = all.read(state.calls.find(c => c.url === all.subscription.endpoint).init.body);
  assert.equal(note.title, '\u25B2 BTC reached $90,000');
  assert.equal(note.kind, 'milestone');
  assert.equal(note.url, '/coin/BTC');
  assert.equal(state.calls[0].init.headers.Urgency, 'normal');

  assert.deepEqual(await service.notifyMilestone({ ticker: 'NOPE', price: 1, direction: 'up' }), { sent: 0 });
});

// ---------------------------------------------------------------- test notification

test('the test notification reaches only the caller and is rate limited', async () => {
  const { service, state } = setup();
  const b = browser();
  const r = await service.register({ subscription: b.subscription });
  const device = await service.authenticate(`Bearer ${r.deviceId}.${r.token}`);
  assert.deepEqual(await service.test(device), { sent: true });
  assert.equal(b.read(state.calls[0].init.body).kind, 'test');
  await assert.rejects(() => service.test(device), e => e.status === 429);
  state.clock += 21_000;
  assert.deepEqual(await service.test(device), { sent: true });
  state.clock += 21_000;
  state.status = 410;
  await assert.rejects(() => service.test(device), e => e.status === 410);
});
