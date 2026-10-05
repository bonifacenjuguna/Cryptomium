// Owner-side tools: live prices, and the test-banner preview.
import { COINS, LOGO_STYLES, coinByTicker } from '../config.js';
import { getCoinSettings, getSettingsMap } from '../db.js';
import { getLatestPrices, describeError } from '../priceService.js';
import { previewLevel } from '../milestoneEngine.js';
import { generateBannerImage, getLogoStyle } from '../imageGenerator.js';
import { formatAdminPrice, isMuted, modeText, stepText } from '../coinView.js';
import { formatClock } from '../timezone.js';
import { parseTestPrice } from '../inputParsing.js';
import { pending } from '../pending.js';
import { safeEdit } from '../telegramUtil.js';
import {
  MENU, coinListKeyboard, pricesKeyboard, testOptionsKeyboard, testDirectionKeyboard,
} from '../keyboards.js';

// Owner screens accept a price reading up to this old instead of waiting for a fresh fetch
// (the scheduler refreshes it every poll; the Refresh button forces a new one).
const PANEL_MAX_AGE_MS = 60_000;

const TEST_LIST_TEXT =
  '🧪 Test banner — pick a coin.\nThe preview is sent only to you, never to the channel.';

// Per-owner override of the logo style used JUST for test-banner previews (so
// comparing ✨ Clean vs ⚪ White ring doesn't touch Settings > Logo style).
// undefined = follow the bot's current default.
const styleOverride = new Map();

function effectiveTestStyle(userId) {
  return styleOverride.get(userId) ?? getLogoStyle();
}

function toggleTestStyle(userId) {
  const other = LOGO_STYLES.find(s => s.key !== effectiveTestStyle(userId));
  styleOverride.set(userId, other.key);
  return other.key;
}

export function registerAdminHandlers(bot) {
  // ------------------------------------------------------------------
  // 💰 Prices
  // ------------------------------------------------------------------
  bot.hears(MENU.prices, async ctx => {
    const view = await buildPricesView({ force: false });
    await ctx.reply(view.text, { parse_mode: 'HTML', ...pricesKeyboard() });
  });

  bot.action('prices:refresh', async ctx => {
    // Answer the tap right away so the button stops spinning; the fetch can take a few seconds.
    await ctx.answerCbQuery('Refreshing…').catch(() => {});
    try {
      const view = await buildPricesView({ force: true });
      if (!view.ok) {
        // Keep the list that is already on screen; just say what went wrong.
        await ctx.reply(`Couldn't refresh: ${view.reason}`);
        return;
      }
      await safeEdit(ctx, view.text, { parse_mode: 'HTML', ...pricesKeyboard() });
    } catch (err) {
      console.error('[admin] Prices refresh failed:', err);
      await ctx.reply('Couldn\'t refresh — try again in a moment.').catch(() => {});
    }
  });

  // ------------------------------------------------------------------
  // 🧪 Test banner
  // ------------------------------------------------------------------
  bot.hears(MENU.test, async ctx => {
    await ctx.reply(TEST_LIST_TEXT, coinListKeyboard('test'));
  });

  bot.action('back:test', async ctx => {
    await ctx.answerCbQuery();
    await safeEdit(ctx, TEST_LIST_TEXT, coinListKeyboard('test'));
  });

  bot.action(/^test:(\w+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    await safeEdit(
      ctx,
      `🧪 ${ticker} — what should the preview show?\n` +
      'Rise / Fall use the live price (rounded to the coin\'s current step, like a real alert).',
      testOptionsKeyboard(ticker, effectiveTestStyle(ctx.from.id))
    );
  });

  bot.action(/^testcustom:(\w+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    pending.set(ctx.from.id, 'testprice', { ticker });
    await ctx.reply(
      `Send a price for ${ticker} (e.g. 81500).\n` +
      'Add "up" or "down" to skip the buttons — e.g. "81500 down".'
    );
  });

  // Flip the preview-only style and redraw whichever test screen is showing.
  bot.action(/^teststyle:opts:(\w+)$/, async ctx => {
    const ticker = ctx.match[1];
    const style = toggleTestStyle(ctx.from.id);
    await ctx.answerCbQuery(`Preview style: ${LOGO_STYLES.find(s => s.key === style).name}`);
    await safeEdit(
      ctx,
      `🧪 ${ticker} — what should the preview show?\n` +
      'Rise / Fall use the live price (rounded to the coin\'s current step, like a real alert).',
      testOptionsKeyboard(ticker, style)
    );
  });

  bot.action(/^teststyle:dir:(\w+):([\d.]+)$/, async ctx => {
    const [, ticker, priceStr] = ctx.match;
    const style = toggleTestStyle(ctx.from.id);
    await ctx.answerCbQuery(`Preview style: ${LOGO_STYLES.find(s => s.key === style).name}`);
    await safeEdit(
      ctx,
      `${ticker} at ${formatAdminPrice(Number(priceStr), { stable: coinByTicker(ticker).stable })} — rise or fall?`,
      testDirectionKeyboard(ticker, priceStr, style)
    );
  });

  // testgo:<TICKER>:<up|down>[:<price>]
  bot.action(/^testgo:(\w+):(up|down)(?::([\d.]+))?$/, async ctx => {
    const [, ticker, direction, priceArg] = ctx.match;
    await ctx.answerCbQuery('Generating preview…');
    await sendTestBanner(ctx, ticker, direction, priceArg ? Number(priceArg) : null);
  });

  bot.on('text', async (ctx, next) => {
    const flow = pending.get(ctx.from.id, 'testprice');
    if (!flow) return next();

    const parsed = parseTestPrice(ctx.message.text);
    if (!parsed) {
      await ctx.reply('Send a price like "81500", optionally followed by "up" or "down".');
      return;
    }
    pending.clear(ctx.from.id);

    if (parsed.direction) {
      await sendTestBanner(ctx, flow.ticker, parsed.direction, parsed.price);
    } else {
      await ctx.reply(
        `${flow.ticker} at ${formatAdminPrice(parsed.price, { stable: coinByTicker(flow.ticker).stable })} — rise or fall?`,
        testDirectionKeyboard(flow.ticker, parsed.price, effectiveTestStyle(ctx.from.id))
      );
    }
  });
}

// ----------------------------------------------------------------------
// Prices view
// ----------------------------------------------------------------------
async function buildPricesView({ force }) {
  let latest;
  try {
    latest = await getLatestPrices({ force, maxAgeMs: PANEL_MAX_AGE_MS });
  } catch (err) {
    const reason = describeError(err);
    return { ok: false, reason, text: `Couldn't fetch live prices right now (${escapeHtml(reason)}). Try again in a moment.` };
  }

  // A plain formatted message (not a code block), so Telegram can edit it in
  // place when Refresh is tapped.
  const lines = [];
  const allSettings = await getSettingsMap();
  for (const coin of COINS) {
    const price = latest.prices.get(coin.ticker);
    const settings = allSettings.get(coin.ticker);
    const modeIcon = modeText(settings, { withMultiplier: false }).split(' ')[0]; // just the emoji
    const bell = isMuted(settings) ? '🔕' : '🔔';

    let priceText = price === undefined ? 'n/a' : formatAdminPrice(price, { stable: coin.stable });
    // 🧮 Average price: show the range it was drawn from alongside the midpoint,
    // e.g. "$86,700–$86,820 → $86,760", so the range is visible, not just the
    // single blended number.
    const range = latest.ranges?.get(coin.ticker);
    if (range && range.sources > 1) {
      const fmt = v => formatAdminPrice(v, { stable: coin.stable });
      priceText = `${fmt(range.min)}–${fmt(range.max)} → <b>${fmt(price)}</b>`;
    }

    lines.push(`<b>${coin.ticker}</b> · ${priceText} · <i>${escapeHtml(stepText(coin, settings))}</i> ${modeIcon} ${bell}`);
  }

  const header = `💰 <b>Live prices</b>\n<i>${escapeHtml(latest.source)} · updated ${formatClock(new Date(latest.at))}</i>`;
  const footer = latest.ranges
    ? '<i>Range → midpoint (the alert price), then step · mode · alerts on/off</i>'
    : '<i>Each line: price · step · mode · alerts on/off</i>';
  return { ok: true, text: `${header}\n\n${lines.join('\n')}\n\n${footer}` };
}

// ----------------------------------------------------------------------
// Test banner
// ----------------------------------------------------------------------
async function sendTestBanner(ctx, ticker, direction, customPrice) {
  const coin = coinByTicker(ticker);
  if (!coin) return ctx.reply('Unknown coin.');

  let price = customPrice;
  if (price === null) {
    let latest;
    try {
      latest = await getLatestPrices({ maxAgeMs: PANEL_MAX_AGE_MS });
    } catch {
      await ctx.reply('Couldn\'t fetch a live price right now. Use "Custom price" instead.');
      return;
    }
    const live = latest.prices.get(ticker);
    if (live === undefined) {
      await ctx.reply(`No live price for ${ticker} right now. Use "Custom price" instead.`);
      return;
    }
    price = previewLevel(coin, await getCoinSettings(ticker), live);
  }

  const style = effectiveTestStyle(ctx.from.id);
  try {
    const image = await generateBannerImage({ ticker, price, direction, style });
    const arrow = direction === 'up' ? '▲' : '▼';
    const styleName = LOGO_STYLES.find(s => s.key === style).name;
    await ctx.replyWithPhoto(
      { source: image },
      { caption: `🧪 Test preview — ${arrow} ${ticker} ${formatAdminPrice(price, { stable: coin.stable })} (${styleName} style)\nNot posted to the channel.` }
    );
  } catch (err) {
    console.error('[admin] Test banner failed:', err);
    await ctx.reply(`Couldn't generate the preview: ${err.message}`);
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

