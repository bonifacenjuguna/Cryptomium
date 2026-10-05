// Coin logo storage + downloading.
//
// Why this exists: v1.0 downloaded each logo with one CoinGecko /coins/{id}
// call per coin, 1.5s apart, at build time. CoinGecko's free tier rate-limits
// (HTTP 429) after roughly half a dozen quick calls, so the coins later in the
// list (DOGE, ADA, LINK, TON (now GRAM), USDT, USDC) silently ended up with no logo.
//
// This version:
//   1. asks CoinGecko for ALL coins' image URLs in ONE request,
//   2. retries with backoff (honoring Retry-After) on 429 / 5xx / timeouts,
//   3. falls back to other public icon CDNs per coin,
//   4. validates + normalizes every download to a 256x256 PNG,
//   5. can run again at boot / on a timer to heal anything still missing.
//
// The banner renderer never blocks on any of this: a missing logo just draws
// a brand-colored monogram badge until the real one arrives.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { COINS, CONFIG, LOGOS_DIR } from './config.js';

export { LOGOS_DIR };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Demo keys only work on api.coingecko.com with x-cg-demo-api-key; Pro keys
// only work on pro-api.coingecko.com with x-cg-pro-api-key (see the matching
// comment in priceService.js). Logo downloads are infrequent enough that
// there's no need to cache which one worked — just try Demo, and if a key is
// set and gets a 401/403, try Pro once.
const COINGECKO_MARKETS_DEMO = 'https://api.coingecko.com/api/v3/coins/markets';
const COINGECKO_MARKETS_PRO = 'https://pro-api.coingecko.com/api/v3/coins/markets';

async function fetchCoinGeckoMarkets(ids, { fetchFn, sleep }) {
  const query = `?vs_currency=usd&ids=${ids}&per_page=250&page=1&sparkline=false`;
  const demoHeaders = CONFIG.coingeckoApiKey ? { 'x-cg-demo-api-key': CONFIG.coingeckoApiKey } : {};
  try {
    return await fetchWithRetry(`${COINGECKO_MARKETS_DEMO}${query}`, { fetchFn, sleep, headers: demoHeaders });
  } catch (err) {
    if (!CONFIG.coingeckoApiKey || ![401, 403].includes(err.status)) throw err;
    const proHeaders = { 'x-cg-pro-api-key': CONFIG.coingeckoApiKey };
    return fetchWithRetry(`${COINGECKO_MARKETS_PRO}${query}`, { fetchFn, sleep, headers: proHeaders });
  }
}

const LOGO_PX = 256;
const MIN_SOURCE_PX = 48;

export function logoPath(ticker) {
  return path.join(LOGOS_DIR, `${ticker}.png`);
}

export async function hasLogo(ticker) {
  try {
    const stat = await fs.stat(logoPath(ticker));
    return stat.size > 500;
  } catch {
    return false;
  }
}

export async function missingLogos() {
  const missing = [];
  for (const coin of COINS) {
    if (!(await hasLogo(coin.ticker))) missing.push(coin.ticker);
  }
  return missing;
}

const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * fetch() with retries. Retries on network errors, timeouts, 429 and 5xx,
 * waiting for the server's Retry-After (capped) or an exponential backoff.
 * 4xx other than 429 (e.g. 404) fail immediately.
 */
export async function fetchWithRetry(url, { fetchFn = fetch, sleep = defaultSleep, tries = 4, timeoutMs = 20_000, headers = {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt++) {
    let waitMs = Math.min(30_000, 2000 * 2 ** attempt);
    try {
      const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      lastError = new Error(`${res.status} from ${new URL(url).host}`);
      if (res.status !== 429 && res.status < 500) throw Object.assign(lastError, { fatal: true, status: res.status });
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) waitMs = Math.min(60_000, retryAfter * 1000);
    } catch (err) {
      if (err.fatal) throw err;
      lastError = err;
    }
    if (attempt < tries - 1) await sleep(waitMs);
  }
  throw lastError ?? new Error(`failed to fetch ${url}`);
}

/** Decode any image format, reject tiny/broken ones, and re-encode as a square 256px PNG. */
export async function normalizeToPng(buffer) {
  const img = await loadImage(buffer);
  if (!img.width || !img.height || Math.min(img.width, img.height) < MIN_SOURCE_PX) {
    throw new Error(`image too small (${img.width}x${img.height})`);
  }
  const canvas = createCanvas(LOGO_PX, LOGO_PX);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const scale = Math.min(LOGO_PX / img.width, LOGO_PX / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (LOGO_PX - w) / 2, (LOGO_PX - h) / 2, w, h);
  return canvas.encode('png');
}

// Public icon CDNs, tried in order after CoinGecko's own image.
function fallbackUrls(coin) {
  const sym = (coin.logoSymbol || coin.ticker).toLowerCase(); // a renamed coin's old ticker (GRAM -> ton)
  return [
    `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${sym}.png`,
    `https://assets.coincap.io/assets/icons/${sym}@2x.png`,
  ];
}

/**
 * Downloads every logo that is missing (or all of them with force: true).
 * Never throws for individual coins. Returns { saved: string[], failed: string[] }.
 */
export async function fetchMissingLogos({ force = false, only = null, fetchFn = fetch, sleep = defaultSleep, log = console } = {}) {
  await fs.mkdir(LOGOS_DIR, { recursive: true });

  const todo = [];
  for (const coin of COINS) {
    if (only && !only.includes(coin.ticker)) continue;
    if (force || !(await hasLogo(coin.ticker))) todo.push(coin);
  }
  if (todo.length === 0) return { saved: [], failed: [] };

  // One batched request for every image URL, instead of one call per coin.
  const geckoImages = new Map();
  try {
    const ids = todo.map(c => c.coingeckoId).join(',');
    const res = await fetchCoinGeckoMarkets(ids, { fetchFn, sleep });
    for (const item of await res.json()) {
      if (item?.id && item?.image) geckoImages.set(item.id, item.image);
    }
  } catch (err) {
    log.warn(`[logos] CoinGecko image list unavailable (${err.message}); using fallback icon sources.`);
  }

  const saved = [];
  const failed = [];
  for (const coin of todo) {
    const candidates = [geckoImages.get(coin.coingeckoId), ...fallbackUrls(coin)].filter(Boolean);
    let ok = false;
    for (const url of candidates) {
      try {
        const res = await fetchWithRetry(url, { fetchFn, sleep, tries: 3 });
        const png = await normalizeToPng(Buffer.from(await res.arrayBuffer()));
        await fs.writeFile(logoPath(coin.ticker), png);
        log.log(`[logos] Saved ${coin.ticker} (from ${new URL(url).host})`);
        ok = true;
        break;
      } catch (err) {
        log.warn(`[logos] ${coin.ticker}: ${new URL(url).host} failed (${err.message})`);
      }
    }
    (ok ? saved : failed).push(coin.ticker);
    await sleep(250);
  }
  return { saved, failed };
}

/**
 * Boot-time healer: fetches any missing logos in the background, retrying
 * every `intervalMs` while some are still missing. `onGaveUpFor(tickers)` is
 * called once per boot with whatever is still missing after the first pass, so
 * the owner can be told (the banners keep working with a monogram badge).
 */
export function startLogoHealer({ intervalMs = 30 * 60_000, onStillMissing } = {}) {
  let reported = false;
  let running = false;

  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const { failed } = await fetchMissingLogos();
      if (failed.length > 0 && !reported) {
        reported = true;
        await onStillMissing?.(failed);
      }
    } catch (err) {
      console.error('[logos] Healer pass failed:', err);
    } finally {
      running = false;
    }
  };

  pass();
  const timer = setInterval(async () => {
    if ((await missingLogos()).length > 0) pass();
  }, intervalMs);
  timer.unref?.();
}

// On-demand fetch for one coin: when the website asks for a logo we do not have yet (a fresh deploy
// on a disk that was wiped, or the boot-time download that failed), get it right then instead of
// waiting for the next healer pass. Concurrent requests share one download, and a coin that just
// failed is not retried for a few minutes so a broken source is not hammered.
const pendingLogos = new Map();
const lastLogoTry = new Map();
export async function ensureLogo(ticker, { cooldownMs = 5 * 60_000, now = () => Date.now(), ...rest } = {}) {
  if (!COINS.some(c => c.ticker === ticker)) return false;
  if (await hasLogo(ticker)) return true;
  if (pendingLogos.has(ticker)) return pendingLogos.get(ticker);
  const last = lastLogoTry.get(ticker);
  if (last !== undefined && now() - last < cooldownMs) return false;
  const job = (async () => {
    try {
      const { saved } = await fetchMissingLogos({ only: [ticker], ...rest });
      return saved.includes(ticker);
    } catch {
      return false;
    } finally {
      lastLogoTry.set(ticker, now());
      pendingLogos.delete(ticker);
    }
  })();
  pendingLogos.set(ticker, job);
  return job;
}
