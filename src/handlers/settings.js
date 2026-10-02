import { COINS, MODES, coinByTicker, modeByKey } from '../config.js';
import {
  getCoinSettings, setBaseStep, setStepUnit, setStepUnitForAll, setMode, setModeForAll,
} from '../db.js';
import { stepOf, formatStep } from '../milestoneEngine.js';
import { describeMuteStatus, modeText, stepText } from '../coinView.js';
import { pending } from '../pending.js';
import { safeEdit } from '../telegramUtil.js';
import {
  MENU, settingsListKeyboard, coinDetailKeyboard, modeKeyboard, allModesKeyboard, allUnitsKeyboard,
} from '../keyboards.js';

const LIST_TEXT = 'Choose a coin to view or edit:';

export function registerSettingsHandlers(bot) {
  bot.hears(MENU.settings, async ctx => {
    await ctx.reply(LIST_TEXT, settingsListKeyboard());
  });

  bot.action('back:settings', async ctx => {
    await ctx.answerCbQuery();
    await safeEdit(ctx, LIST_TEXT, settingsListKeyboard());
  });

  // --- One coin ------------------------------------------------------------
  bot.action(/^coin:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    await showCoinDetail(ctx, ctx.match[1]);
  });

  bot.action(/^edit:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    const settings = await getCoinSettings(ticker);
    const unit = settings.step_unit === 'pct' ? 'pct' : 'usd';
    pending.set(ctx.from.id, 'editstep', { ticker, unit });
    await ctx.reply(
      unit === 'pct'
        ? `Send the new base step for ${ticker} as a percentage (e.g. "0.5" for 0.5%).\n` +
          'This is the "Steady" step; modes scale it up or down.'
        : `Send the new base step for ${ticker} in dollars (e.g. "500" or "0.02").\n` +
          'This is the "Steady" step; modes scale it up or down.'
    );
  });

  bot.action(/^unit:(.+)$/, async ctx => {
    const ticker = ctx.match[1];
    const settings = await getCoinSettings(ticker);
    const next = settings.step_unit === 'pct' ? 'usd' : 'pct';
    await setStepUnit(ticker, next);
    await ctx.answerCbQuery(next === 'pct' ? `${ticker} now alerts by % moved.` : `${ticker} now alerts by $ steps.`);
    await showCoinDetail(ctx, ticker);
  });

  // --- Modes ---------------------------------------------------------------
  bot.action(/^modemenu:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    const settings = await getCoinSettings(ticker);
    await safeEdit(
      ctx,
      `${ticker} mode — how often should it alert?\n(Step shown is what ${ticker} would use.)`,
      modeKeyboard(ticker, settings)
    );
  });

  bot.action(/^setmode:([^:]+):(\w+)$/, async ctx => {
    const [, ticker, key] = ctx.match;
    if (!MODES.some(m => m.key === key)) return ctx.answerCbQuery('Unknown mode.');
    await setMode(ticker, key);
    await ctx.answerCbQuery(`${ticker}: ${modeByKey(key).emoji} ${modeByKey(key).name}`);
    await showCoinDetail(ctx, ticker);
  });

  bot.action('allmodes', async ctx => {
    await ctx.answerCbQuery();
    await safeEdit(
      ctx,
      'Set the mode for ALL coins:\n\n' +
      MODES.map(m => `${m.emoji} ${m.name} — ${m.label} of each coin's step`).join('\n'),
      allModesKeyboard()
    );
  });

  bot.action(/^allmode:(\w+)$/, async ctx => {
    const key = ctx.match[1];
    if (!MODES.some(m => m.key === key)) return ctx.answerCbQuery('Unknown mode.');
    await setModeForAll(key);
    const mode = modeByKey(key);
    await ctx.answerCbQuery(`All coins: ${mode.emoji} ${mode.name}`);
    await safeEdit(ctx, `All ${COINS.length} coins are now ${mode.emoji} ${mode.name}.`, settingsListKeyboard());
  });

  // --- Units (all coins) ---------------------------------------------------
  bot.action('allunits', async ctx => {
    await ctx.answerCbQuery();
    await safeEdit(
      ctx,
      'Alert every coin by:\n\n' +
      '％ — each time the price moves that % since the last alert\n' +
      '$ — each time the price crosses a dollar step\n\n' +
      'Switching restarts each coin from its current price (no instant alerts).',
      allUnitsKeyboard()
    );
  });

  bot.action(/^allunit:(usd|pct)$/, async ctx => {
    const unit = ctx.match[1];
    await setStepUnitForAll(unit);
    await ctx.answerCbQuery(unit === 'pct' ? 'All coins: % steps' : 'All coins: $ steps');
    await safeEdit(
      ctx,
      `All ${COINS.length} coins now alert by ${unit === 'pct' ? '% moved' : '$ steps'}.`,
      settingsListKeyboard()
    );
  });

  // --- Typed answer for "Edit step" -----------------------------------------
  bot.on('text', async (ctx, next) => {
    const flow = pending.get(ctx.from.id, 'editstep');
    if (!flow) return next();

    const value = Number(ctx.message.text.trim().replace(/[$%,\s]/g, ''));
    const max = flow.unit === 'pct' ? 50 : Infinity;
    if (!Number.isFinite(value) || value <= 0 || value > max) {
      await ctx.reply(
        flow.unit === 'pct'
          ? 'Send a percentage between 0 and 50 (e.g. 0.5).'
          : 'That doesn\'t look like a valid positive number. Try again.'
      );
      return;
    }

    await setBaseStep(flow.ticker, flow.unit, value);
    pending.clear(ctx.from.id);
    await ctx.reply(`${flow.ticker} base step updated to ${formatStep(flow.unit, value)}.`);
    await showCoinDetail(ctx, flow.ticker, { asNewMessage: true });
  });

  async function showCoinDetail(ctx, ticker, { asNewMessage = false } = {}) {
    const coin = coinByTicker(ticker);
    const settings = await getCoinSettings(ticker);
    const step = stepOf(coin, settings);
    const unitLabel = step.unit === 'pct' ? '% of price' : '$ per step';

    const text =
      `${coin.name} (${coin.ticker})\n` +
      `${coin.stable ? 'Depeg band (±)' : 'Step'}: ${stepText(coin, settings)}\n` +
      `Mode: ${modeText(settings)}\n` +
      `Base step (x): ${formatStep(step.unit, step.base)} · ${unitLabel}\n` +
      `Mute: ${describeMuteStatus(settings)}`;

    const keyboard = coinDetailKeyboard(ticker, settings);
    if (asNewMessage) {
      await ctx.reply(text, keyboard);
    } else {
      await safeEdit(ctx, text, keyboard);
    }
  }
}
