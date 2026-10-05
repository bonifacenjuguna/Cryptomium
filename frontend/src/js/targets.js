// Price targets that live on this device. While Cryptomium is open in a browser tab,
// every price reading is checked against them; a target that is reached shows a message
// and, if the visitor allowed it, a browser notification. They are never sent anywhere.
import { store, money, toast, prefs } from './common.js';

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

/** `price` is in US dollars. Returns the new target. */
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

function announce(t, coin) {
  if (prefs.get('sound')) chime();
  const word = t.dir === 'above' ? 'is above' : 'is below';
  const text = `${t.ticker} ${word} ${money(t.price, { stable: coin.stable })}. Now ${money(coin.price, { stable: coin.stable })}.`;
  toast(text, { kind: t.dir === 'above' ? 'up' : 'down', ms: 12000, href: '/coin/' + t.ticker });
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Cryptomium price alert', { body: text, tag: 'cm-' + t.id });
    }
  } catch { /* notifications are optional */ }
}

function check(data) {
  const list = loadTargets();
  if (!list.some(t => !t.firedAt)) return;
  let changed = false;
  for (const t of list) {
    if (t.firedAt) continue;
    const coin = data.coins.find(c => c.ticker === t.ticker);
    if (!coin || !(coin.price > 0)) continue;
    const hit = t.dir === 'above' ? coin.price >= t.price : coin.price <= t.price;
    if (hit) {
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
