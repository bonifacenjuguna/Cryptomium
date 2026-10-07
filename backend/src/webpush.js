// Web Push without extra packages: VAPID authentication (RFC 8292) and payload encryption (RFC 8291,
// "aes128gcm"), built only on Node's own crypto. Everything outside the network call is a pure function,
// so it is unit-tested against the RFC's published test vector.
//
// The PRIVATE key never leaves this file's caller (config -> createWebPush). Only the public key is ever
// handed to a browser.
import crypto from 'node:crypto';

const b64u = buf => Buffer.from(buf).toString('base64url');
export const fromB64u = s => Buffer.from(String(s), 'base64url');

const RECORD_SIZE = 4096;
export const MAX_PLAINTEXT = 3500; // push services only guarantee ~4 KB bodies; alerts are far smaller

/** Generates a VAPID key pair (base64url). Used once by scripts/generateVapidKeys.js. */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  // Node drops leading zero bytes of the private key; a P-256 private key is always exactly 32 bytes.
  const priv = Buffer.alloc(32);
  ecdh.getPrivateKey().copy(priv, 32 - ecdh.getPrivateKey().length);
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(priv) };
}

/** True for an uncompressed P-256 point that is really on the curve (a browser's p256dh key). */
export function isValidPublicKey(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 65 || buf[0] !== 4) return false;
  try {
    const probe = crypto.createECDH('prime256v1');
    probe.generateKeys();
    probe.computeSecret(buf); // throws when the point is not on the curve
    return true;
  } catch {
    return false;
  }
}

function privateKeyObject(privateKeyB64, publicKeyB64) {
  const d = fromB64u(privateKeyB64);
  const pub = fromB64u(publicKeyB64);
  if (d.length !== 32 || !isValidPublicKey(pub)) throw new Error('VAPID keys are not a valid P-256 pair');
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

/** Signed VAPID header value for one push service (`audience` = the endpoint's origin). */
export function vapidAuthorization({ audience, subject, publicKey, privateKey, now = Date.now(), ttlSec = 12 * 3600 }) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + ttlSec, sub: subject }));
  const data = `${header}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: privateKeyObject(privateKey, publicKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${publicKey}`;
}

const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

/**
 * Encrypts `plaintext` for one subscription (RFC 8291 section 3). `ephemeral` and `salt` exist for the test vector only.
 * `padTo` rounds the message up to a multiple of that many bytes so its length reveals less.
 */
export function encryptPayload({ plaintext, p256dh, auth, ephemeral = null, salt = null, padTo = 0 }) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (!isValidPublicKey(uaPublic)) throw new Error('Subscription key is not a valid P-256 point');
  if (authSecret.length !== 16) throw new Error('Subscription auth secret must be 16 bytes');
  const body = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext));
  if (body.length > MAX_PLAINTEXT) throw new Error('Push payload is too large');

  const as = crypto.createECDH('prime256v1');
  if (ephemeral) as.setPrivateKey(fromB64u(ephemeral));
  else as.generateKeys();
  const asPublic = as.getPublicKey();
  const shared = as.computeSecret(uaPublic);
  const recordSalt = salt ? fromB64u(salt) : crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(shared, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, recordSalt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, recordSalt, Buffer.from('Content-Encoding: nonce\0'), 12);

  // One record: data, then the 0x02 "last record" delimiter, then optional zero padding.
  let padded = Buffer.concat([body, Buffer.from([2])]);
  if (padTo > 0 && padded.length % padTo) padded = Buffer.concat([padded, Buffer.alloc(padTo - (padded.length % padTo))]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([recordSalt, rs, Buffer.from([asPublic.length]), asPublic, encrypted]);
}

/** Reverse of encryptPayload for a subscription's own private key. Used by the tests (and handy for debugging). */
export function decryptPayload({ message, uaPrivate, uaPublic, auth }) {
  const salt = message.subarray(0, 16);
  const idLen = message[20];
  const asPublic = message.subarray(21, 21 + idLen);
  const encrypted = message.subarray(21 + idLen);
  const ua = crypto.createECDH('prime256v1');
  ua.setPrivateKey(fromB64u(uaPrivate));
  const shared = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), fromB64u(uaPublic), asPublic]);
  const ikm = hkdf(shared, fromB64u(auth), keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
  const padded = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()]);
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  if (end === 0 || padded[end - 1] !== 2) throw new Error('Bad padding');
  return padded.subarray(0, end - 1);
}

// Push services we are willing to talk to. A subscription's endpoint is a URL chosen by the visitor's
// browser, so without this list a crafted endpoint could make the server call internal addresses (SSRF).
const BASE_HOSTS = [
  'fcm.googleapis.com',               // Chrome, Edge, Brave, Opera, Samsung Internet on Android
  'android.googleapis.com',
  'push.services.mozilla.com',        // Firefox (updates.push.services.mozilla.com and regional)
  'push.apple.com',                   // Safari / installed web apps on iOS and macOS (web.push.apple.com)
  'notify.windows.com',               // Edge on Windows (wns2-*.notify.windows.com)
];

/** Returns the parsed URL when `endpoint` is an https address on a known push service, otherwise null. */
export function checkEndpoint(endpoint, extraHosts = []) {
  if (typeof endpoint !== 'string' || endpoint.length < 20 || endpoint.length > 2048) return null;
  let u;
  try { u = new URL(endpoint); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || u.hash) return null;
  const host = u.hostname.toLowerCase();
  const ok = [...BASE_HOSTS, ...extraHosts].some(h => host === h || host.endsWith('.' + h));
  return ok ? u : null;
}

export function createWebPush({ publicKey, privateKey, subject, fetchImpl = fetch, timeoutMs = 10_000, extraHosts = [], now = () => Date.now() }) {
  privateKeyObject(privateKey, publicKey); // fail at start-up, not at the first alert
  if (!/^(mailto:|https:\/\/)/.test(subject || '')) throw new Error('VAPID_SUBJECT must be a mailto: or https:// address');
  const tokens = new Map(); // audience -> { header, exp }

  const authFor = audience => {
    const hit = tokens.get(audience);
    if (hit && hit.exp > now() + 60 * 60_000) return hit.header;
    const header = vapidAuthorization({ audience, subject, publicKey, privateKey, now: now() });
    tokens.set(audience, { header, exp: now() + 12 * 3600_000 });
    return header;
  };

  /**
   * Sends one notification. Never throws for push-service answers; returns
   *   { ok, status, gone, retry }   gone = the subscription is dead (404/410) and must be deleted,
   *                                 retry = worth trying again later (429, 5xx, network error).
   */
  async function send(subscription, payload, { ttl = 3600, urgency = 'normal', topic = '' } = {}) {
    const url = checkEndpoint(subscription.endpoint, extraHosts);
    if (!url) return { ok: false, status: 0, gone: true, retry: false, reason: 'endpoint-not-allowed' };
    let body;
    try {
      body = encryptPayload({ plaintext: JSON.stringify(payload), p256dh: subscription.p256dh, auth: subscription.auth, padTo: 64 });
    } catch (err) {
      return { ok: false, status: 0, gone: true, retry: false, reason: err.message };
    }
    const headers = {
      Authorization: authFor(url.origin),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(Math.max(0, Math.floor(ttl))),
      Urgency: urgency,
    };
    if (/^[A-Za-z0-9_-]{1,32}$/.test(topic)) headers.Topic = topic;
    try {
      const res = await fetchImpl(url.href, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      const status = res.status;
      if (status >= 200 && status < 300) return { ok: true, status, gone: false, retry: false };
      if (status === 404 || status === 410) return { ok: false, status, gone: true, retry: false };
      if (status === 401 || status === 403) { tokens.delete(url.origin); return { ok: false, status, gone: false, retry: false, reason: 'vapid-rejected' }; }
      return { ok: false, status, gone: false, retry: status === 429 || status >= 500, reason: `http-${status}` };
    } catch (err) {
      return { ok: false, status: 0, gone: false, retry: true, reason: err.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
  }

  return { send, publicKey };
}
