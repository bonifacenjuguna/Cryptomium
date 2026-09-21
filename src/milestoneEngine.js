// Decides whether a new price reading crosses a milestone that should be
// posted. Two modes:
//
//  - Normal coins: a ladder of round-number steps (threshold apart). We
//    track the last milestone level that was announced and check whether
//    the current price has moved a full step beyond it, in either
//    direction. Large jumps (e.g. after downtime) collapse to a single
//    post for the furthest level crossed, rather than spamming one post
//    per intermediate step.
//
//  - Stablecoins (USDT/USDC): "threshold" is a depeg band half-width
//    around $1.00. We alert once when price exits the band, then re-arm
//    (allow another alert) only after price returns inside the band.
//
// Returns null (no post needed) or { direction: 'up' | 'down' | null,
// price, newLastMilestone } describing what to post and what to persist.

export function checkMilestone(coin, settings, currentPrice) {
  if (coin.stable) {
    return checkStablecoinDepeg(settings, currentPrice, settings.threshold);
  }
  return checkLadderCrossing(settings, currentPrice, settings.threshold);
}

function checkLadderCrossing(settings, currentPrice, threshold) {
  const { last_milestone } = settings;

  // First ever reading for this coin: establish a baseline silently so we
  // don't fire a post the moment the bot starts up.
  if (last_milestone === null || last_milestone === undefined) {
    const baseline = Math.round(currentPrice / threshold) * threshold;
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

function roundToStep(value, step) {
  // Guards against floating point drift (e.g. 0.30000000000000004) by
  // rounding to a sensible number of decimal places derived from the step.
  const decimals = Math.min(10, (step.toString().split('.')[1] || '').length);
  return Number(value.toFixed(decimals));
}
