// Owner-side tools: live prices, and the test-banner preview.
import { COINS, coinByTicker } from '../config.js';
import { getCoinSettings } from '../db.js';
import { getLatestPrices } from '../priceService.js';
import { previewLevel } from '../milestoneEngine.js';
import { generateBannerImage } from '../imageGenerator.js';
import { formatAdminPrice, isMuted, modeText, stepText } from '../coinView.js';
import { formatClock } from '../timezone.js';
import { parseTestPrice } from '../inputParsing.js';
import { pending } from '../pending.js';
import { safeEdit } from '../telegramUtil.js';
import {
  MENU, coinListKeyboard, pricesKeyboard, testOptionsKeyboard, testDirectionKeyboard,
} from '../keyboards.js';

const TEST_LIST_TEXT =
  '🧪 Test banner — pick a coin.\nThe preview is sent only to you, never to the channel.';

export function registerAdminHandlers(bot) {
  // ------------------------------------------------------------------
  // 💰 Prices
  // ------------------------------------------------------------------
  bot.hears(MENU.prices, async ctx => {
    const view = await buildPricesView({ force: false });
    await ctx.reply(view.text, { parse_mode: 'HTML', ...pricesKeyboard() });
  });

  bot.action('prices:refresh', async ctx => {
    const view = await buildPricesView({ force: true });
    await ctx.answerCbQuery(view.ok ? 'Refreshed' : 'Could not refresh');
    await safeEdit(ctx, view.text, { parse_mode: 'HTML', ...pricesKeyboard() });
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
      testOptionsKeyboard(ticker)
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
        testDirectionKeyboard(flow.ticker, parsed.price)
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
    latest = await getLatestPrices({ force });
  } catch (err) {
    return { ok: false, text: `Couldn't fetch live prices right now (${escapeHtml(err.message)}). Try again in a moment.` };
  }

  const lines = [];
  for (const coin of COINS) {
    const price = latest.prices.get(coin.ticker);
    const settings = await getCoinSettings(coin.ticker);
    const priceCell = price === undefined ? 'n/a' : formatAdminPrice(price, { stable: coin.stable });
    const mode = modeText(settings, { withMultiplier: false }).split(' ')[0]; // just the emoji
    const bell = isMuted(settings) ? '🔕' : '🔔';
    lines.push(
      `${coin.ticker.padEnd(5)}${priceCell.padStart(13)}  ${stepText(coin, settings).padEnd(7)} ${mode} ${bell}`
    );
  }

  const header = `💰 <b>Live prices</b> · ${latest.source} · ${formatClock(new Date(latest.at))}`;
  const legend = 'Step and mode shown after each price.';
  return { ok: true, text: `${header}\n<pre>${escapeHtml(lines.join('\n'))}</pre>${legend}` };
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
      latest = await getLatestPrices();
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

  try {
    const image = await generateBannerImage({ ticker, price, direction });
    const arrow = direction === 'up' ? '▲' : '▼';
    await ctx.replyWithPhoto(
      { source: image },
      { caption: `🧪 Test preview — ${arrow} ${ticker} ${formatAdminPrice(price, { stable: coin.stable })}\nNot posted to the channel.` }
    );
  } catch (err) {
    console.error('[admin] Test banner failed:', err);
    await ctx.reply(`Couldn't generate the preview: ${err.message}`);
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
