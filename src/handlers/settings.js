import { coinByTicker } from '../config.js';
import { getCoinSettings, setThreshold } from '../db.js';
import { coinListKeyboard, coinDetailKeyboard } from '../keyboards.js';

// Tracks which owner is mid-edit for which ticker, so the next plain-text
// message they send is interpreted as the new threshold value rather than
// something else.
const pendingThresholdEdit = new Map(); // telegramUserId -> ticker

export function registerSettingsHandlers(bot) {
  bot.hears('⚙️ Settings', async ctx => {
    await ctx.reply('Choose a coin to view or edit:', coinListKeyboard('coin'));
  });

  bot.action('back:settings', async ctx => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Choose a coin to view or edit:', coinListKeyboard('coin'));
  });

  bot.action(/^coin:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    await showCoinDetail(ctx, ticker);
  });

  bot.action(/^edit:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    pendingThresholdEdit.set(ctx.from.id, ticker);
    await ctx.reply(`Send the new threshold value for ${ticker} (e.g. "500" or "0.02").`);
  });

  bot.on('text', async (ctx, next) => {
    const ticker = pendingThresholdEdit.get(ctx.from.id);
    if (!ticker) return next();

    const value = Number(ctx.message.text.trim());
    if (!Number.isFinite(value) || value <= 0) {
      await ctx.reply('That doesn\'t look like a valid positive number. Try again.');
      return;
    }

    await setThreshold(ticker, value);
    pendingThresholdEdit.delete(ctx.from.id);
    await ctx.reply(`${ticker} threshold updated to ${value}.`);
    await showCoinDetail(ctx, ticker, { asNewMessage: true });
  });

  async function showCoinDetail(ctx, ticker, { asNewMessage = false } = {}) {
    const coin = coinByTicker(ticker);
    const settings = await getCoinSettings(ticker);
    const muteStatus = describeMuteStatus(settings);

    const text =
      `${coin.name} (${coin.ticker})\n` +
      `Threshold: ${settings.threshold}\n` +
      `Mute: ${muteStatus}`;

    if (asNewMessage) {
      await ctx.reply(text, coinDetailKeyboard(ticker));
    } else {
      await ctx.editMessageText(text, coinDetailKeyboard(ticker));
    }
  }
}

export function describeMuteStatus(settings) {
  if (settings.muted_indefinitely) return 'muted until you unmute it';
  if (settings.muted_until) return `muted until ${new Date(settings.muted_until).toLocaleString()}`;
  return 'active';
}
