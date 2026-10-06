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

async function page(event) {
  const { request } = event;
  const url = new URL(request.url);
  const hit = await fromShell(url.pathname.replace(/\/+$/, '') || '/');
  if (hit) return hit;
  try {
    const res = await withTimeout(fetch(request), 5000);
    if (res && res.ok) { const copy = res.clone(); event.waitUntil(caches.open(PAGES).then(c => c.put(url.pathname, copy))); }
    return res;
  } catch {
    // Offline and never saved: any coin address still opens the generic coin page, which uses the saved prices.
    if (/^\/coin\/[^/]+$/.test(url.pathname)) { const generic = await fromShell('/coin'); if (generic) return generic; }
    return (await fromShell('/offline')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function asset(event) {
  const { request } = event;
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
