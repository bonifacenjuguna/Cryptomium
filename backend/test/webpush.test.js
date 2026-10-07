import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  generateVapidKeys, encryptPayload, decryptPayload, vapidAuthorization, checkEndpoint, createWebPush, isValidPublicKey, fromB64u,
} from '../src/webpush.js';

// A browser-side subscription, generated here the way a browser would.
function makeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123def456ghi789') {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    endpoint,
    p256dh: ua.getPublicKey().toString('base64url'),
    auth: auth.toString('base64url'),
    uaPrivate: ua.getPrivateKey().toString('base64url'),
  };
}

test('encryption matches the RFC 8291 appendix A test vector exactly', () => {
  const msg = encryptPayload({
    plaintext: 'When I grow up, I want to be a watermelon',
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    ephemeral: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  });
  assert.equal(
    msg.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
  );
});

test('a message decrypts with the subscriber key, with and without padding', () => {
  const sub = makeSubscription();
  for (const padTo of [0, 64]) {
    const msg = encryptPayload({ plaintext: JSON.stringify({ title: 'BTC', body: 'is above $90,000' }), p256dh: sub.p256dh, auth: sub.auth, padTo });
    const out = decryptPayload({ message: msg, uaPrivate: sub.uaPrivate, uaPublic: sub.p256dh, auth: sub.auth });
    assert.deepEqual(JSON.parse(out.toString()), { title: 'BTC', body: 'is above $90,000' });
    if (padTo) assert.equal((msg.length - 86 - 16) % padTo, 0);
  }
});

test('a different subscriber cannot read the message', () => {
  const a = makeSubscription();
  const b = makeSubscription();
  const msg = encryptPayload({ plaintext: 'secret', p256dh: a.p256dh, auth: a.auth });
  assert.throws(() => decryptPayload({ message: msg, uaPrivate: b.uaPrivate, uaPublic: b.p256dh, auth: b.auth }));
});

test('bad subscription keys and oversized payloads are rejected', () => {
  const sub = makeSubscription();
  assert.throws(() => encryptPayload({ plaintext: 'x', p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: sub.auth }), /valid P-256/);
  assert.throws(() => encryptPayload({ plaintext: 'x', p256dh: sub.p256dh, auth: 'AAAA' }), /16 bytes/);
  assert.throws(() => encryptPayload({ plaintext: 'x'.repeat(4000), p256dh: sub.p256dh, auth: sub.auth }), /too large/);
  assert.equal(isValidPublicKey(fromB64u(sub.p256dh)), true);
  assert.equal(isValidPublicKey(Buffer.alloc(65)), false);
});

test('VAPID header carries a valid ES256 signature, audience and expiry', () => {
  const keys = generateVapidKeys();
  const now = 1_800_000_000_000;
  const header = vapidAuthorization({ audience: 'https://fcm.googleapis.com', subject: 'mailto:ops@example.com', ...keys, now });
  const [, t, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, s] = t.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:ops@example.com');
  assert.equal(claims.exp, now / 1000 + 12 * 3600);
  const pub = fromB64u(keys.publicKey);
  const verifyKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: verifyKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), true);
});

test('only https addresses on known push services are accepted', () => {
  const ok = [
    'https://fcm.googleapis.com/fcm/send/abcdefghijklmnop',
    'https://updates.push.services.mozilla.com/wpush/v2/abcdefghijk',
    'https://web.push.apple.com/QabcdefghijklmnopQ',
    'https://wns2-par02p.notify.windows.com/w/?token=abcdefgh',
  ];
  for (const e of ok) assert.ok(checkEndpoint(e), e);
  const bad = [
    'http://fcm.googleapis.com/fcm/send/abcdefghijklmnop',          // not https
    'https://localhost/fcm/send/abcdefghijklmnop',
    'https://169.254.169.254/latest/meta-data/aaaaaaaaaa',          // cloud metadata
    'https://10.0.0.5/push/aaaaaaaaaaaaaaaaaaaa',
    'https://fcm.googleapis.com.evil.example/fcm/send/abcdefg',     // look-alike
    'https://evilfcm.googleapis.com.example.com/aaaaaaaaaaaaa',
    'https://user:pw@fcm.googleapis.com/fcm/send/abcdefghijkl',     // credentials
    'https://fcm.googleapis.com:8443/fcm/send/abcdefghijklmn',      // odd port
    'ftp://fcm.googleapis.com/aaaaaaaaaaaaaaaaaaaaaaaa',
    'not a url at all, definitely not a url',
    '', null, undefined, 42,
  ];
  for (const e of bad) assert.equal(checkEndpoint(e), null, String(e));
  assert.ok(checkEndpoint('https://push.example.org/aaaaaaaaaaaaaaaaaaaaa', ['push.example.org']));
});

function sender(fetchImpl) {
  const keys = generateVapidKeys();
  return createWebPush({ ...keys, subject: 'mailto:ops@example.com', fetchImpl });
}

test('send() posts an encrypted body with VAPID, TTL, urgency and topic, and never follows redirects', async () => {
  const sub = makeSubscription();
  let seen;
  const wp = sender(async (url, init) => { seen = { url, init }; return { status: 201 }; });
  const r = await wp.send(sub, { title: 'Hi' }, { ttl: 600, urgency: 'high', topic: 'tgt-abc' });
  assert.deepEqual(r, { ok: true, status: 201, gone: false, retry: false });
  assert.equal(seen.url, sub.endpoint);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.redirect, 'manual');
  assert.match(seen.init.headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(seen.init.headers.TTL, '600');
  assert.equal(seen.init.headers.Urgency, 'high');
  assert.equal(seen.init.headers.Topic, 'tgt-abc');
  const out = decryptPayload({ message: seen.init.body, uaPrivate: sub.uaPrivate, uaPublic: sub.p256dh, auth: sub.auth });
  assert.deepEqual(JSON.parse(out), { title: 'Hi' });
});

test('send() tells dead subscriptions from retryable failures', async () => {
  const sub = makeSubscription();
  const answer = status => sender(async () => ({ status })).send(sub, { a: 1 });
  assert.equal((await answer(410)).gone, true);
  assert.equal((await answer(404)).gone, true);
  assert.deepEqual([(await answer(429)).retry, (await answer(503)).retry], [true, true]);
  const rejected = await answer(403);
  assert.deepEqual([rejected.gone, rejected.retry, rejected.reason], [false, false, 'vapid-rejected']);
  const net = await sender(async () => { throw new Error('boom'); }).send(sub, { a: 1 });
  assert.deepEqual([net.ok, net.gone, net.retry], [false, false, true]);
});

test('send() refuses an endpoint outside the allowlist without any network call', async () => {
  let called = false;
  const wp = sender(async () => { called = true; return { status: 201 }; });
  const r = await wp.send({ ...makeSubscription(), endpoint: 'https://169.254.169.254/latest/aaaaaaaaaaaaa' }, { a: 1 });
  assert.equal(called, false);
  assert.deepEqual([r.ok, r.gone, r.reason], [false, true, 'endpoint-not-allowed']);
});

test('start-up fails loudly on broken keys or subject', () => {
  const keys = generateVapidKeys();
  assert.throws(() => createWebPush({ ...keys, privateKey: 'AAAA', subject: 'mailto:a@b.co' }));
  assert.throws(() => createWebPush({ ...keys, subject: 'ops@example.com' }), /VAPID_SUBJECT/);
});

test('generated VAPID keys are always a valid 32-byte / 65-byte pair (leading-zero keys included)', () => {
  for (let i = 0; i < 3000; i++) {
    const k = generateVapidKeys();
    assert.equal(fromB64u(k.privateKey).length, 32);
    assert.equal(fromB64u(k.publicKey).length, 65);
    createWebPush({ ...k, subject: 'mailto:a@b.co' });
  }
});
