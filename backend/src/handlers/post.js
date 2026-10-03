// "📣 Post prices": post the CURRENT price of one coin, or of all coins, to the
// channel on demand (as opposed to the automatic milestone alerts).
import { COINS, CONFIG, coinByTicker } from '../config.js';
import { getState, logPost } from '../db.js';
import { getLatestPrices, getChanges24h } from '../priceService.js';
import { generateBannerImage } from '../imageGenerator.js';
import { buildCaption } from '../caption.js';
import { formatAdminPrice } from '../coinView.js';
import { safeEdit } from '../telegramUtil.js';
import { MENU, postListKeyboard, postConfirmKeyboard } from '../keyboards.js';

const POST_TEXT =
  '📣 Post current prices to the channel.\n' +
  'Pick one coin, or post all of them. (You\'ll be asked to confirm.)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const posting = new Set(); // owner ids with a post in progress (guards against double taps)

export function registerPostHandlers(bot) {
  bot.hears(MENU.post, async ctx => {
    await ctx.reply(POST_TEXT, postListKeyboard());
  });

  bot.action('postmenu', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(POST_TEXT, postListKeyboard());
  });

  bot.action('back:post', async ctx => {
    await ctx.answerCbQuery();
    await safeEdit(ctx, POST_TEXT, postListKeyboard());
  });

  // Confirmation screen.
  bot.action(/^post:(\w+)$/, async ctx => {
    await ctx.answerCbQuery();
    const target = ctx.match[1];
    if (target !== 'ALL' && !coinByTicker(target)) return;

    const channel = await channelName();
    if (!channel) {
      await safeEdit(ctx, 'No channel is connected yet, so there is nowhere to post. Connect one with /start first.', postListKeyboard());
      return;
    }

    let detail = '';
    if (target !== 'ALL') {
      try {
        const latest = await getLatestPrices();
        const price = latest.prices.get(target);
        if (price !== undefined) detail = ` (now ${formatAdminPrice(price, { stable: coinByTicker(target).stable })})`;
      } catch {
        /* the price is fetched again when posting */
      }
    }
    const what = target === 'ALL' ? `all ${COINS.length} coins` : `${target}${detail}`;
    await safeEdit(ctx, `Post ${what} to ${channel}?\nThe banner uses the live price and the 24h direction.`, postConfirmKeyboard(target));
  });

  bot.action(/^postgo:(\w+)$/, async ctx => {
    const target = ctx.match[1];
    // Check-and-set with no await in between, so two quick taps can't both get through.
    if (posting.has(ctx.from.id)) return ctx.answerCbQuery('Already posting — one moment.', { show_alert: true });
    posting.add(ctx.from.id);
    try {
      await ctx.answerCbQuery('Posting…');
      const tickers = target === 'ALL' ? COINS.map(c => c.ticker) : [target];
      await safeEdit(ctx, `📣 Posting ${tickers.length === 1 ? tickers[0] : `${tickers.length} coins`}…`);
      const summary = await postCurrentPrices(ctx.telegram, tickers);
      await safeEdit(ctx, summary, postListKeyboard());
    } catch (err) {
      console.error('[post] Failed:', err);
      await safeEdit(ctx, `Couldn't post: ${err.message}`, postListKeyboard());
    } finally {
      posting.delete(ctx.from.id);
    }
  });
}

async function channelName() {
  const id = await getState('channel_id');
  if (!id) return null;
  return (await getState('channel_name')) || 'your channel';
}

/**
 * Posts the current price banner for each ticker. The chip shows the 24h
 * direction when it is known (green up / red down); otherwise the banner has
 * no chip. Returns a summary message for the owner.
 */
export async function postCurrentPrices(telegram, tickers, { sleepFn = sleep } = {}) {
  const channelId = await getState('channel_id');
  if (!channelId) throw new Error('no channel is connected');

  const latest = await getLatestPrices({ force: true });
  const changes = await getChanges24h();

  const posted = [];
  const skipped = [];
  const failed = [];

  for (const ticker of tickers) {
    const price = latest.prices.get(ticker);
    if (price === undefined) {
      skipped.push(ticker);
      continue;
    }

    const change = changes.get(ticker);
    const direction = change === undefined ? null : change >= 0 ? 'up' : 'down';
    try {
      const image = await generateBannerImage({ ticker, price, direction });
      const caption = buildCaption({ ticker, price, direction, changePct: change ?? null });
      await telegram.sendPhoto(channelId, { source: image }, { caption });
      await logPost({ ticker, kind: 'manual', direction, price });
      posted.push(ticker);
    } catch (err) {
      console.error(`[post] ${ticker} failed:`, err);
      failed.push(`${ticker} (${err.description || err.message})`);
    }
    if (ticker !== tickers[tickers.length - 1]) await sleepFn(CONFIG.postDelayMs);
  }

  let summary = `✅ Posted ${posted.length}/${tickers.length}${posted.length === 1 ? `: ${posted[0]}` : ''}.`;
  if (skipped.length) summary += `\nSkipped (no price right now): ${skipped.join(', ')}.`;
  if (failed.length) summary += `\nFailed: ${failed.join('; ')}.`;
  return summary;
}
