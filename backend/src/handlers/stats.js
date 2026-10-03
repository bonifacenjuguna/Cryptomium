// "📈 Post history" (how many banners have gone out, and when) and
// "🔭 Next alert" (how close each coin is to triggering right now) — both
// reached from the 📊 Status screen.
import { COINS, coinByTicker } from '../config.js';
import { getCoinSettings, postCounts, postCountsByCoin, POST_PERIODS } from '../db.js';
import { getLatestPrices, describeError } from '../priceService.js';
import { nextAlertDistance, formatStep } from '../milestoneEngine.js';
import { isMuted } from '../coinView.js';
import { safeEdit } from '../telegramUtil.js';
import { postHistoryKeyboard, nextAlertKeyboard } from '../keyboards.js';

const DEFAULT_PERIOD = '24h';

export function registerStatsHandlers(bot) {
  // --- Post history ----------------------------------------------------
  bot.action('posthistory', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(await postHistoryView(DEFAULT_PERIOD), postHistoryKeyboard(DEFAULT_PERIOD));
  });

  bot.action(/^history:(\w+)$/, async ctx => {
    const period = ctx.match[1];
    if (!POST_PERIODS[period]) return ctx.answerCbQuery('Unknown period.');
    await ctx.answerCbQuery();
    const text = await postHistoryView(period);
    await safeEdit(ctx, text, postHistoryKeyboard(period));
  });

  // --- Next alert --------------------------------------------------------
  bot.action('nextalert', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(await nextAlertView(), { parse_mode: 'HTML', ...nextAlertKeyboard() });
  });

  bot.action('nextalert:refresh', async ctx => {
    try {
      const text = await nextAlertView();
      const changed = await safeEdit(ctx, text, { parse_mode: 'HTML', ...nextAlertKeyboard() });
      await ctx.answerCbQuery(changed ? 'Updated ✅' : 'Already up to date');
    } catch (err) {
      console.error('[stats] Next alert refresh failed:', err);
      await ctx.answerCbQuery('Couldn\'t refresh — try again in a moment.', { show_alert: true }).catch(() => {});
    }
  });
}

// ----------------------------------------------------------------------
// 📈 Post history
// ----------------------------------------------------------------------
async function postHistoryView(periodKey) {
  const period = POST_PERIODS[periodKey];
  const [totals, byCoin] = await Promise.all([postCounts(periodKey), postCountsByCoin(periodKey)]);

  const header = `📈 Post history — ${period.label}`;
  if (totals.total === 0) {
    return `${header}\n\nNo posts in this period.`;
  }

  const summary = `Total: ${totals.total}  (auto: ${totals.auto} · manual: ${totals.manual})`;
  const lines = byCoin
    .filter(c => c.total > 0)
    .map(c => `${c.ticker} — ${c.total}${c.auto && c.manual ? ` (auto ${c.auto} · manual ${c.manual})` : ''}`);

  return `${header}\n\n${summary}\n\n${lines.join('\n')}`;
}

// ----------------------------------------------------------------------
// 🔭 Next alert
// ----------------------------------------------------------------------
async function nextAlertView() {
  let latest;
  try {
    latest = await getLatestPrices();
  } catch (err) {
    return `🔭 <b>Next alert</b>\n\nCouldn't fetch live prices right now (${escapeHtml(describeError(err))}). Try again in a moment.`;
  }

  const lines = [];
  let mutedCount = 0;
  for (const coin of COINS) {
    const settings = await getCoinSettings(coin.ticker);
    if (isMuted(settings)) {
      mutedCount++;
      continue;
    }
    const price = latest.prices.get(coin.ticker);
    if (price === undefined) continue;

    lines.push(`<b>${coin.ticker}</b> ${describeDistance(coin, settings, price)}`);
  }

  const header = `🔭 <b>Next alert</b>\n<i>How close each coin is right now — ${latest.source} · updated just now</i>`;
  const footer = mutedCount > 0 ? `\n\n<i>${mutedCount} muted coin${mutedCount === 1 ? '' : 's'} hidden</i>` : '';
  return `${header}\n\n${lines.join('\n')}${footer}`;
}

function describeDistance(coin, settings, price) {
  const d = nextAlertDistance(coin, settings, price);
  if (d.kind === 'baselining') return '— waiting for the first reading';
  if (d.kind === 'stable-outside') {
    const arrow = d.direction === 'up' ? '▲' : '▼';
    return `⚠️ outside the band (${arrow}) · ${formatStep('usd', d.toReturn)} back to $1.00`;
  }
  // 'ladder', 'pct', and 'stable-armed' all describe two distances the same way.
  return `▲ +${formatStep(d.unit, d.toUp)} · ▼ -${formatStep(d.unit, d.toDown)}`;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
