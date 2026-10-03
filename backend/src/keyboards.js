import { Markup } from 'telegraf';
import { COINS, MODES, SOURCE_MODES, LOGO_STYLES, DEFAULT_LOGO_STYLE, coinByTicker } from './config.js';
import { stepText } from './coinView.js';
import { CHART_RANGES } from './chartData.js';

// --- Main menu (the persistent keyboard under the message box) -------------
export const MENU = {
  prices: '💰 Prices',
  post: '📣 Post prices',
  status: '📊 Status',
  settings: '⚙️ Settings',
  mute: '🔕 Mute',
  test: '🧪 Test banner',
};
export const MENU_LABELS = Object.values(MENU);

export const mainReplyKeyboard = Markup.keyboard([
  [MENU.prices, MENU.post],
  [MENU.status, MENU.settings],
  [MENU.mute, MENU.test],
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
    [
      Markup.button.callback('🌐 Data source', 'source'),
      Markup.button.callback('🖼️ Logo style', 'logostyle'),
    ],
    [Markup.button.callback('🧹 Factory reset', 'reset')],
  ]);
}

export function resetConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Yes, erase everything', 'resetgo')],
    [Markup.button.callback('🔙 Cancel', 'back:settings')],
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

// --- Status extras (from the 📊 Status screen) ------------------------------------
export function statusExtrasKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📈 Post history', 'posthistory'),
      Markup.button.callback('🔭 Next alert', 'nextalert'),
    ],
  ]);
}

// --- Post history ----------------------------------------------------------------
export function postHistoryKeyboard(periodKey) {
  const row = keys => keys.map(([key, label]) => Markup.button.callback(`${label}${key === periodKey ? ' ✓' : ''}`, `history:${key}`));
  return Markup.inlineKeyboard([
    row([['24h', '24h'], ['7d', '7 days']]),
    row([['30d', '30 days'], ['all', 'All time']]),
  ]);
}

// --- Next alert (how close each coin is right now) -------------------------------
export function nextAlertKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh', 'nextalert:refresh')]]);
}


export function pricesKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔄 Refresh', 'prices:refresh'),
      Markup.button.callback('📣 Post…', 'postmenu'),
    ],
  ]);
}

// --- Post current prices to the channel ------------------------------------------
export function postListKeyboard() {
  return coinListKeyboard('post', [
    [Markup.button.callback('📣 Post ALL coins', 'post:ALL')],
    [Markup.button.callback('📊 Chart', 'chartmenu')],
  ]);
}

export function postConfirmKeyboard(target) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(target === 'ALL' ? '✅ Post all now' : '✅ Post now', `postgo:${target}`)],
    [Markup.button.callback('🔙 Back', 'back:post')],
  ]);
}

// --- Charts ------------------------------------------------------------------------
export function chartRangeKeyboard(ticker) {
  const rows = CHART_RANGES.map(r => [Markup.button.callback(r.label, `chartrange:${ticker}:${r.key}`)]);
  rows.push([Markup.button.callback('✏️ Custom range', `chartcustom:${ticker}`)]);
  rows.push([Markup.button.callback('🔙 Back', 'chartmenu')]);
  return Markup.inlineKeyboard(rows);
}

// rangeToken is either a CHART_RANGES key (e.g. "7d") or "custom:<days>".
export function chartStyleKeyboard(ticker, rangeToken) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📈 Line', `chartgo:${ticker}:${rangeToken}:line`),
      Markup.button.callback('🕯️ Candles', `chartgo:${ticker}:${rangeToken}:candles`),
    ],
    [Markup.button.callback('🔙 Back', `chart:${ticker}`)],
  ]);
}

export function chartPostKeyboard(ticker) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📣 Post to channel', 'chartpost')],
    [Markup.button.callback('🔄 New chart', `chart:${ticker}`)],
  ]);
}

// --- Data source (where prices come from) ------------------------------------------
export function sourceKeyboard(currentKey) {
  const rows = SOURCE_MODES.map(m => [
    Markup.button.callback(`${m.emoji} ${m.name}${m.key === currentKey ? ' ✓' : ''}`, `setsource:${m.key}`),
  ]);
  rows.push([Markup.button.callback('🔍 Test sources', 'testsources')]);
  rows.push([Markup.button.callback('🔙 Back', 'back:settings')]);
  return Markup.inlineKeyboard(rows);
}

export function testSourcesKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Test again', 'testsources')],
    [Markup.button.callback('🔙 Back', 'source')],
  ]);
}

// --- Logo style ----------------------------------------------------------------------
export function logoStyleKeyboard(currentKey) {
  const rows = LOGO_STYLES.map(st => [
    Markup.button.callback(`${st.emoji} ${st.name}${st.key === currentKey ? ' ✓' : ''}`, `setlogostyle:${st.key}`),
  ]);
  rows.push([Markup.button.callback('🧪 Preview with Test banner', 'back:test')]);
  rows.push([Markup.button.callback('🔙 Back', 'back:settings')]);
  return Markup.inlineKeyboard(rows);
}

// A per-preview logo-style toggle, shown on the Test banner screens: lets the
// owner compare ✨ Clean vs ⚪ White ring without changing the bot's default
// (Settings > Logo style). Tapping flips it and redraws the same screen.
function styleToggleRow(styleKey, action) {
  const style = LOGO_STYLES.find(s => s.key === styleKey) ?? LOGO_STYLES.find(s => s.key === DEFAULT_LOGO_STYLE);
  return [Markup.button.callback(`🖼️ Style: ${style.emoji} ${style.name} (tap to switch)`, action)];
}

export function testOptionsKeyboard(ticker, styleKey) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('▲ Rise', `testgo:${ticker}:up`),
      Markup.button.callback('▼ Fall', `testgo:${ticker}:down`),
    ],
    [Markup.button.callback('✏️ Custom price', `testcustom:${ticker}`)],
    styleToggleRow(styleKey, `teststyle:opts:${ticker}`),
    [Markup.button.callback('🔙 Back', 'back:test')],
  ]);
}

export function testDirectionKeyboard(ticker, price, styleKey) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('▲ Rise', `testgo:${ticker}:up:${price}`),
      Markup.button.callback('▼ Fall', `testgo:${ticker}:down:${price}`),
    ],
    styleToggleRow(styleKey, `teststyle:dir:${ticker}:${price}`),
  ]);
}
