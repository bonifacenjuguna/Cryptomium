// Coin logo storage + downloading.
//
// Why this exists: v1.0 downloaded each logo with one CoinGecko /coins/{id}
// call per coin, 1.5s apart, at build time. CoinGecko's free tier rate-limits
// (HTTP 429) after roughly half a dozen quick calls, so the coins later in the
// list (DOGE, ADA, LINK, TON, USDT, USDC) silently ended up with no logo.
//
// This version:
//   1. asks CoinGecko for ALL coins' image URLs in ONE request,
//   2. retries with backoff (honoring Retry-After) on 429 / 5xx / timeouts,
//   3. falls back to CoinMarketCap's own logos (if a key is configured), then
//      other public icon CDNs, then a DexScreener token-profile image search,
//   4. validates + normalizes every download to a 256x256 PNG,
//   5. can run again at boot / on a timer to heal anything still missing.
//
// The banner renderer never blocks on any of this: a missing logo just draws
// a brand-colored monogram badge until the real one arrives.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { COINS, CONFIG, coingeckoHeaders, coingeckoBaseUrl } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOGOS_DIR = process.env.LOGOS_DIR || path.join(__dirname, '..', 'assets', 'logos');

const COINMARKETCAP_INFO_URL = 'https://pro-api.coinmarketcap.com/v2/cryptocurrency/info';
const DEXSCREENER_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search';
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
      if (res.status !== 429 && res.status < 500) throw Object.assign(lastError, { fatal: true });
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
  const sym = coin.ticker.toLowerCase();
  return [
    `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${sym}.png`,
    `https://assets.coincap.io/assets/icons/${sym}@2x.png`,
  ];
}

/**
 * Downloads every logo that is missing (or all of them with force: true).
 * Never throws for individual coins. Returns { saved: string[], failed: string[] }.
 */
export async function fetchMissingLogos({ force = false, fetchFn = fetch, sleep = defaultSleep, log = console } = {}) {
  await fs.mkdir(LOGOS_DIR, { recursive: true });

  const todo = [];
  for (const coin of COINS) {
    if (force || !(await hasLogo(coin.ticker))) todo.push(coin);
  }
  if (todo.length === 0) return { saved: [], failed: [] };

  // One batched request for every image URL, instead of one call per coin.
  const geckoImages = new Map();
  try {
    const ids = todo.map(c => c.coingeckoId).join(',');
    const url = `${coingeckoBaseUrl()}/coins/markets?vs_currency=usd&ids=${ids}&per_page=250&page=1&sparkline=false`;
    const res = await fetchWithRetry(url, { fetchFn, sleep, headers: coingeckoHeaders() });
    for (const item of await res.json()) {
      if (item?.id && item?.image) geckoImages.set(item.id, item.image);
    }
  } catch (err) {
    log.warn(`[logos] CoinGecko image list unavailable (${err.message}); using fallback icon sources.`);
  }

  // CoinMarketCap's own official logos, one batched request — only when a key
  // is configured (CMC has no keyless tier). Fetched dynamically by symbol
  // rather than a hard-coded numeric CMC id per coin, so it can't go stale.
  const cmcImages = CONFIG.coinmarketcapApiKey
    ? await fetchCoinMarketCapLogos(todo.map(c => c.ticker), { fetchFn, log }).catch(() => new Map())
    : new Map();

  const saved = [];
  const failed = [];
  for (const coin of todo) {
    const candidates = [geckoImages.get(coin.coingeckoId), cmcImages.get(coin.ticker), ...fallbackUrls(coin)].filter(Boolean);
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
    // Absolute last resort: search DexScreener for a token profile image.
    // Same trust bar in spirit as its price role (priceService.js) — an
    // exact symbol match is required — logos have no liquidity figure to
    // check, so a wrong match here is just a wrong picture, not a bad alert.
    if (!ok) {
      const dexUrl = await fetchDexScreenerLogo(coin, { fetchFn }).catch(() => null);
      if (dexUrl) {
        try {
          const res = await fetchWithRetry(dexUrl, { fetchFn, sleep, tries: 2 });
          const png = await normalizeToPng(Buffer.from(await res.arrayBuffer()));
          await fs.writeFile(logoPath(coin.ticker), png);
          log.log(`[logos] Saved ${coin.ticker} (from DexScreener token profile)`);
          ok = true;
        } catch (err) {
          log.warn(`[logos] ${coin.ticker}: DexScreener image failed (${err.message})`);
        }
      }
    }
    (ok ? saved : failed).push(coin.ticker);
    await sleep(250);
  }
  return { saved, failed };
}

/** CoinMarketCap's /v2/cryptocurrency/info returns each symbol's own official logo URL directly. */
async function fetchCoinMarketCapLogos(tickers, { fetchFn = fetch, log = console } = {}) {
  const images = new Map();
  try {
    const url = `${COINMARKETCAP_INFO_URL}?symbol=${tickers.join(',')}`;
    const res = await fetchFn(url, { headers: { 'X-CMC_PRO_API_KEY': CONFIG.coinmarketcapApiKey, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`CoinMarketCap responded ${res.status}`);
    const body = await res.json();
    for (const ticker of tickers) {
      const raw = body?.data?.[ticker];
      const entry = Array.isArray(raw) ? raw[0] : raw;
      if (entry?.logo) images.set(ticker, entry.logo);
    }
  } catch (err) {
    log.warn(`[logos] CoinMarketCap logo lookup unavailable (${err.message}).`);
  }
  return images;
}

/**
 * Best-effort DexScreener token-profile image for one coin. Requires an
 * exact base-token symbol match; picks the highest-liquidity pair among
 * matches so an obscure impostor token can't win. Returns null (never
 * throws) when nothing confident is found.
 */
async function fetchDexScreenerLogo(coin, { fetchFn = fetch } = {}) {
  const res = await fetchFn(`${DEXSCREENER_SEARCH_URL}?q=${encodeURIComponent(coin.name)}`, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  const body = await res.json();
  const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
  const candidates = pairs.filter(p => p?.baseToken?.symbol?.toUpperCase() === coin.ticker && p?.info?.imageUrl);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
  return candidates[0].info.imageUrl;
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
