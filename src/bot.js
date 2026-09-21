import { Telegraf } from 'telegraf';
import { CONFIG } from './config.js';
import { registerStartHandlers } from './handlers/start.js';
import { registerSettingsHandlers } from './handlers/settings.js';
import { registerMuteHandlers } from './handlers/mute.js';

export function createBot({ onChannelConnected }) {
  if (!CONFIG.botToken) throw new Error('BOT_TOKEN is not set');
  if (!CONFIG.ownerId) throw new Error('OWNER_TELEGRAM_ID is not set');

  const bot = new Telegraf(CONFIG.botToken);

  // Owner-only guard: silently drop any update not from the configured
  // owner. This runs before every other handler.
  bot.use(async (ctx, next) => {
    const senderId = ctx.from?.id;
    if (senderId !== CONFIG.ownerId) return; // silently ignore everyone else
    return next();
  });

  registerStartHandlers(bot, { onChannelConnected });
  registerSettingsHandlers(bot);
  registerMuteHandlers(bot);

  // Only /start is registered as a visible menu command, per spec —
  // everything else is button-driven.
  bot.telegram
    .setMyCommands([{ command: 'start', description: 'Connect and open the menu' }])
    .catch(err => console.warn('[bot] Could not set menu commands:', err.message));

  return bot;
}
