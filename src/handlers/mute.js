import { coinByTicker, CONFIG, TICKERS } from '../config.js';
import { muteIndefinitely, muteUntil, unmute, getCoinSettings } from '../db.js';
import { scheduleMuteExpiry, cancelScheduledMuteExpiry } from '../redisClient.js';
import { parseMuteTime, formatInTimezone } from '../timezone.js';
import { coinListKeyboard, muteMenuKeyboard, backToCoinKeyboard } from '../keyboards.js';

// Tracks which owner is mid-flow entering a custom mute time/timezone for
// which ticker.
const pendingMuteTime = new Map(); // telegramUserId -> ticker

export function registerMuteHandlers(bot) {
  bot.hears('🔕 Mute', async ctx => {
    await ctx.reply('Choose a coin to mute or unmute:', coinListKeyboard('mutemenu'));
  });

  bot.action(/^mutemenu:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    await ctx.editMessageText(`Mute options for ${ticker}:`, muteMenuKeyboard(ticker));
  });

  bot.action(/^muteindef:(.+)$/, async ctx => {
    const ticker = ctx.match[1];
    await cancelScheduledMuteExpiry(ticker); // clear any pending scheduled unmute
    await muteIndefinitely(ticker);
    await ctx.answerCbQuery(`${ticker} muted until you unmute it.`);
    await ctx.editMessageText(`${ticker} is muted until you unmute it.`, backToCoinKeyboard(ticker));
  });

  bot.action(/^unmute:(.+)$/, async ctx => {
    const ticker = ctx.match[1];
    await cancelScheduledMuteExpiry(ticker);
    await unmute(ticker);
    await ctx.answerCbQuery(`${ticker} unmuted.`);
    await ctx.editMessageText(`${ticker} is active again.`, backToCoinKeyboard(ticker));
  });

  bot.action(/^mutetime:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    pendingMuteTime.set(ctx.from.id, ticker);
    await ctx.reply(
      `When should ${ticker} unmute? Examples:\n` +
      `"in 3 hours", "18:30", "9pm"\n` +
      `(defaults to ${CONFIG.defaultTimezone} — add a zone like "9pm EST" for a custom one)`
    );
  });

  bot.on('text', async (ctx, next) => {
    const ticker = pendingMuteTime.get(ctx.from.id);
    if (!ticker) return next();

    const raw = ctx.message.text.trim();
    const { timezoneOverride, cleanInput } = extractTimezoneOverride(raw);
    const parsed = parseMuteTime(cleanInput, timezoneOverride || CONFIG.defaultTimezone);

    if (!parsed) {
      await ctx.reply('Couldn\'t parse that. Try something like "in 3 hours" or "18:30".');
      return;
    }

    await muteUntil(ticker, parsed.date.toISOString(), parsed.timezoneUsed);
    await scheduleMuteExpiry(ticker, parsed.date);
    pendingMuteTime.delete(ctx.from.id);

    await ctx.reply(
      `${ticker} muted until ${formatInTimezone(parsed.date, parsed.timezoneUsed)}. ` +
      `It'll unmute automatically.`
    );
  });

  bot.hears('📊 Status', async ctx => {
    const rows = await Promise.all(
      TICKERS.map(async t => {
        const s = await getCoinSettings(t);
        const coin = coinByTicker(t);
        const mute = s.muted_indefinitely
          ? '🔕 (indefinite)'
          : s.muted_until && new Date(s.muted_until) > new Date()
          ? `🔕 until ${new Date(s.muted_until).toLocaleString()}`
          : '🔔';
        return `${coin.ticker}: threshold ${s.threshold} — ${mute}`;
      })
    );
    await ctx.reply(rows.join('\n'));
  });
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
