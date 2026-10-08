// Cryptomium service worker.
//
// App shell: every page and script of one build is saved together (all-or-nothing) in one versioned
// cache, so the app opens without a network and never mixes files from two versions.
// Updates: a new build downloads quietly in the background and waits. It only takes over when the app
// asks (Update now, automatic mode at a safe moment) so a session is never swapped under the visitor.
// Market data is NOT handled here: the pages keep the last good copy themselves and label it.
const BUILD = '__VERSION__';
const APP_VERSION = '__APP_VERSION__';
const API_ORIGIN = '__API_ORIGIN__';
const PRECACHE = __PRECACHE__;   // pages and files the app cannot work without
const OFFLINE_HTML = __OFFLINE_HTML__; // the offline page, built into the worker so it can never be missing
const OPTIONAL = __OPTIONAL__;   // coin pages and icons: nice to have offline, never block an update

const SHELL = `cm3-shell-${BUILD}`;
const PAGES = `cm3-pages-${BUILD}`;
const MEDIA = 'cm3-media';       // coin logos: kept across versions
const MEDIA_MAX = 120;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const hadLegacy = (await caches.keys()).some(k => k.startsWith('cm-static-'));
    const cache = await caches.open(SHELL);
    try {
      // `reload` skips the browser's own HTTP cache so a half-old file can never be saved as "new".
      await Promise.all(PRECACHE.map(async url => {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        await cache.put(url, res);
      }));
    } catch (err) {
      await caches.delete(SHELL); // never leave a half-saved version behind; the old version keeps running
      throw err;
    }
    await Promise.all(OPTIONAL.map(url => fetch(new Request(url, { cache: 'reload' })).then(r => (r.ok ? cache.put(url, r) : null)).catch(() => {})));
    // First install, or an upgrade from the old worker that had no update screen: take over at once.
    // Otherwise wait for the app to say when (see the 'message' handler).
    if (!self.registration.active || hadLegacy) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, PAGES, MEDIA]);
    await Promise.all((await caches.keys()).filter(k => (k.startsWith('cm-') || k.startsWith('cm3-')) && !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  else if (msg.type === 'GET_VERSION') event.ports[0]?.postMessage({ version: APP_VERSION, build: BUILD });
});

const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), ms);
  p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

const fromShell = async request => {
  const opts = { ignoreSearch: true };
  return (await (await caches.open(PAGES)).match(request, opts)) || (await (await caches.open(SHELL)).match(request, opts));
};

// Files and pages say which build they belong to with ?v=<build>. A response that belongs to another build must never
// run against this build's saved files (that is how an old script ended up inside a new page while an update waited).
const otherBuild = url => { const v = new URL(url, self.location.origin).searchParams.get('v'); return Boolean(v) && v !== BUILD; };

async function page(event) {
  const { request } = event;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const hit = await fromShell(path);
  if (hit) return hit;
  // Every coin address is the same page (it reads the coin from the address). Use the saved copy of this build rather
  // than whatever the network now serves, which may already be the next build.
  if (/^\/coin\/[^/]+$/.test(path)) { const generic = await fromShell('/coin'); if (generic) return generic; }
  try {
    const res = await withTimeout(fetch(request), 5000);
    if (res && res.ok) {
      const forText = res.clone();
      const forCache = res.clone();
      // Only keep a page that belongs to this build.
      event.waitUntil(forText.text().then(html => { if (!/[?&]v=[0-9a-f]{8}/.test(html) || html.includes(`v=${BUILD}`)) return caches.open(PAGES).then(c => c.put(url.pathname, forCache)); }).catch(() => {}));
    }
    return res;
  } catch {
    return (await fromShell('/offline')) || new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function asset(event) {
  const { request } = event;
  // A file asked for by a page of another build: straight from the network, never from or into this build's cache.
  if (otherBuild(request.url)) { try { return await fetch(request); } catch { return Response.error(); } }
  const hit = await fromShell(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok) { const copy = res.clone(); event.waitUntil(caches.open(SHELL).then(c => c.put(request, copy))); }
    return res;
  } catch {
    return Response.error();
  }
}

// Coin logos and the Google Fonts files: show the saved one at once, refresh it quietly (so the app looks right offline).
async function media(event) {
  const { request } = event;
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(request.url);
  const fresh = fetch(request).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      event.waitUntil(cache.put(request.url, copy).then(async () => {
        const keys = await cache.keys();
        if (keys.length > MEDIA_MAX) await Promise.all(keys.slice(0, keys.length - MEDIA_MAX).map(k => cache.delete(k)));
      }));
    }
    return res;
  });
  if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh.catch(() => Response.error());
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    const logoUrl = API_ORIGIN && url.origin === API_ORIGIN && url.pathname.startsWith('/api/logos/');
    if (logoUrl || url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') event.respondWith(media(event));
    return; // prices, news and charts go straight to the network; the pages keep their own last good copy
  }
  if (url.pathname === '/sw.js' || url.pathname === '/version.json') return; // always live: update checks and connection checks
  if (request.mode === 'navigate') { event.respondWith(page(event)); return; }
  if (/\.(css|js|json|svg|png|jpg|webp|ico|woff2?|webmanifest)$/.test(url.pathname)) event.respondWith(asset(event));
});

// ---------------------------------------------------------------------------------------------------------
// Push notifications
//
// The server sends a small encrypted JSON message ({ kind, title, body, tag, url, ... }). Here it becomes a
// system notification; tapping it opens the right screen inside the app. Nothing secret is ever stored in this
// file: the only credential the worker can use is the device's own token, saved by the page in PUSH_AUTH.
const PUSH_AUTH = 'cmpush-v1';           // not named cm-/cm3-, so version clean-ups never delete it
const PUSH_AUTH_URL = '/__cm/push-auth';
const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';     // white-on-transparent: Android draws only its shape in the status bar
const KINDS = ['target', 'milestone', 'digest', 'test'];

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** Only same-site addresses are ever opened, whatever a message says. */
function appPath(raw) {
  try {
    const u = new URL(raw || '/', self.location.origin);
    if (u.origin !== self.location.origin || u.pathname === '/app' || u.pathname.startsWith('/app/') || u.pathname === '/sw.js') return '/';
    return u.pathname + u.search + u.hash;
  } catch { return '/'; }
}

function cleanMessage(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const kind = KINDS.includes(d.kind) ? d.kind : 'info';
  return {
    kind,
    title: clip(d.title, 90) || 'Cryptomium',
    body: clip(d.body, 220),
    tag: /^[A-Za-z0-9_-]{1,64}$/.test(d.tag || '') ? d.tag : 'cm-alert',
    url: appPath(d.url),
    ticker: /^[A-Za-z0-9]{1,12}$/.test(d.ticker || '') ? d.ticker : '',
    id: /^[A-Za-z0-9_-]{1,40}$/.test(d.id || '') ? d.id : '',
    price: Number.isFinite(d.price) ? d.price : null,
    ts: Number.isFinite(d.ts) ? d.ts : Date.now(),
    quiet: d.quiet === true,
  };
}

const ACTIONS = {
  target: [{ action: 'open', title: 'View chart' }, { action: 'manage', title: 'Manage alerts' }],
  milestone: [{ action: 'open', title: 'View chart' }, { action: 'markets', title: 'Overview' }],
  digest: [{ action: 'markets', title: 'Overview' }],
};

// "Hide amounts" (Settings, Notifications): say that something happened, without the numbers.
async function hideAmounts() {
  try { const hit = await (await caches.open(PUSH_AUTH)).match(PUSH_AUTH_URL); return hit ? Boolean((await hit.json()).hide) : false; } catch { return false; }
}
function withoutAmounts(msg) {
  if (msg.kind === 'target') return { ...msg, title: `${msg.ticker || 'A coin'} alert reached`, body: 'Open Cryptomium to see it.' };
  if (msg.kind === 'milestone') return { ...msg, title: `${msg.ticker || 'A coin'} milestone`, body: 'Open Cryptomium to see it.' };
  if (msg.kind === 'digest') return { ...msg, body: 'Open Cryptomium to see it.' };
  return msg;
}

async function onPush(event) {
  let raw = null;
  try { raw = event.data ? event.data.json() : null; } catch { try { raw = { body: event.data.text() }; } catch { raw = null; } }
  let msg = cleanMessage(raw);
  if (await hideAmounts()) msg = withoutAmounts(msg);
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // Tell open windows (the app turns it into an in-app message and marks the alert as reached).
  wins.forEach(w => { try { w.postMessage({ cm: 'push', msg }); } catch { /* window going away */ } });
  // While the person is looking at the app, the in-app message is enough (browsers allow this). Otherwise, and
  // always for the "send a test" button, show a real notification.
  const looking = wins.some(w => w.focused && w.visibilityState === 'visible');
  if (looking && msg.kind !== 'test') return;
  await self.registration.showNotification(msg.title, {
    body: msg.body,
    tag: msg.tag,
    renotify: true,
    icon: ICON,
    badge: BADGE,
    timestamp: msg.ts,
    silent: msg.quiet,                       // quiet hours: it still arrives, without sound or buzz
    ...(msg.quiet ? {} : { vibrate: [120, 60, 120] }),
    actions: ACTIONS[msg.kind] || [],
    data: { url: msg.url, kind: msg.kind, ticker: msg.ticker, id: msg.id },
  });
}
self.addEventListener('push', event => event.waitUntil(onPush(event)));

async function openApp(path) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const shell = wins.find(w => new URL(w.url).pathname === '/app');
  const target = shell || wins[0];
  if (target) {
    try { await target.focus(); } catch { /* not allowed: fall through to the message below */ }
    if (shell) { shell.postMessage({ cm: 'open', url: path }); return; }       // installed app: the shell opens it on top of the current screen
    try { const moved = await target.navigate(new URL(path, self.location.origin).href); if (moved) return; } catch { /* use a new window */ }
  }
  await self.clients.openWindow(path); // app closed: a fresh launch (an installed phone app is handed to its shell by the page itself)
}

self.addEventListener('notificationclick', event => {
  const n = event.notification;
  n.close();
  const d = n.data || {};
  let path = appPath(d.url);
  if (event.action === 'manage') path = '/settings/alerts';
  else if (event.action === 'markets') path = '/markets';
  event.waitUntil(openApp(path));
});

// The browser can replace a subscription on its own. Re-subscribe and tell the server, without the app being open.
const b64ToBytes = s => { const p = s.replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(p + '='.repeat((4 - (p.length % 4)) % 4)); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
async function resubscribe(event) {
  const hit = await (await caches.open(PUSH_AUTH)).match(PUSH_AUTH_URL);
  if (!hit) return;
  const auth = await hit.json();
  if (!auth || !auth.api || !auth.id || !auth.token || !auth.key) return;
  let sub = event.newSubscription;
  if (!sub) sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey) || b64ToBytes(auth.key) });
  await fetch(`${auth.api}/api/push/devices/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.id}.${auth.token}` },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
}
self.addEventListener('pushsubscriptionchange', event => event.waitUntil(resubscribe(event).catch(() => {})));
