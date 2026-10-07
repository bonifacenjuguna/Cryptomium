// App lock: asks for the phone's own fingerprint, face or screen lock (WebAuthn, platform authenticator) before the app opens.
// The check happens on the device; nothing about it leaves the phone. It hides the app from whoever picks the phone up. It does
// not encrypt the data stored in the browser. Only the top page runs the gate; screens inside the app shell follow it.
const KEY = 'cm-lock';
const UNLOCK = 'cm-unlock';
const HIDDEN = 'cm-hidden';
const root = document.documentElement;

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const rand = n => crypto.getRandomValues(new Uint8Array(n));
const brand = () => (window.CRYPTOMIUM && window.CRYPTOMIUM.brand) || 'Cryptomium';

export function lockConfig() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v.id === 'string' ? { id: v.id, after: [0, 60, 300].includes(v.after) ? v.after : 60 } : null; } catch { return null; }
}
const save = cfg => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* private mode */ } };
const markUnlocked = () => { try { sessionStorage.setItem(UNLOCK, '1'); sessionStorage.removeItem(HIDDEN); } catch { /* ignore */ } };

export async function lockSupported() {
  try { return Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}

/** Ask the phone to set up its unlock method for this app. Throws if the person cancels. */
export async function enableLock(after = 60) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32), rp: { name: brand() }, user: { id: rand(16), name: 'app-lock', displayName: brand() + ' lock' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none',
    },
  });
  if (!cred) throw new Error('cancelled');
  save({ id: b64(cred.rawId), after });
  markUnlocked();
}

/** Ask the phone to confirm it is the owner. Resolves on success, throws otherwise. */
export async function verifyOwner() {
  const cfg = lockConfig();
  if (!cfg) return;
  const got = await navigator.credentials.get({
    publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(cfg.id), transports: ['internal'] }], userVerification: 'required', timeout: 60000 },
  });
  if (!got) throw new Error('cancelled');
}

export function setLockAfter(after) { const c = lockConfig(); if (c) save({ ...c, after }); }
export function disableLock() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(UNLOCK); } catch { /* ignore */ } hide(); }
export function lockNow() { try { sessionStorage.removeItem(UNLOCK); } catch { /* ignore */ } show('locked'); }

// ---- the cover
let cover = null;
function hide() { root.classList.remove('locked'); if (cover) { cover.remove(); cover = null; } }
function show(mode) {
  if (window.top !== window) return;
  root.classList.add('locked');
  if (!cover) {
    cover = document.createElement('div');
    cover.className = 'lock-screen';
    cover.setAttribute('role', 'dialog');
    cover.setAttribute('aria-label', brand() + ' is locked');
    cover.innerHTML = '<img src="/icons/icon-192.png" alt="" width="72" height="72"><h1></h1><p class="lock-msg">Use your fingerprint, face or screen lock.</p>'
      + '<button type="button" class="btn btn-accent lock-go">Unlock</button><button type="button" class="lock-reset">Can\u2019t unlock?</button>';
    cover.querySelector('h1').textContent = brand() + ' is locked';
    cover.querySelector('.lock-go').addEventListener('click', tryUnlock);
    let armed = false;
    const reset = cover.querySelector('.lock-reset');
    reset.addEventListener('click', () => {
      if (!armed) { armed = true; reset.textContent = 'Tap again to erase the app\u2019s data and unlock'; return; }
      try { Object.keys(localStorage).filter(k => k.startsWith('cm-')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); } catch { /* ignore */ }
      location.reload();
    });
    document.body.append(cover);
  }
  cover.classList.toggle('is-veil', mode === 'veil');
  if (mode === 'locked') setTimeout(tryUnlock, 250);
}
let trying = false;
async function tryUnlock() {
  if (trying || !cover) return;
  trying = true;
  const msg = cover.querySelector('.lock-msg');
  try { await verifyOwner(); markUnlocked(); hide(); } catch { msg.textContent = 'Not unlocked. Tap Unlock to try again.'; } finally { trying = false; }
}

// ---- the gate (top page only)
if (window.top === window) {
  const start = () => {
    if (!lockConfig()) { root.classList.remove('locked'); return; }
    let ok = false;
    try { ok = sessionStorage.getItem(UNLOCK) === '1'; } catch { /* ignore */ }
    if (!ok) show('locked'); else hide();
    document.addEventListener('visibilitychange', () => {
      const cfg = lockConfig();
      if (!cfg) return;
      if (document.hidden) {
        try { sessionStorage.setItem(HIDDEN, String(Date.now())); } catch { /* ignore */ }
        if (root.classList.contains('locked')) return;
        show('veil'); // the app switcher shows a plain cover, not your portfolio
        return;
      }
      let away = 0;
      try { away = Date.now() - Number(sessionStorage.getItem(HIDDEN) || Date.now()); } catch { /* ignore */ }
      if (root.classList.contains('locked') && cover && cover.classList.contains('is-veil')) {
        if (cfg.after === 0 || away >= cfg.after * 1000) { try { sessionStorage.removeItem(UNLOCK); } catch { /* ignore */ } show('locked'); } else hide();
      }
    });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
}
