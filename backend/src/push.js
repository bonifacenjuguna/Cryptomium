// Web Push for the Cryptomium app: devices, their price alerts, and the loop that sends them.
//
//   Price alert -> this backend (checks every device's alerts against the live prices) -> push service
//   (Google / Mozilla / Apple) -> the phone's service worker -> tap -> the coin page in the app.
//
// Design rules
//   * No accounts. A device registers its push subscription and receives a random secret token; every later
//     call must present it. Only a SHA-256 hash of the token is stored.
//   * Nothing here can send to an arbitrary address: notifications go only to subscriptions that registered
//     themselves (endpoint on a known push service, keys checked), and only because a price condition they set
//     was met, or the owner's channel posted a milestone they opted into. There is no "send" endpoint.
//   * Every outside dependency (store, sender, prices, clock) is passed in, so the whole flow is unit-tested
//     without Postgres or a network.
import crypto from 'node:crypto';
import { checkEndpoint, fromB64u, isValidPublicKey } from './webpush.js';
import { formatPrice } from './priceFormat.js';

export const DIRS = ['above', 'below', 'move', 'ath', 'atl'];
export const MAX_TARGETS = 50;
export const MAX_MILESTONE_COINS = 40;
const BAD_DEVICE_FAILURES = 20;   // devices that failed this many sends in a row are dropped
const MAX_FIRE_ATTEMPTS = 5;      // tries for one alert before it is given up
const TEST_GAP_MS = 20_000;

export class PushError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha256 = text => crypto.createHash('sha256').update(text).digest();
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// ---------------------------------------------------------------- validation (everything from the network is untrusted)

export function validateSubscription(sub, extraHosts = []) {
  if (!sub || typeof sub !== 'object') throw new PushError(400, 'Missing subscription.');
  const url = checkEndpoint(sub.endpoint, extraHosts);
  if (!url) throw new PushError(400, 'This push service is not supported.');
  const keys = sub.keys && typeof sub.keys === 'object' ? sub.keys : {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
  const auth = typeof keys.auth === 'string' ? keys.auth : '';
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !isValidPublicKey(fromB64u(p256dh))) throw new PushError(400, 'Invalid subscription key.');
  if (!/^[A-Za-z0-9_-]{20,24}$/.test(auth) || fromB64u(auth).length !== 16) throw new PushError(400, 'Invalid subscription secret.');
  return { endpoint: url.href, p256dh, auth };
}

export function validateTargets(list, tickerSet) {
  if (!Array.isArray(list)) throw new PushError(400, 'targets must be a list.');
  if (list.length > MAX_TARGETS) throw new PushError(400, `At most ${MAX_TARGETS} alerts per device.`);
  const seen = new Set();
  return list.map(t => {
    if (!t || typeof t !== 'object') throw new PushError(400, 'Invalid alert.');
    const id = typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t.id) ? t.id : null;
    const ticker = typeof t.ticker === 'string' ? t.ticker.toUpperCase() : '';
    if (!id || seen.has(id)) throw new PushError(400, 'Invalid alert id.');
    if (!tickerSet.has(ticker)) throw new PushError(400, 'Unknown coin in an alert.');
    if (!DIRS.includes(t.dir)) throw new PushError(400, 'Invalid alert type.');
    seen.add(id);
    let price = Number(t.price);
    if (t.dir === 'ath' || t.dir === 'atl') price = 0;
    else if (t.dir === 'move') { if (!(price >= 0.5 && price <= 100)) throw new PushError(400, 'A 24h move must be 0.5 to 100 percent.'); }
    else if (!(Number.isFinite(price) && price > 0 && price < 1e12)) throw new PushError(400, 'Invalid alert price.');
    const rev = Number.isSafeInteger(t.rev) && t.rev >= 0 ? t.rev : 0;
    return { id, ticker, dir: t.dir, price, rev };
  });
}

export function validatePrefs(prefs, tickerSet) {
  if (!prefs || typeof prefs !== 'object') throw new PushError(400, 'Invalid preferences.');
  const coins = Array.isArray(prefs.coins) ? prefs.coins : [];
  if (coins.length > MAX_MILESTONE_COINS) throw new PushError(400, 'Too many coins selected.');
  const clean = [...new Set(coins.map(c => String(c).toUpperCase()))];
  if (clean.some(c => !tickerSet.has(c))) throw new PushError(400, 'Unknown coin selected.');
  return { milestones: prefs.milestones === true, coins: clean };
}

// ---------------------------------------------------------------- stores

/** In-memory store with the same behaviour as the Postgres one. Used by the tests. */
export function createMemoryPushStore() {
  const devices = new Map();   // id -> device
  const targets = new Map();   // `${deviceId}|${targetId}` -> target
  const key = (d, t) => `${d}|${t}`;
  const dropTargets = id => { for (const k of [...targets.keys()]) if (k.startsWith(id + '|')) targets.delete(k); };
  return {
    async init() {},
    async count() { return devices.size; },
    async findByEndpoint(endpoint) { return [...devices.values()].find(d => d.endpoint === endpoint) ?? null; },
    async insertDevice(d) { devices.set(d.id, { ...d, failures: 0, lastSeen: d.now, createdAt: d.now }); },
    async getDevice(id) { const d = devices.get(id); return d ? { ...d } : null; },
    async updateDevice(id, patch) { const d = devices.get(id); if (d) Object.assign(d, patch); },
    async deleteDevice(id) { devices.delete(id); dropTargets(id); },
    async replaceTargets(deviceId, incoming) {
      const fired = [];
      const keep = new Set(incoming.map(t => t.id));
      for (const [k, t] of [...targets]) if (t.deviceId === deviceId && !keep.has(t.id)) targets.delete(k);
      for (const t of incoming) {
        const old = targets.get(key(deviceId, t.id));
        if (!old) targets.set(key(deviceId, t.id), { ...t, deviceId, firedAt: null, firedPrice: null, attempts: 0 });
        else if (t.rev > old.rev) targets.set(key(deviceId, t.id), { ...t, deviceId, firedAt: null, firedPrice: null, attempts: 0 });
        else if (old.firedAt) fired.push({ id: t.id, at: new Date(old.firedAt).toISOString(), price: old.firedPrice });
      }
      return fired;
    },
    async countTargets(deviceId) { return [...targets.values()].filter(t => t.deviceId === deviceId).length; },
    async listArmed() {
      return [...targets.values()].filter(t => t.firedAt === null && (devices.get(t.deviceId)?.failures ?? Infinity) < BAD_DEVICE_FAILURES)
        .map(t => ({ deviceId: t.deviceId, targetId: t.id, ticker: t.ticker, dir: t.dir, price: t.price }));
    },
    async claimFire(deviceId, targetId, { price, now }) {
      const t = targets.get(key(deviceId, targetId));
      if (!t || t.firedAt !== null) return false;
      t.firedAt = now; t.firedPrice = price;
      return true;
    },
    async failFire(deviceId, targetId) {
      const t = targets.get(key(deviceId, targetId));
      if (!t) return;
      t.attempts += 1;
      if (t.attempts < MAX_FIRE_ATTEMPTS) { t.firedAt = null; t.firedPrice = null; }
    },
    async recordSend(id, ok) { const d = devices.get(id); if (d) d.failures = ok ? 0 : d.failures + 1; },
    async listMilestoneDevices(ticker) {
      return [...devices.values()].filter(d => d.milestones && d.failures < BAD_DEVICE_FAILURES && (d.milestoneCoins.length === 0 || d.milestoneCoins.includes(ticker)));
    },
    async prune({ olderThan }) {
      let n = 0;
      for (const d of [...devices.values()]) if (d.lastSeen < olderThan || d.failures >= BAD_DEVICE_FAILURES) { devices.delete(d.id); dropTargets(d.id); n++; }
      return n;
    },
  };
}

/** Postgres store. Two small tables; targets are removed with their device (ON DELETE CASCADE). */
export function createPgPushStore(pool) {
  const toDevice = r => r && ({
    id: r.id, tokenHash: r.token_hash, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth,
    milestones: r.milestones, milestoneCoins: r.milestone_coins ? r.milestone_coins.split(',') : [],
    failures: r.failures, lastSeen: new Date(r.last_seen).getTime(),
  });
  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS push_devices (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          milestones BOOLEAN NOT NULL DEFAULT FALSE,
          milestone_coins TEXT NOT NULL DEFAULT '',
          failures INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS push_targets (
          device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
          target_id TEXT NOT NULL,
          ticker TEXT NOT NULL,
          dir TEXT NOT NULL,
          price DOUBLE PRECISION NOT NULL,
          rev BIGINT NOT NULL DEFAULT 0,
          fired_at TIMESTAMPTZ,
          fired_price DOUBLE PRECISION,
          attempts INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (device_id, target_id)
        )`);
      await pool.query('CREATE INDEX IF NOT EXISTS push_targets_armed_idx ON push_targets (ticker) WHERE fired_at IS NULL');
    },
    async count() { return Number((await pool.query('SELECT count(*) AS n FROM push_devices')).rows[0].n); },
    async findByEndpoint(endpoint) { return toDevice((await pool.query('SELECT * FROM push_devices WHERE endpoint = $1', [endpoint])).rows[0]); },
    async insertDevice(d) {
      await pool.query(
        `INSERT INTO push_devices (id, token_hash, endpoint, p256dh, auth, milestones, milestone_coins) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [d.id, d.tokenHash, d.endpoint, d.p256dh, d.auth, d.milestones, d.milestoneCoins.join(',')]
      );
    },
    async getDevice(id) { return toDevice((await pool.query('SELECT * FROM push_devices WHERE id = $1', [id])).rows[0]); },
    async updateDevice(id, patch) {
      const cols = { endpoint: 'endpoint', p256dh: 'p256dh', auth: 'auth', milestones: 'milestones' };
      const sets = []; const vals = [id];
      for (const [k, col] of Object.entries(cols)) if (k in patch) { vals.push(patch[k]); sets.push(`${col} = $${vals.length}`); }
      if ('milestoneCoins' in patch) { vals.push(patch.milestoneCoins.join(',')); sets.push(`milestone_coins = $${vals.length}`); }
      if ('lastSeen' in patch) sets.push('last_seen = now()');
      if ('failures' in patch) { vals.push(patch.failures); sets.push(`failures = $${vals.length}`); }
      if (sets.length) await pool.query(`UPDATE push_devices SET ${sets.join(', ')} WHERE id = $1`, vals);
    },
    async deleteDevice(id) { await pool.query('DELETE FROM push_devices WHERE id = $1', [id]); },
    async replaceTargets(deviceId, incoming) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: old } = await client.query('SELECT target_id, rev, fired_at, fired_price FROM push_targets WHERE device_id = $1 FOR UPDATE', [deviceId]);
        const byId = new Map(old.map(r => [r.target_id, r]));
        const keep = new Set(incoming.map(t => t.id));
        const drop = old.filter(r => !keep.has(r.target_id)).map(r => r.target_id);
        if (drop.length) await client.query('DELETE FROM push_targets WHERE device_id = $1 AND target_id = ANY($2::text[])', [deviceId, drop]);
        const fired = [];
        for (const t of incoming) {
          const was = byId.get(t.id);
          if (!was || t.rev > Number(was.rev)) {
            await client.query(
              `INSERT INTO push_targets (device_id, target_id, ticker, dir, price, rev) VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (device_id, target_id) DO UPDATE
               SET ticker = EXCLUDED.ticker, dir = EXCLUDED.dir, price = EXCLUDED.price, rev = EXCLUDED.rev,
                   fired_at = NULL, fired_price = NULL, attempts = 0`,
              [deviceId, t.id, t.ticker, t.dir, t.price, t.rev]
            );
          } else if (was.fired_at) {
            fired.push({ id: t.id, at: new Date(was.fired_at).toISOString(), price: was.fired_price });
          }
        }
        await client.query('COMMIT');
        return fired;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async countTargets(deviceId) { return Number((await pool.query('SELECT count(*) AS n FROM push_targets WHERE device_id = $1', [deviceId])).rows[0].n); },
    async listArmed() {
      const { rows } = await pool.query(
        `SELECT t.device_id, t.target_id, t.ticker, t.dir, t.price FROM push_targets t
         JOIN push_devices d ON d.id = t.device_id WHERE t.fired_at IS NULL AND d.failures < $1`, [BAD_DEVICE_FAILURES]);
      return rows.map(r => ({ deviceId: r.device_id, targetId: r.target_id, ticker: r.ticker, dir: r.dir, price: r.price }));
    },
    async claimFire(deviceId, targetId, { price }) {
      const r = await pool.query('UPDATE push_targets SET fired_at = now(), fired_price = $3 WHERE device_id = $1 AND target_id = $2 AND fired_at IS NULL', [deviceId, targetId, price]);
      return r.rowCount === 1;
    },
    async failFire(deviceId, targetId) {
      await pool.query(
        `UPDATE push_targets SET attempts = attempts + 1,
           fired_at = CASE WHEN attempts + 1 >= $3 THEN fired_at ELSE NULL END,
           fired_price = CASE WHEN attempts + 1 >= $3 THEN fired_price ELSE NULL END
         WHERE device_id = $1 AND target_id = $2`, [deviceId, targetId, MAX_FIRE_ATTEMPTS]);
    },
    async recordSend(id, ok) {
      await pool.query(ok ? 'UPDATE push_devices SET failures = 0 WHERE id = $1 AND failures <> 0' : 'UPDATE push_devices SET failures = failures + 1 WHERE id = $1', [id]);
    },
    async listMilestoneDevices(ticker) {
      const { rows } = await pool.query(
        `SELECT * FROM push_devices WHERE milestones AND failures < $1
         AND (milestone_coins = '' OR ',' || milestone_coins || ',' LIKE '%,' || $2 || ',%')`, [BAD_DEVICE_FAILURES, ticker]);
      return rows.map(toDevice);
    },
    async prune({ olderThan }) {
      const r = await pool.query('DELETE FROM push_devices WHERE last_seen < $1 OR failures >= $2', [new Date(olderThan), BAD_DEVICE_FAILURES]);
      return r.rowCount;
    },
  };
}

// ---------------------------------------------------------------- notification text

const upDown = pct => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;

/** The notification for a reached device alert. `coin` is the live snapshot entry. */
export function targetPayload({ targetId, ticker, dir, price }, coin, now) {
  const stable = Boolean(coin.stable);
  const nowText = formatPrice(coin.price, { stable });
  let title;
  if (dir === 'above') title = `${ticker} is above ${formatPrice(price, { stable })}`;
  else if (dir === 'below') title = `${ticker} is below ${formatPrice(price, { stable })}`;
  else if (dir === 'move') title = `${ticker} moved ${upDown(coin.change24h ?? 0)} in 24h`;
  else if (dir === 'ath') title = `${ticker} hit a new all-time high`;
  else title = `${ticker} hit a new all-time low`;
  return {
    v: 1, kind: 'target', id: targetId, ticker, dir,
    title, body: `Now ${nowText}. Tap to open the chart.`,
    tag: `tgt-${targetId}`, url: `/coin/${ticker}`, price: coin.price, ts: now,
  };
}

export function milestonePayload({ ticker, price, direction }, stable, now) {
  const arrow = direction === 'down' ? '\u25BC' : '\u25B2';
  return {
    v: 1, kind: 'milestone', ticker,
    title: `${arrow} ${ticker} reached ${formatPrice(price, { stable })}`,
    body: direction === 'down' ? 'Milestone alert: it fell through a round level.' : 'Milestone alert: it crossed a round level.',
    tag: `ms-${ticker}`, url: `/coin/${ticker}`, price, ts: now,
  };
}

// ---------------------------------------------------------------- the service

export function createPushService({
  store, webpush, coins, getSnapshot, getMarket = null,
  extraHosts = [], maxDevices = 20_000, checkMs = 15_000, deviceTtlDays = 120,
  now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), log = console,
}) {
  const tickerSet = new Set(coins.map(c => c.ticker));
  const stableOf = new Map(coins.map(c => [c.ticker, Boolean(c.stable)]));
  const lastTest = new Map();
  let running = false;
  let timers = [];

  const newSecret = bytes => crypto.randomBytes(bytes).toString('base64url');

  /** Resolves "Bearer <id>.<token>" to a device or throws 401. The hash comparison runs even for unknown ids. */
  async function authenticate(header) {
    const m = typeof header === 'string' ? header.match(/^Bearer ([A-Za-z0-9_-]{16,32})\.([A-Za-z0-9_-]{40,64})$/) : null;
    if (!m) throw new PushError(401, 'Not signed in.');
    const device = await store.getDevice(m[1]);
    const stored = device ? Buffer.from(device.tokenHash, 'hex') : Buffer.alloc(32);
    const ok = sameHash(sha256(m[2]), stored);
    if (!device || !ok) throw new PushError(401, 'Not signed in.');
    return device;
  }

  async function register({ subscription, prefs, targets }) {
    const sub = validateSubscription(subscription, extraHosts);
    const cleanPrefs = prefs === undefined ? { milestones: false, coins: [] } : validatePrefs(prefs, tickerSet);
    const cleanTargets = targets === undefined ? [] : validateTargets(targets, tickerSet);
    // Whoever holds this subscription is the device. A re-install loses its token, so the old record is replaced.
    const existing = await store.findByEndpoint(sub.endpoint);
    if (existing) await store.deleteDevice(existing.id);
    else if ((await store.count()) >= maxDevices) throw new PushError(503, 'Notifications are at capacity right now. Try again later.');
    const id = newSecret(16);
    const token = newSecret(32);
    await store.insertDevice({ id, tokenHash: sha256(token).toString('hex'), ...sub, milestones: cleanPrefs.milestones, milestoneCoins: cleanPrefs.coins, now: now() });
    const fired = await store.replaceTargets(id, cleanTargets);
    return { deviceId: id, token, prefs: cleanPrefs, targets: cleanTargets.length, fired };
  }

  async function sync(device, { subscription, prefs, targets }) {
    const patch = { lastSeen: now() };
    if (subscription !== undefined) {
      const sub = validateSubscription(subscription, extraHosts);
      if (sub.endpoint !== device.endpoint) {
        const other = await store.findByEndpoint(sub.endpoint);
        if (other && other.id !== device.id) await store.deleteDevice(other.id);
      }
      Object.assign(patch, sub, { failures: 0 });
    }
    let cleanPrefs = null;
    if (prefs !== undefined) {
      cleanPrefs = validatePrefs(prefs, tickerSet);
      patch.milestones = cleanPrefs.milestones;
      patch.milestoneCoins = cleanPrefs.coins;
    }
    const cleanTargets = targets === undefined ? null : validateTargets(targets, tickerSet);
    await store.updateDevice(device.id, patch);
    const fired = cleanTargets ? await store.replaceTargets(device.id, cleanTargets) : [];
    return { ok: true, prefs: cleanPrefs ?? { milestones: device.milestones, coins: device.milestoneCoins }, targets: cleanTargets ? cleanTargets.length : await store.countTargets(device.id), fired };
  }

  async function remove(device) { await store.deleteDevice(device.id); }

  async function deliver(device, payload, opts) {
    const r = await webpush.send(device, payload, opts);
    if (r.gone) { await store.deleteDevice(device.id); return r; }
    await store.recordSend(device.id, r.ok);
    return r;
  }

  async function deliverWithRetry(device, payload, opts) {
    let r = await deliver(device, payload, opts);
    for (let i = 1; i <= 2 && r.retry; i++) { await sleep(400 * i); r = await deliver(device, payload, opts); }
    return r;
  }

  async function test(device) {
    const t = now();
    if (t - (lastTest.get(device.id) ?? 0) < TEST_GAP_MS) throw new PushError(429, 'Wait a few seconds before sending another test.');
    lastTest.set(device.id, t);
    if (lastTest.size > 5000) for (const [k, v] of lastTest) if (t - v > TEST_GAP_MS) lastTest.delete(k);
    const r = await deliver(device, {
      v: 1, kind: 'test', title: 'Notifications are on', body: 'Your price alerts will arrive here, even when Cryptomium is closed.',
      tag: 'cm-test', url: '/settings/alerts', ts: t,
    }, { ttl: 300, urgency: 'high' });
    if (!r.ok) throw new PushError(r.gone ? 410 : 502, r.gone ? 'This device is no longer registered. Turn notifications on again.' : 'The push service did not accept the message. Try again.');
    return { sent: true };
  }

  const reached = (t, coin, market) => {
    if (t.dir === 'above') return coin.price >= t.price;
    if (t.dir === 'below') return coin.price <= t.price;
    if (t.dir === 'move') return typeof coin.change24h === 'number' && Math.abs(coin.change24h) >= t.price;
    const m = market?.[t.ticker];
    if (t.dir === 'ath') return m?.ath > 0 && coin.price >= m.ath;
    if (t.dir === 'atl') return m?.atl > 0 && coin.price <= m.atl;
    return false;
  };

  /** One pass: compare every armed device alert with the live prices and send what was reached. */
  async function tick() {
    if (running) return { skipped: true, armed: 0, sent: 0 };
    running = true;
    const out = { skipped: false, armed: 0, sent: 0, retried: 0, removed: 0 };
    try {
      const armed = await store.listArmed();
      out.armed = armed.length;
      if (!armed.length) return out;
      let snap;
      try { snap = await getSnapshot(); } catch { return { ...out, noPrices: true }; }
      if (!snap || snap.stale) return { ...out, stale: true }; // never judge an alert by an old price
      const live = new Map(snap.coins.filter(c => Number.isFinite(c.price) && c.price > 0).map(c => [c.ticker, c]));
      let market = null;
      if (getMarket && armed.some(t => t.dir === 'ath' || t.dir === 'atl')) { try { market = await getMarket(); } catch { /* ATH/ATL alerts wait for market data */ } }
      const hits = armed.filter(t => live.has(t.ticker) && reached(t, live.get(t.ticker), market));
      for (let i = 0; i < hits.length; i += 8) {
        await Promise.all(hits.slice(i, i + 8).map(async t => {
          const coin = live.get(t.ticker);
          if (!(await store.claimFire(t.deviceId, t.targetId, { price: coin.price, now: now() }))) return; // already handled
          const device = await store.getDevice(t.deviceId);
          if (!device) return;
          const r = await deliverWithRetry(device, targetPayload(t, coin, now()), { ttl: 3600, urgency: 'high', topic: `t${t.targetId}`.slice(0, 32) });
          if (r.ok) out.sent++;
          else if (r.gone) out.removed++;
          else { out.retried++; await store.failFire(t.deviceId, t.targetId); }
        }));
      }
      return out;
    } finally {
      running = false;
    }
  }

  /** The owner's channel posted a milestone: tell the devices that opted in (all coins, or the ones they picked). */
  async function notifyMilestone({ ticker, price, direction }) {
    if (!tickerSet.has(ticker)) return { sent: 0 };
    const devices = await store.listMilestoneDevices(ticker);
    const payload = milestonePayload({ ticker, price, direction }, stableOf.get(ticker), now());
    let sent = 0;
    for (let i = 0; i < devices.length; i += 10) {
      await Promise.all(devices.slice(i, i + 10).map(async d => {
        const r = await deliverWithRetry(d, payload, { ttl: 1800, urgency: 'normal', topic: `m${ticker}`.slice(0, 32) });
        if (r.ok) sent++;
      }));
    }
    return { sent, devices: devices.length };
  }

  async function prune() {
    const n = await store.prune({ olderThan: now() - deviceTtlDays * 86_400_000 });
    if (n) log.log(`[push] Removed ${n} inactive or dead device(s).`);
    return n;
  }

  function start() {
    const safe = (name, fn) => () => fn().catch(err => log.error(`[push] ${name} failed:`, err.message));
    timers = [setInterval(safe('Alert check', tick), checkMs), setInterval(safe('Cleanup', prune), 6 * 3600_000)];
    timers.forEach(t => t.unref?.());
    safe('Cleanup', prune)();
  }
  function stop() { timers.forEach(clearInterval); timers = []; }

  return { publicKey: webpush.publicKey, authenticate, register, sync, remove, test, tick, notifyMilestone, prune, start, stop };
}
