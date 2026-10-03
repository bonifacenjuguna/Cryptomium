// "📊 Chart" (reached from 📣 Post prices): renders a price-history chart for
// one coin — pick a coin, a time range, and a style (line or candlesticks) —
// and lets the owner post the result to the channel. Nothing renders until
// the owner explicitly taps a style button; picking a coin or a range alone
// never triggers a fetch or a render.
import { CONFIG, coinByTicker } from '../config.js';
import { getState, logPost } from '../db.js';
import { CHART_RANGES, chartRangeByKey, parseCustomDays, fetchChartData } from '../chartData.js';
import { generateChartImage } from '../chartGenerator.js';
import { pending } from '../pending.js';
import { safeEdit } from '../telegramUtil.js';
import {
  coinListKeyboard, chartRangeKeyboard, chartStyleKeyboard, chartPostKeyboard,
} from '../keyboards.js';

const CHART_LIST_TEXT = '📊 Chart — pick a coin.';

// The most recently rendered chart per owner, kept only long enough for them
// to tap "Post to channel" — avoids re-fetching/re-rendering just to post the
// exact image they already saw.
const lastRendered = new Map(); // userId -> { buffer, caption }

export function registerChartHandlers(bot) {
  bot.action('chartmenu', async ctx => {
    await ctx.answerCbQuery();
    await safeEdit(ctx, CHART_LIST_TEXT, coinListKeyboard('chart'));
  });

  bot.action(/^chart:(\w+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    await safeEdit(ctx, `📊 ${ticker} — pick a time range:`, chartRangeKeyboard(ticker));
  });

  bot.action(/^chartrange:(\w+):(\w+)$/, async ctx => {
    const [, ticker, rangeKey] = ctx.match;
    const range = chartRangeByKey(rangeKey);
    if (!range) return ctx.answerCbQuery('Unknown range.');
    await ctx.answerCbQuery();
    await safeEdit(ctx, `📊 ${ticker} · ${range.label} — line or candlesticks?`, chartStyleKeyboard(ticker, rangeKey));
  });

  bot.action(/^chartcustom:(\w+)$/, async ctx => {
    await ctx.answerCbQuery();
    const ticker = ctx.match[1];
    pending.set(ctx.from.id, 'chartcustomdays', { ticker });
    await ctx.reply('How many days back (1-365)? e.g. "45" or "45 days".');
  });

  bot.on('text', async (ctx, next) => {
    const flow = pending.get(ctx.from.id, 'chartcustomdays');
    if (!flow) return next();
    const days = parseCustomDays(ctx.message.text);
    if (days === null) {
      await ctx.reply('Send a number of days between 1 and 365, e.g. "45".');
      return;
    }
    pending.clear(ctx.from.id);
    await ctx.reply(
      `📊 ${flow.ticker} · Custom (${days}d) — line or candlesticks?`,
      chartStyleKeyboard(flow.ticker, `custom:${days}`)
    );
  });

  // chartgo:<TICKER>:<rangeToken>:<line|candles>  — the one action that actually renders.
  bot.action(/^chartgo:(\w+):([\w:]+):(line|candles)$/, async ctx => {
    const [, ticker, rangeToken, style] = ctx.match;
    await ctx.answerCbQuery('Rendering…');
    await renderAndShow(ctx, ticker, rangeToken, style);
  });

  bot.action('chartpost', async ctx => {
    const rendered = lastRendered.get(ctx.from.id);
    if (!rendered) return ctx.answerCbQuery('That chart expired — render a new one.', { show_alert: true });

    const channelId = await getState('channel_id');
    if (!channelId) {
      await ctx.answerCbQuery();
      await ctx.reply('No channel is connected yet, so there is nowhere to post. Connect one with /start first.');
      return;
    }

    await ctx.answerCbQuery('Posting…');
    try {
      await ctx.telegram.sendPhoto(channelId, { source: rendered.buffer }, { caption: rendered.caption });
      await logPost({ ticker: rendered.ticker, kind: 'manual', direction: null, price: rendered.lastPrice });
      await ctx.reply(`✅ Posted the ${rendered.ticker} chart to the channel.`);
    } catch (err) {
      console.error('[chart] Post failed:', err);
      await ctx.reply(`Couldn't post the chart: ${err.description || err.message}`);
    }
  });
}

async function renderAndShow(ctx, ticker, rangeToken, style) {
  const coin = coinByTicker(ticker);
  if (!coin) return ctx.reply('Unknown coin.');

  const isCustom = rangeToken.startsWith('custom:');
  const days = isCustom ? Number(rangeToken.split(':')[1]) : chartRangeByKey(rangeToken)?.days;
  const rangeLabel = isCustom ? `Custom (${days}d)` : chartRangeByKey(rangeToken).label;
  if (!Number.isFinite(days)) return ctx.reply('Unknown range.');

  let data;
  try {
    data = await fetchChartData(coin, days, style);
  } catch (err) {
    console.error(`[chart] ${ticker} fetch failed:`, err);
    await ctx.reply(`Couldn't fetch chart data for ${ticker}: ${err.message}`);
    return;
  }

  const styleNote = data.style !== style
    ? ` (candles aren't available for a custom range, so this is a line chart)`
    : '';

  let buffer;
  try {
    buffer = await generateChartImage({ ticker, style: data.style, days, rangeLabel, points: data.points });
  } catch (err) {
    console.error(`[chart] ${ticker} render failed:`, err);
    await ctx.reply(`Couldn't render the chart: ${err.message}`);
    return;
  }

  const lastPrice = data.style === 'candles' ? data.points.at(-1).c : data.points.at(-1).price;
  const caption = `📊 ${ticker} · ${rangeLabel} chart ${CONFIG.watermark}`;
  lastRendered.set(ctx.from.id, { ticker, buffer, caption, lastPrice });

  await ctx.replyWithPhoto(
    { source: buffer },
    { caption: `${caption}${styleNote}\nNot posted yet — tap below to send it to the channel.`, ...chartPostKeyboard(ticker) }
  );
}
