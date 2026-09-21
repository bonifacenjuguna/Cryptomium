import { Markup } from 'telegraf';
import { COINS, MODES, coinByTicker } from './config.js';
import { stepText } from './coinView.js';

// --- Main menu (the persistent keyboard under the message box) -------------
export const MENU = {
  prices: '💰 Prices',
  status: '📊 Status',
  settings: '⚙️ Settings',
  mute: '🔕 Mute',
  test: '🧪 Test banner',
};
export const MENU_LABELS = Object.values(MENU);

export const mainReplyKeyboard = Markup.keyboard([
  [MENU.prices, MENU.status],
  [MENU.settings, MENU.mute],
  [MENU.test],
]).resize();

// --- Coin pickers ------------------------------------------------------------
export function coinListKeyboard(prefix, extraRows = []) {
  const buttons = COINS.map(c => Markup.button.callback(`${c.ticker} ▸`, `${prefix}:${c.ticker}`));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  return Markup.inlineKeyboard([...rows, ...extraRows]);
}

export function settingsListKeyboard() {
  return coinListKeyboard('coin', [
    [Markup.button.callback('🎚️ Modes · all coins', 'allmodes')],
    [Markup.button.callback('％ / $ · all coins', 'allunits')],
  ]);
}

// --- Per-coin settings --------------------------------------------------------
export function coinDetailKeyboard(ticker, settings) {
  const switchTo = settings.step_unit === 'pct' ? 'Switch to $ steps' : 'Switch to % steps';
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✏️ Edit step', `edit:${ticker}`),
      Markup.button.callback(`🔁 ${switchTo}`, `unit:${ticker}`),
    ],
    [Markup.button.callback('🎚️ Mode', `modemenu:${ticker}`)],
    [Markup.button.callback('🔕 Mute', `mutemenu:${ticker}`)],
    [Markup.button.callback('🔙 Back', 'back:settings')],
  ]);
}

// Each mode row shows the step it would give THIS coin, so the choice is concrete.
export function modeKeyboard(ticker, settings) {
  const coin = coinByTicker(ticker);
  const rows = MODES.map(mode => {
    const preview = stepText(coin, { ...settings, mode: mode.key });
    const tick = settings.mode === mode.key ? ' ✓' : '';
    return [Markup.button.callback(`${mode.emoji} ${mode.name} — ${preview}${tick}`, `setmode:${ticker}:${mode.key}`)];
  });
  rows.push([Markup.button.callback('🔙 Back', `coin:${ticker}`)]);
  return Markup.inlineKeyboard(rows);
}

export function allModesKeyboard() {
  const rows = MODES.map(mode => [
    Markup.button.callback(`${mode.emoji} ${mode.name} (${mode.label})`, `allmode:${mode.key}`),
  ]);
  rows.push([Markup.button.callback('🔙 Back', 'back:settings')]);
  return Markup.inlineKeyboard(rows);
}

export function allUnitsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('％ Switch all to % steps', 'allunit:pct')],
    [Markup.button.callback('$ Switch all to $ steps', 'allunit:usd')],
    [Markup.button.callback('🔙 Back', 'back:settings')],
  ]);
}

// --- Mute -----------------------------------------------------------------------
export function muteListKeyboard() {
  return coinListKeyboard('mutemenu', [
    [
      Markup.button.callback('🔕 Mute all', 'bulk:all'),
      Markup.button.callback('🔔 Unmute all', 'bulkun:all'),
    ],
    [Markup.button.callback('☑️ Pick several', 'bulk:pick')],
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

export function bulkPickKeyboard(selected) {
  const buttons = COINS.map(c =>
    Markup.button.callback(`${selected.has(c.ticker) ? '✅' : '⬜'} ${c.ticker}`, `bpick:${c.ticker}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  rows.push([
    Markup.button.callback('☑️ Select all', 'bpick:all'),
    Markup.button.callback('⬜ Clear', 'bpick:none'),
  ]);
  rows.push([
    Markup.button.callback('🔕 Mute selected ▸', 'bgo:mute'),
    Markup.button.callback('🔔 Unmute selected', 'bgo:unmute'),
  ]);
  rows.push([Markup.button.callback('🔙 Back', 'back:mute')]);
  return Markup.inlineKeyboard(rows);
}

export function bulkDurationKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔕 Until I unmute', 'bdur:indef')],
    [Markup.button.callback('⏰ Mute until time', 'bdur:time')],
    [Markup.button.callback('🔙 Back', 'back:mute')],
  ]);
}

// --- Admin: prices + test banner ---------------------------------------------------
export function pricesKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh', 'prices:refresh')]]);
}

export function testOptionsKeyboard(ticker) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('▲ Rise', `testgo:${ticker}:up`),
      Markup.button.callback('▼ Fall', `testgo:${ticker}:down`),
    ],
    [Markup.button.callback('✏️ Custom price', `testcustom:${ticker}`)],
    [Markup.button.callback('🔙 Back', 'back:test')],
  ]);
}

export function testDirectionKeyboard(ticker, price) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('▲ Rise', `testgo:${ticker}:up:${price}`),
      Markup.button.callback('▼ Fall', `testgo:${ticker}:down:${price}`),
    ],
  ]);
}
