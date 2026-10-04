// The website's live price feed.
//
// The bot may follow an aggregator (CoinGecko) that only changes about once a
// minute, which makes a website look frozen. This feed reads an exchange every
// couple of seconds instead, but ONLY while someone is actually asking (every
// call is on demand and shared, so a hundred visitors cost one upstream call).
//
// 24h change would still need the aggregator, so it is anchored: once a minute
// the aggregator's 24h change is turned into a "price 24h ago" for each coin, and
// between those readings the change is recomputed from the live price. Result:
// price and change move together, second by second.
export function createLiveFeed({
  readExchange, // () -> { prices: Map, source }
  readReference, // () -> { prices: Map, changes: Map, source }
  intervalMs = 2_000,
  referenceMs = 60_000,
  exchangeRetryMs = 15_000,
  now = () => Date.now(),
}) {
  let cache = null;
  let inflight = null;
  let exchangeRetryAt = 0;
  let reference = null;
  let referenceAt = -Infinity;
  let base24h = new Map(); // ticker -> price 24h ago, in the exchange's terms
  let live = false;

  async function build() {
    let ex = null;
    if (now() >= exchangeRetryAt) {
      try {
        ex = await readExchange();
      } catch {
        exchangeRetryAt = now() + exchangeRetryMs;
      }
    }

    let refreshed = false;
    if (!reference || now() - referenceAt >= referenceMs) {
      try {
        reference = await readReference();
        referenceAt = now();
        refreshed = true;
      } catch {
        referenceAt = now() - referenceMs + 10_000; // look again soon, keep what we have
      }
    }
    if (!ex && !reference) throw new Error('No prices available yet.');

    const prices = new Map(reference?.prices ?? []);
    if (ex) for (const [t, p] of ex.prices) prices.set(t, p);

    if (refreshed && reference?.changes) {
      const next = new Map();
      for (const [t, ch] of reference.changes) {
        const px = ex?.prices.get(t) ?? reference.prices.get(t);
        if (Number.isFinite(ch) && Number.isFinite(px) && px > 0 && ch > -99) next.set(t, px / (1 + ch / 100));
      }
      if (next.size) base24h = next;
    }

    const changes = new Map();
    if (ex) {
      for (const [t, base] of base24h) {
        const p = prices.get(t);
        if (Number.isFinite(p) && base > 0) changes.set(t, (p / base - 1) * 100);
      }
    }
    for (const [t, ch] of reference?.changes ?? []) if (!changes.has(t)) changes.set(t, ch);

    live = Boolean(ex);
    cache = {
      prices,
      changes,
      at: ex?.at ?? reference?.at ?? now(),
      source: ex ? ex.source : reference?.source ?? null,
      backup: !ex,
      builtAt: now(),
    };
    return cache;
  }

  const read = async () => {
    if (cache && now() - cache.builtAt < intervalMs) return cache;
    if (!inflight) {
      inflight = build()
        .catch(err => {
          if (cache) return { ...cache, backup: true };
          throw err;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
  read.isLive = () => live;
  return read;
}
