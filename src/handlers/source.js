// Settings screens for WHERE prices come from, and how logos are framed.
import { SOURCE_MODES, LOGO_STYLES, sourceModeByKey } from '../config.js';
import { getState, setState } from '../db.js';
import { getPreferredSource, setPreferredSource, getSourceHealth, testProviders } from '../priceService.js';
import { getLogoStyle, setLogoStyle } from '../imageGenerator.js';
import { safeEdit } from '../telegramUtil.js';
import { sourceKeyboard, testSourcesKeyboard, logoStyleKeyboard } from '../keyboards.js';

export const SOURCE_STATE_KEY = 'price_source';
export const LOGO_STYLE_STATE_KEY = 'logo_style';

/** Loads the saved choices at startup (called from index.js). */
export async function loadSavedPreferences() {
  const source = await getState(SOURCE_STATE_KEY);
  if (SOURCE_MODES.some(m => m.key === source)) setPreferredSource(source);
  const style = await getState(LOGO_STYLE_STATE_KEY);
  if (LOGO_STYLES.some(s => s.key === style)) setLogoStyle(style);
}

export function registerSourceHandlers(bot) {
  // --- Data source ------------------------------------------------------
  bot.action('source', async ctx => {
    await ctx.answerCbQuery();
    await safeEdit(ctx, sourceText(), sourceKeyboard(getPreferredSource()));
  });

  bot.action(/^setsource:(\w+)$/, async ctx => {
    const key = ctx.match[1];
    if (!SOURCE_MODES.some(m => m.key === key)) return ctx.answerCbQuery('Unknown source.');
    await setState(SOURCE_STATE_KEY, key);
    setPreferredSource(key);
    const mode = sourceModeByKey(key);
    await ctx.answerCbQuery(`${mode.emoji} ${mode.name}`);
    await safeEdit(ctx, sourceText(), sourceKeyboard(key));
  });

  bot.action('testsources', async ctx => {
    await ctx.answerCbQuery('Testing…');
    await safeEdit(ctx, '🔍 Testing the price sources…', testSourcesKeyboard());
    const results = await testProviders();
    await safeEdit(ctx, testResultsText(results), testSourcesKeyboard());
  });

  // --- Logo style -----------------------------------------------------------
  bot.action('logostyle', async ctx => {
    await ctx.answerCbQuery();
    await safeEdit(ctx, logoStyleText(), logoStyleKeyboard(getLogoStyle()));
  });

  bot.action(/^setlogostyle:(\w+)$/, async ctx => {
    const key = ctx.match[1];
    const style = LOGO_STYLES.find(s => s.key === key);
    if (!style) return ctx.answerCbQuery('Unknown style.');
    await setState(LOGO_STYLE_STATE_KEY, key);
    setLogoStyle(key);
    await ctx.answerCbQuery(`${style.emoji} ${style.name}`);
    await safeEdit(ctx, logoStyleText(), logoStyleKeyboard(key));
  });
}

function sourceText() {
  const mode = sourceModeByKey(getPreferredSource());
  const health = getSourceHealth();

  let status = '✅ Everything looks healthy.';
  if (health.outageActive) status = '🚨 Every source is failing right now.';
  else if (health.fallbackActive) status = `⚠️ ${health.primary} is failing — the backup is being used.`;

  return (
    '🌐 Data source — where prices come from\n\n' +
    `Now: ${mode.emoji} ${mode.name} — ${mode.desc}\n` +
    `${status}\n\n` +
    SOURCE_MODES.map(m => `${m.emoji} ${m.name} — ${m.desc}`).join('\n') +
    '\n\nStablecoins (USDT, USDC) always use CoinGecko, because Binance doesn\'t price them in dollars.\n' +
    'Use "Test sources" to check both right now.'
  );
}

function testResultsText(results) {
  const lines = results.map(r => {
    if (!r.ok) return `${r.label}: ❌ ${r.error} (${r.ms} ms)`;
    return `${r.label}: ✅ ${r.ms} ms · ${r.count}/${r.expected} coins · ${r.host}`;
  });
  const allOk = results.every(r => r.ok);
  const note = allOk
    ? 'Both sources work, so the automatic backup has something to fall back to.'
    : 'A failing source can\'t act as a backup. If Binance shows "blocked", your server region is refused — CoinGecko will keep working on its own.';
  return `🔍 Source test\n\n${lines.join('\n')}\n\n${note}`;
}

function logoStyleText() {
  const current = LOGO_STYLES.find(s => s.key === getLogoStyle());
  return (
    '🖼️ Logo style — how the coin logo is framed on banners\n\n' +
    `Now: ${current.emoji} ${current.name} — ${current.desc}\n\n` +
    LOGO_STYLES.map(s => `${s.emoji} ${s.name} — ${s.desc}`).join('\n') +
    '\n\nTip: switch, then tap "Preview with Test banner" to compare.'
  );
}
