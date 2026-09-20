import Redis from 'ioredis';
import { CONFIG } from './config.js';

// Two connections are required for keyspace-notification pub/sub in Redis:
// one for normal commands, one dedicated to subscribing (a subscribed
// connection can't run other commands).
export const redis = new Redis(CONFIG.redisUrl);
const subscriber = new Redis(CONFIG.redisUrl);

const MUTE_KEY_PREFIX = 'mute-expiry:';

/**
 * Schedules a mute to expire exactly at `expiresAt` (a JS Date) by setting a
 * Redis key with a TTL. When the key's TTL hits zero, Redis fires an
 * "expired" keyspace event that onMuteExpired() below is subscribed to —
 * that's what triggers the real-time auto-unmute rather than waiting for
 * the next price-poll cycle to notice the time has passed.
 */
export async function scheduleMuteExpiry(ticker, expiresAt) {
  const ttlMs = Math.max(expiresAt.getTime() - Date.now(), 1000);
  await redis.set(`${MUTE_KEY_PREFIX}${ticker}`, '1', 'PX', ttlMs);
}

export async function cancelScheduledMuteExpiry(ticker) {
  await redis.del(`${MUTE_KEY_PREFIX}${ticker}`);
}

/**
 * Wires up keyspace notification listening. Requires the Redis instance to
 * have `notify-keyspace-events` include at least "Ex" (expired events on
 * key-event channel). We attempt to set this ourselves on boot; if the
 * managed Redis provider blocks CONFIG SET, this call logs a warning and
 * the caller should enable it manually (see README).
 *
 * `onExpired(ticker)` is called the instant a scheduled mute's TTL ends.
 */
export async function initMuteExpiryListener(onExpired) {
  try {
    await redis.config('SET', 'notify-keyspace-events', 'Ex');
  } catch (err) {
    console.warn(
      '[redis] Could not set notify-keyspace-events automatically. ' +
      'If scheduled mutes do not auto-expire, enable it manually — see README. ' +
      `(${err.message})`
    );
  }

  const db = redis.options.db || 0;
  const channel = `__keyevent@${db}__:expired`;
  await subscriber.subscribe(channel);

  subscriber.on('message', (_channel, expiredKey) => {
    if (!expiredKey.startsWith(MUTE_KEY_PREFIX)) return;
    const ticker = expiredKey.slice(MUTE_KEY_PREFIX.length);
    onExpired(ticker).catch(err =>
      console.error(`[redis] Error handling mute expiry for ${ticker}:`, err)
    );
  });
}
