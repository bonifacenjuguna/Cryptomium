// App notifications on this device (Web Push).
//
// What this file does, in order of a person's journey:
//   1. Asks at the right moment. Nothing prompts on first load: the permission question is only shown after
//      the person sets a price alert (or taps Turn on in Settings), with a short explanation first.
//   2. Subscribes this device to the push service and registers it with the backend. The backend gives the
//      device a secret token; only that device can change its own alerts or turn itself off.
//   3. Keeps the backend's copy of this device's price alerts in step with the ones on screen, so an alert
//      still fires when the app is closed.
//   4. Shows incoming messages inside the app while it is open (the service worker shows the system
//      notification otherwise), and learns which alerts fired while the app was away.
//   5. Turns off cleanly: the backend forgets the device and the browser drops the subscription.
//
// No keys live here. The PUBLIC server key is fetched from the backend; the private key never leaves it.
import { el, toast, prefs, favList, onFavs } from './common.js';
import { loadTargets, markFired, describe, chime } from './targets.js';
import { onRecover } from './net.js';

const CFG = window.CRYPTOMIUM || {};
const API = String(CFG.apiUrl || '').replace(/\/+$/, '');
const KEY = 'cm-push';                 // { id, token, key, prefs: { milestones, scope } }
const OFFER_KEY = 'cm-push-offer';     // when the person last said "Not now"
const LAST_KEY = 'cm-push-last';       // fingerprint of what the backend already has
const SYNCED_KEY = 'cm-push-synced';   // when this device last talked to the backend
const FORGET_KEY = 'cm-push-forget';   // a turn-off that could not reach the backend yet
const AUTH_CACHE = 'cmpush-v1';        // read by the service worker (re-subscribing without the app open)
const AUTH_URL = '/__cm/push-auth';
const OFFER_PAUSE_MS = 7 * 24 * 3600 * 1000;
const PASSIVE_SYNC_MS = 10 * 60 * 1000;

const root = document.documentElement;
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

const ua = navigator.userAgent || '';
const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const secure = location.protocol === 'https:' || location.hostname === 'localhost';

/** Does this browser have what Web Push needs? iPhone only allows it for an app added to the Home Screen. */
export const capable = () => secure && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && 'fetch' in window;
export const needsInstall = () => isIOS && !standalone();

// ------------------------------------------------------------------ the backend
class Failure extends Error { constructor(reason, status = 0) { super(reason); this.reason = reason; this.status = status; } }

async function call(method, path, body, creds) {
  if (!API) throw new Failure('unavailable');
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (creds) headers.Authorization = `Bearer ${creds.id}.${creds.token}`;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000), cache: 'no-store' });
  } catch { throw new Failure(navigator.onLine === false ? 'offline' : 'network'); }
  let json = null;
  try { json = await res.json(); } catch { /* 204 or empty */ }
  return { status: res.status, json };
}

let keyCache = null;
async function serverKey() {
  if (keyCache) return keyCache;
  const { status, json } = await call('GET', '/api/push/key');
  if (status === 404 || !json || json.enabled === false) throw new Failure('unavailable', status);
  if (status !== 200 || !json.publicKey) throw new Failure('server', status);
  keyCache = json.publicKey;
  return keyCache;
}

const toBytes = s => { const p = s.replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(p + '='.repeat((4 - (p.length % 4)) % 4)); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
const sameBytes = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((v, i) => v === new Uint8Array(b)[i]);

// ------------------------------------------------------------------ what this device wants the backend to know
const creds = () => { const c = ls.get(KEY); return c && c.id && c.token ? c : null; };
const settings = () => { const c = creds(); return { milestones: !!(c && c.prefs && c.prefs.milestones), scope: c && c.prefs && c.prefs.scope === 'starred' ? 'starred' : 'all' }; };

function armedAlerts() {
  return loadTargets().filter(t => !t.firedAt).map(t => ({ id: t.id, ticker: t.ticker, dir: t.dir, price: t.price, rev: Math.floor(t.armedAt || t.created || 0) }));
}
function wantedPrefs() {
  const s = settings();
  if (!s.milestones) return { milestones: false, coins: [] };
  if (s.scope === 'all') return { milestones: true, coins: [] };
  const coins = favList();
  return coins.length ? { milestones: true, coins: coins.slice(0, 40) } : { milestones: false, coins: [] }; // no starred coins: nothing to send
}

async function writeAuthForWorker(c) {
  try {
    const cache = await caches.open(AUTH_CACHE);
    if (!c) { await cache.delete(AUTH_URL); return; }
    await cache.put(AUTH_URL, new Response(JSON.stringify({ api: API, id: c.id, token: c.token, key: c.key }), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* the worker simply cannot re-subscribe on its own */ }
}

function announce() {
  root.dataset.push = creds() ? 'on' : 'off'; // targets.js reads this: the backend sends alerts now, so no second pop-up here
  document.dispatchEvent(new CustomEvent('cm:push'));
}

// ------------------------------------------------------------------ state
/** { status, permission, ...settings } where status is one of
 *  unsupported | install | blocked | unavailable | off | on */
export async function getState() {
  const base = { permission: 'Notification' in window ? Notification.permission : 'denied', ...settings() };
  if (!capable()) return { ...base, status: 'unsupported' };
  if (needsInstall()) return { ...base, status: 'install' };
  if (Notification.permission === 'denied') return { ...base, status: 'blocked' };
  if (!API) return { ...base, status: 'unavailable' };
  if (creds() && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && (await reg.pushManager.getSubscription())) return { ...base, status: 'on' };
    } catch { /* treat as off */ }
  }
  return { ...base, status: 'off' };
}

// ------------------------------------------------------------------ turning on
async function ready() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Failure('worker')), 8000))]);
  return reg;
}

/**
 * Subscribe this device and register it with the backend. Must be called from a tap (the browser asks for
 * permission here). Resolves { ok: true } or { ok: false, reason } with reason one of
 * denied | dismissed | unsupported | install | unavailable | offline | network | server | worker.
 */
export async function enable() {
  if (!capable()) return { ok: false, reason: 'unsupported' };
  if (needsInstall()) return { ok: false, reason: 'install' };
  try {
    // Ask first, while the tap is fresh. Everything slow comes after.
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission === 'denied') return { ok: false, reason: 'denied' };
    if (permission !== 'granted') return { ok: false, reason: 'dismissed' };

    const publicKey = await serverKey();
    const reg = await ready();
    let sub = await reg.pushManager.getSubscription();
    const want = toBytes(publicKey);
    if (sub && !sameBytes(sub.options && sub.options.applicationServerKey, want)) { await sub.unsubscribe(); sub = null; } // the server key changed
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });

    await register(sub, publicKey);
    ls.del(OFFER_KEY);
    announce();
    return { ok: true };
  } catch (err) {
    if (err instanceof Failure) return { ok: false, reason: err.reason };
    return { ok: false, reason: err && err.name === 'NotAllowedError' ? 'denied' : 'server' };
  }
}

/** First registration, or an update when this device already has a token (re-subscribed, or a changed key). */
async function register(sub, publicKey) {
  const body = { subscription: sub.toJSON(), prefs: wantedPrefs(), targets: armedAlerts() };
  const existing = creds();
  let res;
  if (existing) {
    res = await call('PUT', '/api/push/devices/me', body, existing);
    if (res.status === 401) { ls.del(KEY); res = null; }
  }
  if (!res) res = await call('POST', '/api/push/devices', body);
  if (res.status === 400) throw new Failure('unsupported', 400);
  if (res.status === 429) throw new Failure('server', 429);
  if (res.status !== 200 && res.status !== 201) throw new Failure('server', res.status);
  const c = res.status === 201
    ? { id: res.json.deviceId, token: res.json.token, key: publicKey, prefs: { milestones: settings().milestones, scope: settings().scope } }
    : { ...creds(), key: publicKey };
  ls.set(KEY, c);
  ls.set(LAST_KEY, fingerprint(body));
  ls.set(SYNCED_KEY, Date.now());
  await writeAuthForWorker(c);
  applyFired(res.json && res.json.fired);
}

// ------------------------------------------------------------------ turning off
export async function disable() {
  const c = creds();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await sub.unsubscribe();
  } catch { /* already gone */ }
  ls.del(KEY); ls.del(LAST_KEY); ls.del(SYNCED_KEY);
  await writeAuthForWorker(null);
  announce();
  if (c) {
    try {
      const r = await call('DELETE', '/api/push/devices/me', undefined, c);
      if (r.status !== 204 && r.status !== 401) throw new Failure('server', r.status);
    } catch { ls.set(FORGET_KEY, { id: c.id, token: c.token }); } // finish the clean-up next time we are online
  }
  return { ok: true };
}

async function finishForget() {
  const f = ls.get(FORGET_KEY);
  if (!f) return;
  try {
    const r = await call('DELETE', '/api/push/devices/me', undefined, f);
    if (r.status === 204 || r.status === 401) ls.del(FORGET_KEY);
  } catch { /* try again later */ }
}

// ------------------------------------------------------------------ keeping the backend in step
const fingerprint = body => JSON.stringify([body.prefs, body.targets]);
let timer = null;
let syncing = null;

/** Send this device's alerts and preferences to the backend (debounced; skipped when nothing changed). */
export function syncSoon(delay = 1200) {
  if (!creds()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

export async function syncNow({ force = false } = {}) {
  const c = creds();
  if (!c || Notification.permission !== 'granted' || navigator.onLine === false) return false;
  if (syncing) return syncing;
  const body = { prefs: wantedPrefs(), targets: armedAlerts() };
  if (!force && ls.get(LAST_KEY) === fingerprint(body)) {
    // Nothing new to send, but still ask now and then which alerts fired while the app was closed.
    if (Date.now() - (ls.get(SYNCED_KEY) || 0) < PASSIVE_SYNC_MS) return true;
  }
  syncing = (async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (!sub) { await enable(); return true; }   // the browser dropped the subscription: quietly make a new one
      const send = { ...body, subscription: sub.toJSON() };
      const r = await call('PUT', '/api/push/devices/me', send, c);
      if (r.status === 401) { ls.del(KEY); await register(sub, c.key || (await serverKey())); return true; } // the backend forgot this device
      if (r.status !== 200) return false;
      ls.set(LAST_KEY, fingerprint(body));
      ls.set(SYNCED_KEY, Date.now());
      applyFired(r.json && r.json.fired);
      return true;
    } catch { return false; }
    finally { syncing = null; }
  })();
  return syncing;
}

/** Preferences for the Milestones switch: { milestones: boolean, scope: 'all' | 'starred' }. */
export async function setMilestones({ milestones, scope }) {
  const c = creds();
  if (!c) return { ok: false, reason: 'off' };
  const before = c.prefs;
  ls.set(KEY, { ...c, prefs: { milestones: !!milestones, scope: scope === 'starred' ? 'starred' : 'all' } });
  const ok = await syncNow({ force: true });
  if (!ok) { ls.set(KEY, { ...c, prefs: before }); return { ok: false, reason: navigator.onLine === false ? 'offline' : 'network' }; }
  document.dispatchEvent(new CustomEvent('cm:push'));
  return { ok: true };
}

/** Sends one test notification to this device. */
export async function sendTest() {
  const c = creds();
  if (!c) return { ok: false, reason: 'off' };
  try {
    const r = await call('POST', '/api/push/devices/me/test', {}, c);
    if (r.status === 200) return { ok: true };
    if (r.status === 401 || r.status === 410) { ls.del(KEY); await writeAuthForWorker(null); announce(); return { ok: false, reason: 'gone' }; }
    if (r.status === 429) return { ok: false, reason: 'wait' };
    return { ok: false, reason: 'server' };
  } catch (err) { return { ok: false, reason: err.reason || 'network' }; }
}

// ------------------------------------------------------------------ incoming messages
/** Alerts the backend says were reached while the app was away. */
function applyFired(list) {
  if (!Array.isArray(list)) return;
  for (const f of list) {
    const t = markFired(f.id, f.price);
    if (t) toast(`While you were away: ${t.ticker} ${describe(t)}.`, { kind: 'info', ms: 10000, href: '/coin/' + t.ticker });
  }
}

function incoming(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.kind === 'target') {
    const t = msg.id ? markFired(msg.id, msg.price) : null;
    if (!t && msg.id) return; // this page already showed it
    if (prefs.get('sound')) chime();
    toast(`${msg.title}. ${msg.body.replace(/ Tap to open the chart\.$/, '')}`, { kind: /below|low|-/.test(msg.title) ? 'down' : 'up', ms: 12000, href: msg.url });
  } else if (msg.kind === 'milestone') {
    toast(`${msg.title}`, { kind: msg.title.startsWith('\u25BC') ? 'down' : 'up', ms: 9000, href: msg.url });
  } else if (msg.kind === 'test') {
    toast('Test notification delivered. Notifications work on this device.', { kind: 'up', ms: 6000 });
  }
}

// ------------------------------------------------------------------ the question, asked at the right moment
const offerPaused = () => Date.now() - (ls.get(OFFER_KEY) || 0) < OFFER_PAUSE_MS;

/** Should a price-alert screen offer notifications right now? Never when already on, blocked, or recently declined. */
export async function shouldOffer() {
  if (!capable() || !API || offerPaused()) return false;
  const s = await getState();
  return s.status === 'off' && s.permission === 'default' || s.status === 'install';
}

const REASONS = {
  denied: 'Notifications are blocked for Cryptomium. Allow them in your browser or phone settings, then turn them on here.',
  dismissed: 'No problem. You can turn notifications on any time in Settings, Price alerts.',
  unsupported: 'This browser cannot receive notifications. Alerts still show here while the app is open.',
  install: 'To get notifications on iPhone, add Cryptomium to your Home Screen first (Share, then Add to Home Screen).',
  unavailable: 'Notifications are not available right now. Alerts still show here while the app is open.',
  offline: 'You are offline. Connect to the internet and try again.',
  network: 'Could not reach Cryptomium. Check your connection and try again.',
  server: 'Something went wrong turning notifications on. Please try again in a moment.',
  worker: 'The app is still starting up. Try again in a few seconds.',
};
export const reasonText = r => REASONS[r] || REASONS.server;

/**
 * A small card explaining why notifications help, with the two choices. Shown inline (not a pop-up) right after
 * the person has set an alert, which is the moment they can see the value. The browser's own permission prompt
 * appears only after they tap "Turn on notifications".
 */
export function offerCard({ onDone } = {}) {
  const card = el('div', 'push-offer');
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Notifications');
  const finish = (text, ok) => {
    card.replaceChildren(el('p', 'push-offer-text' + (ok ? ' ok' : ''), text));
    if (!ok) { const close = el('button', 'btn btn-ghost btn-sm', 'Close'); close.type = 'button'; close.addEventListener('click', () => { card.remove(); onDone && onDone(); }); card.append(close); }
    else setTimeout(() => { card.remove(); onDone && onDone(); }, 3500);
  };
  if (needsInstall()) { finish(REASONS.install, false); return card; }
  card.append(
    el('strong', 'push-offer-title', 'Get this alert even when the app is closed'),
    el('p', 'push-offer-text', 'Turn on notifications and we will tell you the moment your price is reached, without you keeping Cryptomium open.')
  );
  const actions = el('div', 'push-offer-actions');
  const yes = el('button', 'btn btn-accent btn-sm', 'Turn on notifications');
  const no = el('button', 'btn btn-ghost btn-sm', 'Not now');
  yes.type = 'button'; no.type = 'button';
  yes.addEventListener('click', async () => {
    yes.disabled = no.disabled = true;
    yes.textContent = 'Turning on\u2026';
    const r = await enable();
    if (r.ok) finish('Notifications are on. You will be told when your price is reached.', true);
    else { if (r.reason === 'dismissed') ls.set(OFFER_KEY, Date.now()); finish(reasonText(r.reason), false); }
  });
  no.addEventListener('click', () => { ls.set(OFFER_KEY, Date.now()); card.remove(); onDone && onDone(); });
  actions.append(yes, no);
  card.append(actions);
  return card;
}

// ------------------------------------------------------------------ start
let started = false;
export function start() {
  if (started) return;
  started = true;
  announce();

  // Messages from the service worker. In the installed app the shell page receives them and passes them to the
  // screen in front; in a browser tab the page receives them itself.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.cm === 'push' && document.visibilityState === 'visible') incoming(e.data.msg); });
  }
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== parent || !e.data || e.data.cm !== 'sw-push') return;
    incoming(e.data.msg);
  });

  document.addEventListener('cm:targets', () => syncSoon());
  onFavs(() => { if (settings().milestones && settings().scope === 'starred') syncSoon(); });
  onRecover(() => { finishForget(); syncSoon(500); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(800); });
  addEventListener('storage', e => { if (e.key === KEY) announce(); });

  // The person revoked permission in the phone's settings: drop our side too.
  if (creds() && 'Notification' in window && Notification.permission !== 'granted') disable();
  else { finishForget(); syncSoon(2500); }
}

