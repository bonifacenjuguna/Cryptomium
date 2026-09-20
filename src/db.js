import pg from 'pg';
import { CONFIG, COINS } from './config.js';

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  for (const coin of COINS) {
    await pool.query(
      `INSERT INTO coin_settings (ticker, threshold)
       VALUES ($1, $2)
       ON CONFLICT (ticker) DO NOTHING`,
      [coin.ticker, coin.defaultThreshold]
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
