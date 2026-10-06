// Connection health, last-known-good data and the offline banner.
//
// One place answers "can the app reach the internet, and is the data on screen live?":
//   live     everything is fine
//   offline  the device (or at least this site) cannot be reached
//   api      the device is online but the live price service is not delivering
// Pages keep working in every state: the last good copy of each answer is kept (Cache API) and shown,
// clearly labelled, instead of an empty or broken screen. Nothing here reloads the page.
// No imports on purpose: common.js builds on this file, never the other way round.

const DATA_CACHE = 'cmdata-v1';
const DATA_MAX = 160;
const DISMISS_KEY = 'cm-net-dismissed';

const safe = {
  get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
  set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch { /* private mode */ } },
  del(k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch { /* private mode */ } },
};

// ---------- State ----------
const st = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  apiOk: true,            // false when live prices stopped arriving while the device is online
  lastLiveAt: 0,          // when the newest live prices were produced (ms)
  everLive: false,
  failures: 0,            // getJSON failures in a row
  degraded: new Map(),    // path -> true while that answer came from the saved copy or the server said it is stale
  recovered: 0,
};
const listeners = new Set();
const recoverFns = new Set();
let probing = null;

let lastStatus = null;
export const status = () => (!st.online ? 'offline' : !st.apiOk ? 'api' : 'live');
export const info = () => ({ status: status(), online: st.online, apiOk: st.apiOk, lastLiveAt: st.lastLiveAt, degraded: [...st.degraded.keys()] });
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
/** fn runs once each time the connection or the live service comes back. It must not reload the page. */
export const onRecover = fn => { recoverFns.add(fn); return () => recoverFns.delete(fn); };

function emit() {
  const now = status();
  if (now === lastStatus) { listeners.forEach(fn => fn(now, false)); return; }
  const was = lastStatus;
  lastStatus = now;
  const recovering = now === 'live' && was !== 'live';
  if (recovering) { safe.del(DISMISS_KEY, true); st.recovered = Date.now(); }
  listeners.forEach(fn => fn(now, true));
  if (recovering) [...recoverFns].forEach(fn => { try { fn(); } catch { /* one failing page must not stop the others */ } });
  document.dispatchEvent(new CustomEvent('cm:net', { detail: info() }));
}

/** Is this site reachable at all? Any answer (even a 404) means yes; only a network error means no. */
export function probe() {
  if (probing) return probing;
  probing = (async () => {
    if (navigator.onLine === false) return false;
    try {
      await fetch('/version.json?probe=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      return true;
    } catch { return false; }
  })().finally(() => { probing = null; });
  return probing;
}

async function recheck() {
  st.online = await probe();
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => { st.online = false; emit(); });
  window.addEventListener('online', async () => {
    st.online = true; // optimistic, then confirmed
    const ok = await probe();
    st.online = ok;
    if (ok) { st.failures = 0; st.apiOk = true; }
    emit();
  });
}

lastStatus = status(); // a page that opens while offline starts in the offline state, so coming back counts as a recovery

// ---------- Signals from the data layer ----------
/** A price reading arrived. `data.stale` / an old `updatedAt` means the server itself is serving an old copy. */
export function feedOk(data) {
  const at = Date.parse(data?.updatedAt || '') || Date.now();
  const refresh = Number(data?.refreshMs) || 5000;
  const tooOld = Date.now() - at > Math.max(refresh * 6, 90_000);
  st.online = true;
  st.failures = 0;
  st.lastLiveAt = at;
  st.everLive = true;
  st.apiOk = !(data?.stale || tooOld);
  emit();
}
/** The live feed has been quiet for `ms`. Decide whether the device or the service is the problem. */
export async function feedQuiet(ms) {
  if (ms < 25_000) return;
  const reachable = await probe();
  st.online = reachable;
  if (reachable) st.apiOk = false;
  emit();
}
export function fetchFailed(path) {
  st.failures += 1;
  if (st.failures >= 2) recheck();
  noteDegraded(path, true);
}
export function fetchOk(path, payload) {
  st.failures = 0;
  noteDegraded(path, Boolean(payload && payload.stale));
}
export function noteDegraded(path, bad) {
  const key = String(path).split('?')[0];
  if (bad) st.degraded.set(key, true); else st.degraded.delete(key);
}

// ---------- Last known good ----------
// Each successful answer is saved under its address with the time it was fetched. When a request fails,
// the saved copy is returned (and labelled) instead of nothing.
const memory = new Map();
let saves = 0;
async function dataCache() {
  if (typeof caches === 'undefined') return null;
  try { return await caches.open(DATA_CACHE); } catch { return null; }
}
export async function saveGood(key, data) {
  const entry = { savedAt: Date.now(), data };
  memory.set(key, entry);
  const c = await dataCache();
  if (!c) return;
  try {
    await c.put(new Request(location.origin + '/__data/' + encodeURIComponent(key)), new Response(JSON.stringify(entry), { headers: { 'Content-Type': 'application/json' } }));
    if (++saves % 25 === 0) {
      const keys = await c.keys();
      if (keys.length > DATA_MAX) await Promise.all(keys.slice(0, keys.length - DATA_MAX).map(k => c.delete(k)));
    }
  } catch { /* storage full or blocked: the in-memory copy still works */ }
}
export async function loadGood(key) {
  const c = await dataCache();
  if (c) {
    try {
      const res = await c.match(new Request(location.origin + '/__data/' + encodeURIComponent(key)));
      if (res) return await res.json();
    } catch { /* fall through */ }
  }
  return memory.get(key) || null;
}
export async function clearGood() {
  memory.clear();
  try { await caches.delete(DATA_CACHE); } catch { /* nothing to clear */ }
  safe.del('cm-last-prices');
}
export async function goodCount() {
  const c = await dataCache();
  try { return c ? (await c.keys()).length : memory.size; } catch { return memory.size; }
}

// Prices are tiny and needed on the very first frame, so their last copy lives in localStorage (read instantly).
let priceSaved = 0;
export function savePrices(data) {
  if (Date.now() - priceSaved < 10_000 || !data || data.stale) return;
  priceSaved = Date.now();
  safe.set('cm-last-prices', JSON.stringify({ savedAt: priceSaved, data }));
}
export function loadPrices() {
  try {
    const v = JSON.parse(safe.get('cm-last-prices') || 'null');
    if (v && v.data && Array.isArray(v.data.coins) && v.data.coins.length) return v;
  } catch { /* ignore */ }
  return null;
}

// ---------- Wording ----------
export function agoText(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}
export const WORDS = {
  offline: { title: "You're offline", chip: 'Offline', line: 'Offline — showing last available data.', body: "Showing the latest data from your last successful update. Some live information may be unavailable. We'll reconnect automatically when your connection returns." },
  api: { title: 'Live data is temporarily unavailable', chip: 'Delayed', line: 'Live data temporarily unavailable. Showing the latest available data.', body: "Your connection is fine, but the price service isn't delivering right now. Showing the latest available data. We'll keep trying and update on our own." },
};

// ---------- Banner and header chip ----------
const ICON = {
  offline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-9-3.7M5 12.9a10 10 0 0 1 3.4-2.1M19 12.9a10 10 0 0 0-3.1-2M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/></svg>',
  api: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7"/></svg>',
};

let banner = null, chip = null, hideTimer = 0, tick = 0, mounted = false;
const motionOff = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';
const dismissedFor = () => safe.get(DISMISS_KEY, true) || '';

export function lastUpdatedLabel() { const t = lastUpdatedMs(); return t ? agoText(t) : ''; }
function lastUpdatedMs() {
  if (st.lastLiveAt) return st.lastLiveAt;
  const saved = loadPrices();
  return saved ? Date.parse(saved.data.updatedAt || '') || saved.savedAt : 0;
}

function paintFresh(s) {
  document.querySelectorAll('[data-fresh]').forEach(n => {
    if (s === 'live') { n.hidden = true; return; }
    const t = lastUpdatedMs();
    n.hidden = false;
    n.textContent = (t ? 'Last updated ' + agoText(t) + '. ' : '') + WORDS[s].line;
    n.dataset.state = s;
  });
}

function paintBanner(s, changed) {
  if (!banner) return;
  if (s === 'live' && !changed && banner.dataset.state === 'ok') return; // the "Back online" note is on its way out by itself
  clearTimeout(hideTimer);
  document.documentElement.toggleAttribute('data-net', s !== 'live');
  paintFresh(s);
  if (chip) {
    chip.hidden = s === 'live';
    chip.dataset.state = s;
    if (s !== 'live') {
      chip.querySelector('.nc-t').textContent = WORDS[s].chip;
      chip.setAttribute('aria-label', WORDS[s].title + '. Tap for details.');
    }
  }
  if (s === 'live') {
    if (changed && st.recovered && Date.now() - st.recovered < 2000) {
      // Tell people it is fixed, briefly, then get out of the way.
      banner.dataset.state = 'ok';
      banner.querySelector('.nb-icon').innerHTML = ICON.ok;
      banner.querySelector('b').textContent = 'Back online';
      banner.querySelector('.nb-body').textContent = 'Prices are updating again.';
      banner.querySelector('.nb-fresh').textContent = '';
      banner.querySelector('.nb-x').hidden = true;
      banner.classList.add('show');
      hideTimer = setTimeout(() => banner.classList.remove('show'), 2600);
    } else {
      banner.classList.remove('show');
    }
    return;
  }
  const t = lastUpdatedMs();
  banner.dataset.state = s;
  banner.querySelector('.nb-icon').innerHTML = ICON[s];
  banner.querySelector('b').textContent = WORDS[s].title;
  banner.querySelector('.nb-body').textContent = t || s === 'api' ? WORDS[s].body : "Nothing has been saved on this device yet, so prices will appear as soon as you're back online. You can still open Settings and your saved items.";
  banner.querySelector('.nb-fresh').textContent = t ? 'Last updated ' + agoText(t) : '';
  banner.querySelector('.nb-x').hidden = false;
  const dismissed = dismissedFor() === s;
  banner.classList.toggle('show', !dismissed);
}

export function showDetails() {
  const s = status();
  if (s === 'live' || !banner) return;
  safe.del(DISMISS_KEY, true);
  paintBanner(s, false);
}

/** Build the banner and the header chip. Safe to call once per page. */
export function mountStatus() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  banner = document.createElement('div');
  banner.className = 'net-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = '<span class="nb-icon"></span><div class="nb-text"><b></b><span class="nb-body"></span><small class="nb-fresh"></small></div><button class="nb-x" type="button" aria-label="Dismiss">Dismiss</button>';
  document.body.append(banner);
  banner.querySelector('.nb-x').addEventListener('click', () => {
    safe.set(DISMISS_KEY, status(), true);
    banner.classList.remove('show');
  });
  chip = document.getElementById('net-chip');
  chip?.addEventListener('click', () => (banner.classList.contains('show') ? banner.querySelector('.nb-x').click() : showDetails()));
  onChange((s, changed) => paintBanner(s, changed));
  paintBanner(status(), false);
  // "4 min ago" stays honest while the screen is open.
  tick = setInterval(() => { if (status() !== 'live') paintBanner(status(), false); }, 30_000);
  if (motionOff()) banner.classList.add('calm');
}
