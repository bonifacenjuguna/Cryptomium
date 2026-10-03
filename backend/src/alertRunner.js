// The price-alert loop body, with every outside dependency passed in so it can
// be unit-tested without Telegram, Postgres or a network.
//
// What it guarantees:
//   * One tick at a time. If a tick is still running when the next one is due
//     (slow price source, slow rendering), the new one is skipped, not stacked.
//   * A milestone is only marked as "used" AFTER its banner was really sent.
//     If rendering or Telegram fails, the milestone stays open and is tried
//     again on the next tick (up to `maxAttempts`, then it is dropped).
//   * Banners are paced `postDelayMs` apart, and a Telegram 429 ("too many
//     requests") pauses all sending for that tick instead of burning alerts.
//   * Optional caps: alerts per rolling hour, and a minimum gap per coin.
//     Alerts held back by a cap are NOT consumed; they post when there is room.
//   * Muted coins and a not-yet-connected channel still advance the ladder
//     silently (as before), so unmuting / connecting never floods the channel.

const HOUR_MS = 60 * 60 * 1000;

/** Telegram's flood-control error carries the seconds to wait. */
function retryAfterSeconds(err) {
  const fromParams = err?.parameters?.retry_after ?? err?.response?.parameters?.retry_after;
  if (Number.isFinite(fromParams)) return fromParams;
  const code = err?.response?.error_code ?? err?.code;
  if (code === 429) return 5;
  return null;
}

export function createAlertRunner({
  coins,
  getChannelId,
  fetchPrices,
  getSettings,
  check,
  saveMilestone,
  isMuted,
  sendAlert,
  logPost,
  now = () => Date.now(),
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  postDelayMs = 1_200,
  maxPerHour = 0,
  minGapSeconds = 0,
  maxAttempts = 5,
  log = console,
}) {
  let running = false;
  const sentAt = []; // timestamps of automatic alerts in the last hour
  const lastSentByCoin = new Map();
  const attempts = new Map();

  return async function runTick() {
    if (running) {
      log.warn('[scheduler] Previous tick is still running; skipping this one.');
      return { skipped: true, sent: 0, deferred: 0, failed: 0 };
    }
    running = true;
    const summary = { skipped: false, sent: 0, deferred: 0, failed: 0 };
    try {
      const channelId = await getChannelId();
      const prices = await fetchPrices();
      log.log(`[scheduler] Tick: fetched ${prices.size}/${coins.length} prices, channel ${channelId ? 'connected' : 'NOT connected'}.`);

      let paused = false; // set by a Telegram 429; stops sending for the rest of this tick

      for (const coin of coins) {
        const price = prices.get(coin.ticker);
        if (price === undefined) continue;

        const settings = await getSettings(coin.ticker);
        const result = check(coin, settings, price);
        if (!result) continue;

        // Baseline set / re-armed: nothing to post, just remember the position.
        if (result.direction === null) {
          await saveMilestone(coin.ticker, result.newLastMilestone);
          continue;
        }

        // Muted or no channel yet: advance silently (no flood later).
        if (isMuted(settings) || !channelId) {
          await saveMilestone(coin.ticker, result.newLastMilestone);
          attempts.delete(coin.ticker);
          continue;
        }

        // From here the alert is real. Leave the milestone open until it is sent.
        if (paused) { summary.deferred++; continue; }

        const t = now();
        while (sentAt.length > 0 && sentAt[0] <= t - HOUR_MS) sentAt.shift();
        if (maxPerHour > 0 && sentAt.length >= maxPerHour) { summary.deferred++; continue; }
        const last = lastSentByCoin.get(coin.ticker);
        if (minGapSeconds > 0 && last !== undefined && t - last < minGapSeconds * 1000) {
          summary.deferred++;
          continue;
        }

        if (summary.sent > 0 && postDelayMs > 0) await sleep(postDelayMs);

        try {
          await sendAlert({ coin, price: result.price, direction: result.direction, channelId });
        } catch (err) {
          const wait = retryAfterSeconds(err);
          if (wait !== null) {
            paused = true;
            summary.deferred++;
            log.warn(`[scheduler] Telegram asked us to slow down (${wait}s). Pausing sends; ${coin.ticker} will be retried.`);
            await sleep(Math.min(wait, 30) * 1000);
            continue;
          }
          const n = (attempts.get(coin.ticker) ?? 0) + 1;
          summary.failed++;
          if (n >= maxAttempts) {
            log.error(`[scheduler] Giving up on ${coin.ticker} alert after ${n} failed attempts:`, err);
            attempts.delete(coin.ticker);
            await saveMilestone(coin.ticker, result.newLastMilestone);
          } else {
            attempts.set(coin.ticker, n);
            log.error(`[scheduler] Failed to post ${coin.ticker} alert (attempt ${n}/${maxAttempts}), will retry:`, err);
          }
          continue;
        }

        // Sent. Now (and only now) the milestone counts as used.
        attempts.delete(coin.ticker);
        await saveMilestone(coin.ticker, result.newLastMilestone);
        sentAt.push(now());
        lastSentByCoin.set(coin.ticker, now());
        summary.sent++;
        try {
          await logPost({ ticker: coin.ticker, kind: 'auto', direction: result.direction, price: result.price });
        } catch (err) {
          log.error(`[scheduler] Posted ${coin.ticker} but could not log it:`, err);
        }
      }
      return summary;
    } finally {
      running = false;
    }
  };
}
