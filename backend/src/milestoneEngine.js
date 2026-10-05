// Decides whether a new price reading crosses a milestone that should be
// posted. A coin's step can be a dollar amount or a percentage, and is
// scaled by its alert mode (Hyper / Fast / Steady / Calm):
//
//  - Normal coins: a ladder of round-number steps (threshold apart). We
//    track the last milestone level that was announced and check whether
//    the current price has moved a full step beyond it, in either
//    direction. Large jumps (e.g. after downtime) collapse to a single
//    post for the furthest level crossed, rather than spamming one post
//    per intermediate step.
//
//  - Percentage steps: we alert every time the price has moved that many
//    percent away from the price at the last alert (in either direction),
//    and post the actual current price. Big jumps still collapse to a
//    single post.
//
//  - Stablecoins (USDT/USDC): the step is a depeg band half-width around
//    $1.00 (a percent step of p% means a band of p/100 dollars). We alert
//    once when price exits the band, then re-arm (allow another alert) only
//    after price returns inside the band.
//
// Returns null (no post needed) or { direction: 'up' | 'down' | null,
// price, newLastMilestone } describing what to post and what to persist.

import { modeByKey } from './config.js';

/**
 * Resolves a coin's effective step from its settings.
 * effective step = base step for the active unit x the mode's multiplier.
 * Returns { unit: 'usd' | 'pct', base, multiplier, value, mode }.
 */
export function stepOf(coin, settings) {
  const unit = settings.step_unit === 'pct' ? 'pct' : 'usd';
  const base = unit === 'pct'
    ? Number(settings.pct_threshold ?? coin.defaultPercent)
    : Number(settings.threshold);
  const mode = modeByKey(settings.mode);
  const value = Number((base * mode.multiplier).toPrecision(12));
  return { unit, base, multiplier: mode.multiplier, value, mode };
}

export function checkMilestone(coin, settings, currentPrice) {
  const step = stepOf(coin, settings);

  if (coin.stable) {
    const band = step.unit === 'pct' ? step.value / 100 : step.value;
    return checkStablecoinDepeg(settings, currentPrice, band);
  }
  if (step.unit === 'pct') {
    return checkPercentCrossing(settings, currentPrice, step.value);
  }
  return checkLadderCrossing(settings, currentPrice, step.value);
}

/**
 * The price a banner would show for `price` right now — used by the test
 * banner so a preview looks like a real alert. Dollar-ladder coins show the
 * nearest round level; percentage and stablecoin alerts show the live price.
 */
export function previewLevel(coin, settings, price) {
  const step = stepOf(coin, settings);
  if (coin.stable || step.unit === 'pct') return price;
  return roundToStep(Math.round(price / step.value) * step.value, step.value);
}

/** Human-readable step, e.g. "$500", "$0.005" or "0.75%". */
export function formatStep(unit, value) {
  if (unit === 'pct') return `${Number(value.toFixed(4))}%`;
  const decimals = value >= 1 ? 2 : Math.min(10, Math.max(2, decimalPlaces(value)));
  const trimmed = Number(value.toFixed(decimals));
  return `$${trimmed.toLocaleString('en-US', { maximumFractionDigits: decimals })}`;
}

function checkPercentCrossing(settings, currentPrice, percent) {
  const { last_milestone } = settings;

  // First reading (or after switching to percentage steps): baseline silently.
  if (last_milestone === null || last_milestone === undefined) {
    return { direction: null, price: currentPrice, newLastMilestone: currentPrice };
  }

  const changePct = ((currentPrice - last_milestone) / last_milestone) * 100;
  if (changePct >= percent) {
    return { direction: 'up', price: currentPrice, newLastMilestone: currentPrice };
  }
  if (changePct <= -percent) {
    return { direction: 'down', price: currentPrice, newLastMilestone: currentPrice };
  }
  return null;
}

function checkLadderCrossing(settings, currentPrice, threshold) {
  const { last_milestone } = settings;

  // First ever reading for this coin: establish a baseline silently so we
  // don't fire a post the moment the bot starts up.
  if (last_milestone === null || last_milestone === undefined) {
    const baseline = roundToStep(Math.round(currentPrice / threshold) * threshold, threshold);
    return { direction: null, price: baseline, newLastMilestone: baseline };
  }

  const stepsMoved = (currentPrice - last_milestone) / threshold;

  if (stepsMoved >= 1) {
    const steps = Math.floor(stepsMoved);
    const newLevel = roundToStep(last_milestone + steps * threshold, threshold);
    return { direction: 'up', price: newLevel, newLastMilestone: newLevel };
  }

  if (stepsMoved <= -1) {
    const steps = Math.floor(-stepsMoved);
    const newLevel = roundToStep(last_milestone - steps * threshold, threshold);
    return { direction: 'down', price: newLevel, newLastMilestone: newLevel };
  }

  return null;
}

function checkStablecoinDepeg(settings, currentPrice, bandWidth) {
  const upperBound = 1 + bandWidth;
  const lowerBound = 1 - bandWidth;
  const wasArmed = settings.last_milestone === null || settings.last_milestone === undefined;

  if (currentPrice > upperBound && wasArmed) {
    return { direction: 'up', price: currentPrice, newLastMilestone: currentPrice };
  }
  if (currentPrice < lowerBound && wasArmed) {
    return { direction: 'down', price: currentPrice, newLastMilestone: currentPrice };
  }
  // Back inside the band — re-arm for the next depeg event.
  if (currentPrice <= upperBound && currentPrice >= lowerBound && !wasArmed) {
    return { direction: null, price: currentPrice, newLastMilestone: null };
  }
  return null;
}

/**
 * How far the current price is from triggering the NEXT alert in each
 * direction — used by the "🔭 Next alert" screen. Returns one of:
 *   { kind: 'baselining' }                                   — no reading yet
 *   { kind: 'ladder' | 'pct', unit, toUp, toDown }            — distance to each side, in the coin's step unit
 *   { kind: 'stable-armed', unit, toUp, toDown }              — distance to leaving the $1 band on each side
 *   { kind: 'stable-outside', direction, toReturn }           — already depegged; distance back inside the band
 */
export function nextAlertDistance(coin, settings, currentPrice) {
  const step = stepOf(coin, settings);

  if (coin.stable) {
    const band = step.unit === 'pct' ? step.value / 100 : step.value;
    const upper = 1 + band;
    const lower = 1 - band;
    const armed = settings.last_milestone === null || settings.last_milestone === undefined;
    if (!armed) {
      const direction = currentPrice > upper ? 'up' : 'down';
      const toReturn = direction === 'up' ? currentPrice - upper : lower - currentPrice;
      return { kind: 'stable-outside', direction, toReturn: Math.max(0, toReturn) };
    }
    return {
      kind: 'stable-armed',
      unit: step.unit,
      toUp: Math.max(0, upper - currentPrice),
      toDown: Math.max(0, currentPrice - lower),
    };
  }

  if (settings.last_milestone === null || settings.last_milestone === undefined) {
    return { kind: 'baselining' };
  }

  // Both the dollar ladder and percentage steps reduce to the same shape:
  // "moved" is how far price has traveled from the anchor, in the step's own
  // unit ($ for ladder, % for percent) — so the two directions are always
  // exactly `step.value` apart, symmetric around the anchor.
  const moved = step.unit === 'pct'
    ? ((currentPrice - settings.last_milestone) / settings.last_milestone) * 100
    : currentPrice - settings.last_milestone;

  return {
    kind: step.unit === 'pct' ? 'pct' : 'ladder',
    unit: step.unit,
    toUp: Math.max(0, step.value - moved),
    toDown: Math.max(0, step.value + moved),
  };
}

export function roundToStep(value, step) {
  // Guards against floating point drift (e.g. 0.30000000000000004) by
  // rounding to a sensible number of decimal places derived from the step.
  const decimals = Math.min(12, decimalPlaces(step));
  return Number(value.toFixed(decimals));
}

/**
 * How many decimal places a number needs. Handles exponent notation too: JavaScript prints 0.00000004
 * as "4e-8", which a plain split on "." reads as zero decimals (that would round SHIB's step to 0).
 */
export function decimalPlaces(n) {
  if (!Number.isFinite(n)) return 0;
  const match = String(n).match(/^-?\d*\.?(\d*)(?:e([+-]?\d+))?$/i);
  if (!match) return 0;
  return Math.max(0, (match[1] || '').length - (match[2] ? Number(match[2]) : 0));
}
