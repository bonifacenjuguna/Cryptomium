import { DateTime } from 'luxon';
import { CONFIG } from './config.js';

/**
 * Parses owner input like "18:30", "9pm", or "in 3 hours" into a concrete
 * future JS Date, using the given IANA timezone (default: Africa/Nairobi)
 * when the input doesn't specify its own.
 *
 * Intentionally forgiving rather than exhaustive — it covers the two
 * shapes the bot's mute UI actually asks for: a relative duration, or a
 * clock time (assumed to be the next occurrence of that time).
 *
 * Returns { date: Date, timezoneUsed: string } or null if unparseable.
 */
export function parseMuteTime(input, timezone = CONFIG.defaultTimezone) {
  const trimmed = input.trim().toLowerCase();

  // Relative duration: "in 3 hours", "in 45 minutes", "in 2 days"
  const relativeMatch = trimmed.match(/^in\s+(\d+)\s*(minute|min|hour|hr|day)s?$/);
  if (relativeMatch) {
    const [, amountStr, unitRaw] = relativeMatch;
    const amount = Number(amountStr);
    const unit = unitRaw.startsWith('min') ? 'minutes' : (unitRaw.startsWith('hour') || unitRaw === 'hr') ? 'hours' : 'days';
    const date = DateTime.now().setZone(timezone).plus({ [unit]: amount }).toJSDate();
    return { date, timezoneUsed: timezone };
  }

  // Clock time: "6:00", "18:30", "9pm", "9:15pm"
  const clockMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (clockMatch) {
    const [, hourStr, minuteStr, meridiem] = clockMatch;
    let hour = Number(hourStr);
    const minute = Number(minuteStr || 0);
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    let target = DateTime.now().setZone(timezone).set({ hour, minute, second: 0, millisecond: 0 });
    if (target <= DateTime.now().setZone(timezone)) {
      target = target.plus({ days: 1 }); // next occurrence
    }
    return { date: target.toJSDate(), timezoneUsed: timezone };
  }

  return null;
}

export function formatInTimezone(date, timezone = CONFIG.defaultTimezone) {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat('yyyy-LL-dd HH:mm ZZZZ');
}

/** Short wall-clock time, e.g. "14:32:05", in the given timezone. */
export function formatClock(date, timezone = CONFIG.defaultTimezone) {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat('HH:mm:ss');
}
