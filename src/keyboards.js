import { Markup } from 'telegraf';
import { COINS } from './config.js';

export const mainReplyKeyboard = Markup.keyboard([
  ['⚙️ Settings', '🔕 Mute'],
  ['📊 Status'],
]).resize();

export function coinListKeyboard(prefix) {
  const buttons = COINS.map(c => Markup.button.callback(`${c.ticker} ▸`, `${prefix}:${c.ticker}`));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  return Markup.inlineKeyboard(rows);
}

export function coinDetailKeyboard(ticker) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Edit threshold', `edit:${ticker}`)],
    [Markup.button.callback('🔕 Mute', `mutemenu:${ticker}`)],
    [Markup.button.callback('🔙 Back', 'back:settings')],
  ]);
}

export function muteMenuKeyboard(ticker) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔕 Until I unmute', `muteindef:${ticker}`)],
    [Markup.button.callback('⏰ Mute until time', `mutetime:${ticker}`)],
    [Markup.button.callback('🔔 Unmute now', `unmute:${ticker}`)],
    [Markup.button.callback('🔙 Back', `coin:${ticker}`)],
  ]);
}

export function backToCoinKeyboard(ticker) {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', `coin:${ticker}`)]]);
}
