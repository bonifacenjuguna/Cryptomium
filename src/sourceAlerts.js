// Turns price-source health events (see priceService.js) into private messages
// for the owner, with a cooldown so a flapping provider can't spam them.
import { describeError } from './priceService.js';

const HOUR = 60 * 60 * 1000;

export function createSourceAlerter({ send, now = () => Date.now(), cooldownMs = HOUR }) {
  const last = { fallback: -Infinity, outage: -Infinity };
  let announced = false; // did we tell the owner about a problem that hasn't been resolved yet?

  return async function handleSourceEvent(event) {
    if (event.type === 'fallback') {
      if (now() - last.fallback < cooldownMs) return;
      last.fallback = now();
      announced = true;
      const stableNote = event.usedKey === 'binance'
        ? ' USDT/USDC depeg checks pause while on the backup.'
        : '';
      await send(
        `⚠️ ${event.primary} isn't responding (${describeError(event.error)}).\n` +
        `I'm using ${event.used} as a backup, so alerts keep working.${stableNote}\n` +
        "I'll tell you when it's back."
      );
    } else if (event.type === 'outage') {
      if (now() - last.outage < cooldownMs) return;
      last.outage = now();
      announced = true;
      await send(
        `🚨 Every price source is failing (${describeError(event.error)}).\n` +
        "No alerts can be sent until one recovers. I'll tell you when it does."
      );
    } else if (event.type === 'recovered') {
      if (!announced) return;
      announced = false;
      await send(`✅ ${event.primary} is back — using it again.`);
    }
  };
}
