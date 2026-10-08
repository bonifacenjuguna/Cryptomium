// App lock: a screen lock for people who share or lose their phone, like a banking app's.
//
//  * Unlock with the phone's own fingerprint / face / screen lock (WebAuthn "platform authenticator"), or a PIN.
//  * The PIN is kept only as a salted PBKDF2 hash. Nothing here is sent anywhere.
//  * It keeps casual access out. It does not encrypt what is stored on the device, and the page says so.
//  * Scope "app" covers everything; scope "sensitive" asks only for the Portfolio and for destructive actions.
import { el } from './common.js';

const KEY = 'cm-lock';             // { on, after, scope, pin: {salt, hash}, cred }
const LEFT = 'cm-lock-left';       // when the app was last put away
const UNL = 'cm-lock-unl';         // session flag: unlocked in this app session
const WAIT = 'cm-lock-wait';       // wrong-PIN pause
const root = document.documentElement;

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; } };
const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const num = (k, d = 0) => { try { return Number(localStorage.getItem(k)) || d; } catch { return d; } };
const flag = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* ignore */ } return null; };

export function state() {
  const c = read();
  return { on: Boolean(c.on && c.pin), after: Number.isFinite(c.after) ? c.after : 60, scope: c.scope === 'sensitive' ? 'sensitive' : 'app', pin: Boolean(c.pin), bio: Boolean(c.cred) };
}
export function set(key, value) { write({ ...read(), [key]: value }); }

// ------------------------------------------------------------------ crypto
const enc = t => new TextEncoder().encode(t);
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function derive(pin, salt) {
  const key = await crypto.subtle.importKey('raw', enc(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256));
}
export async function setPin(pin) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4 to 8 digits');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  write({ ...read(), pin: { salt: b64(salt), hash: await derive(pin, salt) } });
}
async function checkPin(pin) {
  const { pin: p } = read();
  if (!p) return false;
  const a = await derive(pin, unb64(p.salt));
  let diff = a.length ^ p.hash.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (p.hash.charCodeAt(i) || 0);
  return diff === 0;
}

// ------------------------------------------------------------------ phone unlock (fingerprint, face, screen lock)
export async function bioAvailable() {
  try { return Boolean(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch { return false; }
}
export async function enrollBio() {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'Cryptomium', id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'this-device', displayName: 'This device' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    attestation: 'none', timeout: 60000,
  } });
  set('cred', b64(cred.rawId));
}
export function forgetBio() { const c = read(); delete c.cred; write(c); }
async function verifyBio() {
  const { cred } = read();
  if (!cred) return false;
  try {
    await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: unb64(cred), transports: ['internal'] }], userVerification: 'required', timeout: 60000 } });
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------ the lock screen
function makePad(pad, press) {
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok']) {
    const b = el('button', 'lk-key' + (k === 'ok' ? ' ok' : ''), k === 'back' ? '\u232B' : k === 'ok' ? 'OK' : k);
    b.type = 'button'; b.setAttribute('aria-label', k === 'back' ? 'Delete' : k === 'ok' ? 'Next' : k);
    b.addEventListener('click', () => press(k));
    pad.append(b);
  }
}
let overlay = null;
let pending = null;

function build({ title, cancel }) {
  const box = el('div', 'lk');
  box.id = 'cm-lock';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', title);
  const mark = el('img', 'lk-mark'); mark.src = '/icons/icon-192.png'; mark.alt = ''; mark.width = 64; mark.height = 64;
  const h = el('h1', 'lk-title', title);
  const msg = el('p', 'lk-msg', ' '); msg.setAttribute('aria-live', 'polite');
  const dots = el('div', 'lk-dots'); for (let i = 0; i < 8; i++) dots.append(el('i'));
  const pad = el('div', 'lk-pad');
  const bioBtn = el('button', 'btn btn-accent lk-bio', 'Use fingerprint or face'); bioBtn.type = 'button'; bioBtn.hidden = true;
  box.append(mark, h, msg, bioBtn);
  const st = state();
  if (st.pin) box.append(dots, pad);
  if (cancel) { const c = el('button', 'btn btn-ghost lk-cancel', 'Not now'); c.type = 'button'; c.addEventListener('click', cancel); box.append(c); }
  return { box, msg, dots, pad, bioBtn };
}

function show(title, { cancelable = false } = {}) {
  if (overlay) return pending;
  pending = new Promise(resolve => {
    const done = ok => { overlay?.remove(); overlay = null; pending = null; root.classList.remove('locked'); if (ok) { flag(UNL, '1'); try { localStorage.setItem(LEFT, String(Date.now())); } catch { /* ignore */ } } resolve(ok); };
    const ui = build({ title, cancel: cancelable ? () => done(false) : null });
    overlay = ui.box;
    document.body.append(overlay);
    root.classList.add('locked');
    let entry = '';
    const paintDots = () => [...ui.dots.children].forEach((d, i) => d.classList.toggle('on', i < entry.length));
    const wait = () => Math.max(0, num(WAIT) - Date.now());
    const note = t => { ui.msg.textContent = t; };
    const submit = async () => {
      if (wait()) { note(`Too many tries. Wait ${Math.ceil(wait() / 1000)} seconds.`); entry = ''; paintDots(); return; }
      if (await checkPin(entry)) { try { localStorage.removeItem('cm-lock-fails'); } catch { /* ignore */ } done(true); return; }
      const fails = num('cm-lock-fails') + 1;
      try { localStorage.setItem('cm-lock-fails', String(fails)); if (fails % 5 === 0) localStorage.setItem(WAIT, String(Date.now() + 30000)); } catch { /* ignore */ }
      ui.box.classList.remove('shake'); void ui.box.offsetWidth; ui.box.classList.add('shake');
      try { navigator.vibrate?.(60); } catch { /* ignore */ }
      note(fails % 5 === 0 ? 'Too many tries. Wait 30 seconds.' : 'Wrong PIN. Try again.');
      entry = ''; paintDots();
    };
    const press = k => {
      if (k === 'back') entry = entry.slice(0, -1);
      else if (k === 'ok') { if (entry.length >= 4) submit(); return; }
      else if (entry.length < 8) entry += k;
      paintDots();
      note(' ');
    };
    makePad(ui.pad, press);
    addEventListener('keydown', function onKey(e) {
      if (!overlay) { removeEventListener('keydown', onKey); return; }
      if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('back'); else if (e.key === 'Enter') press('ok');
    });
    const tryBio = async () => { if (await verifyBio()) done(true); else note(state().pin ? 'Use your PIN instead.' : 'Could not unlock. Try again.'); };
    if (state().bio) {
      bioAvailable().then(ok => { if (!ok || !overlay) return; ui.bioBtn.hidden = false; ui.bioBtn.addEventListener('click', tryBio); tryBio(); });
    }
  });
  return pending;
}

// ------------------------------------------------------------------ rules
const away = () => Date.now() - num(LEFT, 0);
const expired = st => !flag(UNL) || away() >= st.after * 1000;

/** The whole-app lock for a top-level page: ask at start, and again after the app was away long enough. */
export function guard() {
  const st = state();
  if (st.on && st.scope === 'app' && expired(st)) show('Cryptomium is locked');
}

/** Sensitive things (Portfolio, deleting data). Resolves true when allowed to go ahead. */
export async function require(what = 'this') {
  const st = state();
  if (!st.on || st.scope !== 'sensitive') return true;
  if (flag(UNL) && away() < st.after * 1000) return true;
  return show(`Unlock to open ${what}`, { cancelable: true });
}

/** A page that is sensitive in itself (Portfolio): ask when it opens and again when returning after the timeout. */
export function guardPage(what, onDenied) {
  const ask = async () => { if (!(await require(what)) && onDenied) onDenied(); };
  ask();
  document.addEventListener('visibilitychange', () => { if (document.hidden) set('seen', Date.now()); else if (state().on && state().scope === 'sensitive' && away() >= state().after * 1000) { flag(UNL, null); ask(); } });
}

/** Cover for the phone's recent-apps view, and the auto-lock clock. */
export function init({ top }) {
  let cover = null;
  document.addEventListener('visibilitychange', () => {
    const st = state();
    if (document.hidden) {
      try { localStorage.setItem(LEFT, String(Date.now())); } catch { /* ignore */ }
      let wants = true; try { wants = (JSON.parse(localStorage.getItem('cm-prefs') || '{}') || {}).blurRecents !== false; } catch { /* default on */ }
      if (top && wants && !cover) { cover = el('div', 'lk-cover'); const m = el('img'); m.src = '/icons/icon-192.png'; m.alt = ''; m.width = 72; m.height = 72; cover.append(m); document.body.append(cover); }
    } else {
      cover?.remove(); cover = null;
      if (top && st.on && st.scope === 'app' && away() >= st.after * 1000) { flag(UNL, null); show('Cryptomium is locked'); }
    }
  });
  // While the app is in use, keep the clock current, so a quick reload (for example after an update) does not lock you out.
  setInterval(() => { if (!document.hidden) { try { localStorage.setItem(LEFT, String(Date.now())); } catch { /* ignore */ } } }, 15000);
  if (top) guard();
}

export const lockNow = () => { flag(UNL, null); try { localStorage.setItem(LEFT, '0'); } catch { /* ignore */ } const st = state(); if (st.on && st.scope === 'app') show('Cryptomium is locked'); };

/** Asks the person to choose a PIN (twice). Resolves the PIN, or null when they back out. */
export function choosePin(title = 'Choose a PIN') {
  return new Promise(resolve => {
    const box = el('div', 'lk'); box.id = 'cm-lock-pin'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const h = el('h1', 'lk-title', title);
    const msg = el('p', 'lk-msg', '4 to 8 digits'); msg.setAttribute('aria-live', 'polite');
    const dots = el('div', 'lk-dots'); for (let i = 0; i < 8; i++) dots.append(el('i'));
    const pad = el('div', 'lk-pad');
    const cancel = el('button', 'btn btn-ghost lk-cancel', 'Cancel'); cancel.type = 'button';
    box.append(h, msg, dots, pad, cancel);
    document.body.append(box); root.classList.add('locked');
    let first = '', entry = '';
    const finish = v => { box.remove(); root.classList.remove('locked'); resolve(v); };
    const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < entry.length));
    const press = k => {
      if (k === 'back') entry = entry.slice(0, -1);
      else if (k === 'ok') {
        if (entry.length < 4) { msg.textContent = 'Use at least 4 digits.'; return; }
        if (!first) { first = entry; entry = ''; h.textContent = 'Enter it again'; msg.textContent = 'To make sure it is right'; }
        else if (entry === first) { finish(entry); return; }
        else { first = ''; entry = ''; h.textContent = title; msg.textContent = 'They did not match. Start again.'; }
      } else if (entry.length < 8) entry += k;
      paint();
    };
    makePad(pad, press);
    cancel.addEventListener('click', () => finish(null));
  });
}

/** Proves it is the owner (to turn the lock off, change the PIN). Resolves true or false. */
export const confirmIdentity = title => (state().pin ? show(title, { cancelable: true }) : Promise.resolve(true));
