// Tiny shared-cache helpers for the website API.
//
// Goals: many visitors cost one upstream request per window; a failing upstream
// never gets hammered (failures are remembered briefly too); and when a fresh
// reading is not possible the last good one is still served (marked stale).

/**
 * One cached value. get() resolves { value, stale }.
 *  - fresh inside ttl
 *  - concurrent callers share one in-flight load
 *  - after a failed load, no new attempt for `failTtlMs`; meanwhile the last
 *    good value is served as stale (or the error is thrown if there is none)
 */
export function createLoader({ load, ttlMs, failTtlMs = 30_000, now = () => Date.now() }) {
  let value = null;
  let hasValue = false;
  let at = -Infinity;
  let failedAt = -Infinity;
  let lastError = null;
  let inflight = null;
  const ttl = () => (typeof ttlMs === 'function' ? ttlMs() : ttlMs);

  return async function get() {
    const t = now();
    if (hasValue && t - at < ttl()) return { value, stale: false };
    if (t - failedAt < failTtlMs) {
      if (hasValue) return { value, stale: true };
      throw lastError;
    }
    if (!inflight) {
      inflight = load()
        .then(v => {
          value = v;
          hasValue = true;
          at = now();
          failedAt = -Infinity;
          return { value: v, stale: false };
        })
        .catch(err => {
          failedAt = now();
          lastError = err;
          if (hasValue) return { value, stale: true };
          throw err;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}

/** Same, but one independent cache per key (e.g. per coin + range). */
export function createKeyedLoader({ load, ttlMs, failTtlMs = 30_000, now = () => Date.now() }) {
  const loaders = new Map();
  return function get(key) {
    let loader = loaders.get(key);
    if (!loader) {
      loader = createLoader({
        load: () => load(key),
        ttlMs: typeof ttlMs === 'function' ? () => ttlMs(key) : ttlMs,
        failTtlMs,
        now,
      });
      loaders.set(key, loader);
    }
    return loader();
  };
}

/** Evenly thins a list to at most `max` items, always keeping the first and last. */
export function downsample(list, max) {
  if (!Array.isArray(list) || list.length <= max || max < 2) return list;
  const out = [];
  for (let i = 0; i < max; i++) out.push(list[Math.round((i * (list.length - 1)) / (max - 1))]);
  return out;
}
