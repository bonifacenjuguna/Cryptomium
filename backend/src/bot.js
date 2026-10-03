import { Telegraf } from 'telegraf';
import { CONFIG } from './config.js';
import { registerStartHandlers } from './handlers/start.js';
import { registerSettingsHandlers } from './handlers/settings.js';
import { registerMuteHandlers } from './handlers/mute.js';
import { registerAdminHandlers } from './handlers/admin.js';
import { registerPostHandlers } from './handlers/post.js';
import { registerSourceHandlers } from './handlers/source.js';
import { registerStatsHandlers } from './handlers/stats.js';
import { registerChartHandlers } from './handlers/chart.js';
import { MENU_LABELS } from './keyboards.js';
import { pending } from './pending.js';

export function createBot({ onChannelConnected }) {
  if (!CONFIG.botToken) throw new Error('BOT_TOKEN is not set');
  if (!CONFIG.ownerId) throw new Error('OWNER_TELEGRAM_ID is not set');

  const bot = new Telegraf(CONFIG.botToken);

  // One failing handler must never take the whole bot (and the alert loop) down.
  // Telegraf's default is to rethrow, which ends polling and exits the process.
  bot.catch((err, ctx) => {
    console.error(`[bot] Error while handling update ${ctx?.update?.update_id}:`, err);
  });

  // Owner-only guard: silently drop any update not from the configured
  // owner. This runs before every other handler.
  bot.use(async (ctx, next) => {
    const senderId = ctx.from?.id;
    if (senderId !== CONFIG.ownerId) return; // silently ignore everyone else
    return next();
  });

  // Tapping a menu button (or sending a /command) cancels any half-finished
  // "type your answer" flow, so a button press is never mistaken for an answer.
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    if (text && (MENU_LABELS.includes(text) || text.startsWith('/'))) pending.clear(ctx.from.id);
    return next();
  });

  registerStartHandlers(bot, { onChannelConnected });
  registerSettingsHandlers(bot);
  registerMuteHandlers(bot);
  registerAdminHandlers(bot);
  registerPostHandlers(bot);
  registerSourceHandlers(bot);
  registerStatsHandlers(bot);
  registerChartHandlers(bot);

  // Only /start is registered as a visible menu command, per spec —
  // everything else is button-driven.
  bot.telegram
    .setMyCommands([{ command: 'start', description: 'Connect and open the menu' }])
    .catch(err => console.warn('[bot] Could not set menu commands:', err.message));

  return bot;
}
