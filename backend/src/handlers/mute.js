import { COINS, CONFIG, TICKERS } from '../config.js';
import { muteIndefinitely, muteUntil, unmute, getSettingsMap } from '../db.js';
import { scheduleMuteExpiry, cancelScheduledMuteExpiry } from '../redisClient.js';
import { parseMuteTime, formatInTimezone } from '../timezone.js';
import { isMuted, statusLine } from '../coinView.js';
import { pending } from '../pending.js';
import { safeEdit } from '../telegramUtil.js';
import {
  MENU, muteListKeyboard, muteMenuKeyboard, backToCoinKeyboard, bulkPickKeyboard, bulkDurationKeyboard,
  statusExtrasKeyboard,
} from '../keyboards.js';

const LIST_TEXT = 'Choose a coin to mute or unmute, or use the bulk options:';

// Bulk-mute state, per owner (in-memory; resets on restart, which is fine —
// the owner just taps "Pick several" again).
const bulkSelection = new Map(); // userId -> Set<ticker>   (the ticked coins)
const bulkTarget = new Map(); //    userId -> string[]        (coins about to be muted)

export function registerMuteHandlers(bot) {
  bot.hears(MENU.mute, async ctx => {
    await ctx.reply(LIST_TEXT, muteListKeyboard());
  });

  bot.action('back:mute', async ctx => {
    await ctx.answerCbQuery();
    await safeEdit(ctx, LIST_TEXT, muteListKeyboard());
  });

  // ------------------------------------------------------------------
  // One coin
  // ------------------------------------------------------------------
  bot.action(/^mutemenu:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    await safeEdit(ctx, `Mute options for ${ticker}:`, muteMenuKeyboard(ticker));
  });

  bot.action(/^muteindef:(.+)$/, async ctx => {
    const ticker = ctx.match[1];
    await muteMany([ticker]);
    await ctx.answerCbQuery(`${ticker} muted until you unmute it.`);
    await safeEdit(ctx, `${ticker} is muted until you unmute it.`, backToCoinKeyboard(ticker));
  });

  bot.action(/^unmute:(.+)$/, async ctx => {
    const ticker = ctx.match[1];
    await unmuteMany([ticker]);
    await ctx.answerCbQuery(`${ticker} unmuted.`);
    await safeEdit(ctx, `${ticker} is active again.`, backToCoinKeyboard(ticker));
  });

  bot.action(/^mutetime:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    pending.set(ctx.from.id, 'mutetime', { tickers: [ticker] });
    await ctx.reply(mutePrompt(ticker));
  });

  // ------------------------------------------------------------------
  // Bulk: all coins, or several ticked coins
  // ------------------------------------------------------------------
  bot.action('bulk:all', async ctx => {
    await ctx.answerCbQuery();
    bulkTarget.set(ctx.from.id, [...TICKERS]);
    await safeEdit(ctx, `Mute ALL ${TICKERS.length} coins — for how long?`, bulkDurationKeyboard());
  });

  bot.action('bulkun:all', async ctx => {
    await unmuteMany(TICKERS);
    clearBulkState(ctx.from.id);
    await ctx.answerCbQuery('All coins unmuted.');
    await safeEdit(ctx, `🔔 All ${TICKERS.length} coins are active again.`, muteListKeyboard());
  });

  bot.action('bulk:pick', async ctx => {
    await ctx.answerCbQuery();
    bulkSelection.set(ctx.from.id, new Set());
    await showPicker(ctx);
  });

  bot.action(/^bpick:(\w+)$/, async ctx => {
    const arg = ctx.match[1];
    const selected = bulkSelection.get(ctx.from.id) ?? new Set();
    if (arg === 'all') TICKERS.forEach(t => selected.add(t));
    else if (arg === 'none') selected.clear();
    else if (TICKERS.includes(arg)) selected.has(arg) ? selected.delete(arg) : selected.add(arg);
    bulkSelection.set(ctx.from.id, selected);
    await ctx.answerCbQuery();
    await showPicker(ctx);
  });

  bot.action('bgo:mute', async ctx => {
    const selected = [...(bulkSelection.get(ctx.from.id) ?? [])];
    if (selected.length === 0) return ctx.answerCbQuery('Tick at least one coin first.', { show_alert: true });
    await ctx.answerCbQuery();
    bulkTarget.set(ctx.from.id, selected);
    await safeEdit(ctx, `Mute ${describeSet(selected)} — for how long?`, bulkDurationKeyboard());
  });

  bot.action('bgo:unmute', async ctx => {
    const selected = [...(bulkSelection.get(ctx.from.id) ?? [])];
    if (selected.length === 0) return ctx.answerCbQuery('Tick at least one coin first.', { show_alert: true });
    await unmuteMany(selected);
    clearBulkState(ctx.from.id);
    await ctx.answerCbQuery('Unmuted.');
    await safeEdit(ctx, `🔔 Unmuted ${describeSet(selected)}.`, muteListKeyboard());
  });

  bot.action('bdur:indef', async ctx => {
    const tickers = bulkTarget.get(ctx.from.id);
    if (!tickers?.length) return expired(ctx);
    await muteMany(tickers);
    clearBulkState(ctx.from.id);
    await ctx.answerCbQuery('Muted.');
    await safeEdit(ctx, `🔕 Muted ${describeSet(tickers)} until you unmute.`, muteListKeyboard());
  });

  bot.action('bdur:time', async ctx => {
    const tickers = bulkTarget.get(ctx.from.id);
    if (!tickers?.length) return expired(ctx);
    await ctx.answerCbQuery();
    pending.set(ctx.from.id, 'mutetime', { tickers });
    await ctx.reply(mutePrompt(describeSet(tickers)));
  });

  // ------------------------------------------------------------------
  // Typed answer for "mute until time" (one coin or a whole set)
  // ------------------------------------------------------------------
  bot.on('text', async (ctx, next) => {
    const flow = pending.get(ctx.from.id, 'mutetime');
    if (!flow) return next();

    const raw = ctx.message.text.trim();
    const { timezoneOverride, cleanInput } = extractTimezoneOverride(raw);
    const parsed = parseMuteTime(cleanInput, timezoneOverride || CONFIG.defaultTimezone);

    if (!parsed) {
      await ctx.reply('Couldn\'t parse that. Try something like "in 3 hours" or "18:30".');
      return;
    }

    await muteManyUntil(flow.tickers, parsed.date, parsed.timezoneUsed);
    pending.clear(ctx.from.id);
    clearBulkState(ctx.from.id);

    await ctx.reply(
      `${describeSet(flow.tickers)} muted until ${formatInTimezone(parsed.date, parsed.timezoneUsed)}. ` +
      `${flow.tickers.length === 1 ? 'It\'ll' : 'They\'ll'} unmute automatically.`
    );
  });

  // ------------------------------------------------------------------
  // Status
  // ------------------------------------------------------------------
  bot.hears(MENU.status, async ctx => {
    const allSettings = await getSettingsMap();
    const rows = COINS.map(coin => {
      const settings = allSettings.get(coin.ticker);
      let line = statusLine(coin, settings);
      if (isMuted(settings) && !settings.muted_indefinitely) {
        line += ` (until ${new Date(settings.muted_until).toLocaleString()})`;
      }
      return line;
    });
    await ctx.reply(rows.join('\n'), statusExtrasKeyboard());
  });

  function clearBulkState(userId) {
    bulkSelection.delete(userId);
    bulkTarget.delete(userId);
  }

  async function showPicker(ctx) {
    const selected = bulkSelection.get(ctx.from.id) ?? new Set();
    await safeEdit(
      ctx,
      `Tap coins to select them (${selected.size} selected):`,
      bulkPickKeyboard(selected)
    );
  }

  async function expired(ctx) {
    await ctx.answerCbQuery('That selection expired — start again.', { show_alert: true });
    await safeEdit(ctx, LIST_TEXT, muteListKeyboard());
  }
}

// ----------------------------------------------------------------------
// Muting helpers (one code path for a single coin and for bulk actions)
// ----------------------------------------------------------------------
async function muteMany(tickers) {
  for (const ticker of tickers) {
    await cancelScheduledMuteExpiry(ticker); // clear any pending scheduled unmute
    await muteIndefinitely(ticker);
  }
}

async function muteManyUntil(tickers, date, timezone) {
  for (const ticker of tickers) {
    await muteUntil(ticker, date.toISOString(), timezone);
    await scheduleMuteExpiry(ticker, date);
  }
}

async function unmuteMany(tickers) {
  for (const ticker of tickers) {
    await cancelScheduledMuteExpiry(ticker);
    await unmute(ticker);
  }
}

function describeSet(tickers) {
  if (tickers.length === TICKERS.length) return `all ${tickers.length} coins`;
  if (tickers.length <= 4) return tickers.join(', ');
  return `${tickers.length} coins (${tickers.join(', ')})`;
}

function mutePrompt(what) {
  return (
    `When should ${what} unmute? Examples:\n` +
    `"in 3 hours", "18:30", "9pm"\n` +
    `(defaults to ${CONFIG.defaultTimezone} — add a zone like "9pm EST" for a custom one)`
  );
}

// Very light timezone-override parsing: if the message ends in a token
// that looks like a common abbreviation or IANA-style zone, split it off.
function extractTimezoneOverride(input) {
  const match = input.match(/^(.*)\s+([A-Za-z]+\/[A-Za-z_]+|[A-Za-z]{2,4})$/);
  if (!match) return { timezoneOverride: null, cleanInput: input };
  const [, rest, tzToken] = match;
  const KNOWN_ABBREVIATIONS = { EST: 'America/New_York', PST: 'America/Los_Angeles', GMT: 'UTC', UTC: 'UTC' };
  const resolved = KNOWN_ABBREVIATIONS[tzToken.toUpperCase()] || (tzToken.includes('/') ? tzToken : null);
  if (!resolved) return { timezoneOverride: null, cleanInput: input };
  return { timezoneOverride: resolved, cleanInput: rest };
}
