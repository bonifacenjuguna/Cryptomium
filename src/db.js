import pg from 'pg';
import { CONFIG, COINS, DEFAULT_MODE } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: CONFIG.databaseUrl,
  ssl: CONFIG.databaseUrl?.includes('railway') ? { rejectUnauthorized: false } : undefined,
});

// Idempotent — safe to run on every boot. Seeds each coin row with its
// default threshold on first run only (ON CONFLICT DO NOTHING).
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coin_settings (
      ticker TEXT PRIMARY KEY,
      threshold DOUBLE PRECISION NOT NULL,
      last_milestone DOUBLE PRECISION,
      muted_indefinitely BOOLEAN NOT NULL DEFAULT FALSE,
      muted_until TIMESTAMPTZ,
      mute_timezone TEXT
    );
  `);

  // Columns added after v1.0 — additive and idempotent, so existing installs
  // upgrade in place and keep behaving exactly as before (dollar steps,
  // Steady mode) until the owner changes something.
  await pool.query(`ALTER TABLE coin_settings ADD COLUMN IF NOT EXISTS step_unit TEXT NOT NULL DEFAULT 'usd'`);
  await pool.query(`ALTER TABLE coin_settings ADD COLUMN IF NOT EXISTS pct_threshold DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE coin_settings ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT '${DEFAULT_MODE}'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // One row per banner actually sent to the channel — milestone alerts
  // ('auto', from the scheduler) and on-demand posts ('manual', from
  // 📣 Post prices). Powers "🔭 Post history" (how many, over what period).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_log (
      id BIGSERIAL PRIMARY KEY,
      ticker TEXT NOT NULL,
      kind TEXT NOT NULL,
      direction TEXT,
      price DOUBLE PRECISION NOT NULL,
      posted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS post_log_posted_at_idx ON post_log (posted_at)`);

  for (const coin of COINS) {
    await pool.query(
      `INSERT INTO coin_settings (ticker, threshold, pct_threshold)
       VALUES ($1, $2, $3)
       ON CONFLICT (ticker) DO NOTHING`,
      [coin.ticker, coin.defaultThreshold, coin.defaultPercent]
    );
    // Backfill the percentage base for rows created before it existed.
    await pool.query(
      `UPDATE coin_settings SET pct_threshold = $2 WHERE ticker = $1 AND pct_threshold IS NULL`,
      [coin.ticker, coin.defaultPercent]
    );
  }
}

export async function getCoinSettings(ticker) {
  const { rows } = await pool.query('SELECT * FROM coin_settings WHERE ticker = $1', [ticker]);
  return rows[0] || null;
}

export async function getAllCoinSettings() {
  const { rows } = await pool.query('SELECT * FROM coin_settings ORDER BY ticker');
  return rows;
}

export async function setThreshold(ticker, threshold) {
  await pool.query('UPDATE coin_settings SET threshold = $2 WHERE ticker = $1', [ticker, threshold]);
}

/** Sets the base step (x) for the coin's currently active unit. */
export async function setBaseStep(ticker, unit, value) {
  const column = unit === 'pct' ? 'pct_threshold' : 'threshold';
  await pool.query(`UPDATE coin_settings SET ${column} = $2 WHERE ticker = $1`, [ticker, value]);
}

/**
 * Switches a coin between dollar steps ('usd') and percentage steps ('pct').
 * The ladder position is cleared so the next price reading silently
 * re-baselines instead of firing an alert based on the old unit.
 */
export async function setStepUnit(ticker, unit) {
  await pool.query(
    `UPDATE coin_settings SET step_unit = $2, last_milestone = NULL WHERE ticker = $1`,
    [ticker, unit]
  );
}

export async function setStepUnitForAll(unit) {
  await pool.query(`UPDATE coin_settings SET step_unit = $1, last_milestone = NULL`, [unit]);
}

export async function setMode(ticker, modeKey) {
  await pool.query('UPDATE coin_settings SET mode = $2 WHERE ticker = $1', [ticker, modeKey]);
}

export async function setModeForAll(modeKey) {
  await pool.query('UPDATE coin_settings SET mode = $1', [modeKey]);
}

export async function setLastMilestone(ticker, price) {
  await pool.query('UPDATE coin_settings SET last_milestone = $2 WHERE ticker = $1', [ticker, price]);
}

export async function muteIndefinitely(ticker) {
  await pool.query(
    `UPDATE coin_settings SET muted_indefinitely = TRUE, muted_until = NULL WHERE ticker = $1`,
    [ticker]
  );
}

export async function muteUntil(ticker, isoTimestamp, timezone) {
  await pool.query(
    `UPDATE coin_settings SET muted_indefinitely = FALSE, muted_until = $2, mute_timezone = $3 WHERE ticker = $1`,
    [ticker, isoTimestamp, timezone]
  );
}

export async function unmute(ticker) {
  await pool.query(
    `UPDATE coin_settings SET muted_indefinitely = FALSE, muted_until = NULL, mute_timezone = NULL WHERE ticker = $1`,
    [ticker]
  );
}

// ----------------------------------------------------------------------
// Post log — one row per banner actually sent to the channel
// ----------------------------------------------------------------------

/** Records a banner that was just sent. Call this AFTER the send succeeds. */
export async function logPost({ ticker, kind, direction = null, price }) {
  await pool.query(
    `INSERT INTO post_log (ticker, kind, direction, price) VALUES ($1, $2, $3, $4)`,
    [ticker, kind, direction, price]
  );
}

export const POST_PERIODS = {
  '24h': { label: 'Last 24 hours', hours: 24 },
  '7d': { label: 'Last 7 days', hours: 24 * 7 },
  '30d': { label: 'Last 30 days', hours: 24 * 30 },
  all: { label: 'All time', hours: null },
};

function sinceClause(periodKey) {
  const period = POST_PERIODS[periodKey] ?? POST_PERIODS['24h'];
  return period.hours === null ? null : `now() - interval '${period.hours} hours'`;
}

/** Totals for a period: { total, auto, manual }. */
export async function postCounts(periodKey) {
  const since = sinceClause(periodKey);
  const { rows } = await pool.query(
    `SELECT kind, COUNT(*)::int AS count FROM post_log
     ${since ? `WHERE posted_at >= ${since}` : ''}
     GROUP BY kind`
  );
  const byKind = Object.fromEntries(rows.map(r => [r.kind, r.count]));
  const auto = byKind.auto ?? 0;
  const manual = byKind.manual ?? 0;
  return { total: auto + manual, auto, manual };
}

/** Per-coin totals for a period, most-posted first: [{ ticker, auto, manual, total }]. */
export async function postCountsByCoin(periodKey) {
  const since = sinceClause(periodKey);
  const { rows } = await pool.query(
    `SELECT ticker, kind, COUNT(*)::int AS count FROM post_log
     ${since ? `WHERE posted_at >= ${since}` : ''}
     GROUP BY ticker, kind`
  );
  const byTicker = new Map();
  for (const row of rows) {
    const entry = byTicker.get(row.ticker) ?? { ticker: row.ticker, auto: 0, manual: 0 };
    entry[row.kind] = (entry[row.kind] ?? 0) + row.count;
    byTicker.set(row.ticker, entry);
  }
  return [...byTicker.values()]
    .map(e => ({ ...e, total: e.auto + e.manual }))
    .sort((a, b) => b.total - a.total);
}

export async function getState(key) {
  const { rows } = await pool.query('SELECT value FROM bot_state WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setState(key, value) {
  await pool.query(
    `INSERT INTO bot_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}
