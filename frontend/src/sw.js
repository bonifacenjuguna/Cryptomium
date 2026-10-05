// Cryptomium service worker: keeps the app opening instantly and shows a friendly page when offline.
// Only this site's own files are handled. Prices and news come from the backend (another address) and are never cached here.
const VERSION = '__VERSION__';
const STATIC = `cm-static-${VERSION}`;
const PAGES = `cm-pages-${VERSION}`;
const SHELL = ['/offline', '/favicon.svg', '/icons/icon-192.png', '/style.css?v=__VERSION__', '/theme-init.js?v=__VERSION__'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('cm-') && k !== STATIC && k !== PAGES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const withTimeout = (p, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); });

async function networkFirst(request, cacheName, ms) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(request), ms);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: false });
    if (hit) return hit;
    throw new Error('offline');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  const fresh = fetch(request).then(res => { if (res && res.ok) cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await fresh) || Response.error();
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts, the price service and logos go straight to the network

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, PAGES, 4000).catch(async () => (await caches.match('/offline')) || new Response('Offline', { status: 503 }))
    );
    return;
  }
  if (url.pathname === '/config.js' || url.pathname === '/coins.json' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(networkFirst(request, STATIC, 3000).catch(() => Response.error()));
    return;
  }
  if (/\.(css|js|svg|png|jpg|webp|woff2?|webmanifest)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
