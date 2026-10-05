// Price targets that live on this device. While Cryptomium is open in a browser tab,
// every price reading is checked against them; a target that is reached shows a message
// and, if the visitor allowed it, a browser notification. They are never sent anywhere.
import { store, money, toast, prefs } from './common.js';
import { loadMarket } from './intel.js';

const KEY = 'cm-targets';

export function loadTargets() {
  try {
    const list = JSON.parse(store.get(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function save(list) {
  store.set(KEY, JSON.stringify(list));
  document.dispatchEvent(new CustomEvent('cm:targets'));
}

/** dir: 'above' | 'below' (price is in US dollars), 'move' (price is a 24h change in percent), 'ath' | 'atl' (new all-time high / low, price unused). Returns the new target. */
export function addTarget({ ticker, dir, price }) {
  const list = loadTargets();
  const target = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ticker, dir, price, created: Date.now() };
  list.unshift(target);
  save(list.slice(0, 50));
  return target;
}
export function removeTarget(id) { save(loadTargets().filter(t => t.id !== id)); }
export function clearReached() { save(loadTargets().filter(t => !t.firedAt)); }
export function rearm(id) {
  save(loadTargets().map(t => (t.id === id ? { ...t, firedAt: undefined, firedPrice: undefined } : t)));
}

export function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    [[880, 0], [1320, 0.14]].forEach(([f, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.45);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* sound is optional */ }
}

export function describe(t, stable = false) {
  if (t.dir === 'move') return `moves ${t.price}% or more in 24 hours`;
  if (t.dir === 'ath') return 'reaches a new all-time high';
  if (t.dir === 'atl') return 'reaches a new all-time low';
  return `${t.dir === 'above' ? 'rises to or above' : 'falls to or below'} ${money(t.price, { stable })}`;
}

function announce(t, coin) {
  if (prefs.get('sound')) chime();
  const text = t.dir === 'above' || t.dir === 'below'
    ? `${t.ticker} ${t.dir === 'above' ? 'is above' : 'is below'} ${money(t.price, { stable: coin.stable })}. Now ${money(coin.price, { stable: coin.stable })}.`
    : `${t.ticker} ${describe(t)}. Now ${money(coin.price, { stable: coin.stable })}.`;
  toast(text, { kind: t.dir === 'above' || t.dir === 'ath' || (t.dir === 'move' && coin.change24h > 0) ? 'up' : 'down', ms: 12000, href: '/coin/' + t.ticker });
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Cryptomium price alert', { body: text, tag: 'cm-' + t.id });
    }
  } catch { /* notifications are optional */ }
}

let market = null;
function reached(t, coin) {
  if (t.dir === 'above') return coin.price >= t.price;
  if (t.dir === 'below') return coin.price <= t.price;
  if (t.dir === 'move') return typeof coin.change24h === 'number' && Math.abs(coin.change24h) >= t.price;
  const m = market?.[t.ticker];
  if (t.dir === 'ath') return m?.ath > 0 && coin.price >= m.ath;
  if (t.dir === 'atl') return m?.atl > 0 && coin.price <= m.atl;
  return false;
}

function check(data) {
  const list = loadTargets();
  if (!list.some(t => !t.firedAt)) return;
  if (!market && list.some(t => !t.firedAt && (t.dir === 'ath' || t.dir === 'atl'))) loadMarket().then(m => { market = m.coins; }).catch(() => {});
  let changed = false;
  for (const t of list) {
    if (t.firedAt) continue;
    const coin = data.coins.find(c => c.ticker === t.ticker);
    if (!coin || !(coin.price > 0)) continue;
    if (reached(t, coin)) {
      t.firedAt = Date.now();
      t.firedPrice = coin.price;
      changed = true;
      announce(t, coin);
    }
  }
  if (changed) save(list);
}

let started = false;
export function start() {
  if (started) return;
  started = true;
  document.addEventListener('cm:prices', e => check(e.detail));
}
