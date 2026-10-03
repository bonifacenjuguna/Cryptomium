// Small presentation helpers shared by the admin screens and the scheduler.
import { modeByKey } from './config.js';
import { stepOf, formatStep } from './milestoneEngine.js';
import { formatPrice } from './priceFormat.js';

export function isMuted(settings) {
  if (settings.muted_indefinitely) return true;
  if (settings.muted_until && new Date(settings.muted_until) > new Date()) return true;
  return false;
}

/** "0.5%" or "$500" — the coin's current effective step (base x mode). */
export function stepText(coin, settings) {
  const step = stepOf(coin, settings);
  return formatStep(step.unit, step.value);
}

/** "🎯 Steady", "🚀 Hyper (¼x)" — mode with its multiplier when not the default. */
export function modeText(settings, { withMultiplier = true } = {}) {
  const mode = modeByKey(settings.mode);
  const suffix = withMultiplier && mode.multiplier !== 1 ? ` (${mode.label})` : '';
  return `${mode.emoji} ${mode.name}${suffix}`;
}

export function describeMuteStatus(settings) {
  if (settings.muted_indefinitely) return 'muted until you unmute it';
  if (settings.muted_until && new Date(settings.muted_until) > new Date()) {
    return `muted until ${new Date(settings.muted_until).toLocaleString()}`;
  }
  return 'active';
}

/** Price as shown on the owner's screens: the same standard format as banners and captions. */
export function formatAdminPrice(price, { stable = false } = {}) {
  return formatPrice(price, { stable });
}

/** Status list line, e.g. "BTC — 0.5% 🔔" (mode icon shown when not Steady). */
export function statusLine(coin, settings) {
  const mode = modeByKey(settings.mode);
  const modeIcon = mode.multiplier === 1 ? '' : ` ${mode.emoji}`;
  const bell = isMuted(settings) ? '🔕' : '🔔';
  return `${coin.ticker} — ${stepText(coin, settings)}${modeIcon} ${bell}`;
}
