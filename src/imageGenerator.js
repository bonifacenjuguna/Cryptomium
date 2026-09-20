import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, coinByTicker } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const WIDTH = 1536;
const HEIGHT = 401;
const CARD_MARGIN = 14; // minimal inset gap so the brand color reads as a card, not a full-bleed fill

// Vivid, higher-intensity than any brand color in the palette (including
// TRX's red and USDT/USDC's green) so the direction arrow+price never
// blends into a same-hue background.
const RISE_COLOR = '#00E676';
const FALL_COLOR = '#FF1744';
const WATERMARK_COLOR = 'rgba(255, 255, 255, 0.55)';

let fontsRegistered = false;
function ensureFontsRegistered() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(
    path.join(ASSETS_DIR, 'fonts', 'SourceSerif4-Bold.ttf'),
    'Source Serif Bold'
  );
  GlobalFonts.registerFromPath(
    path.join(ASSETS_DIR, 'fonts', 'SourceSerif4-Regular.ttf'),
    'Source Serif Regular'
  );
  fontsRegistered = true;
}

function formatPrice(price) {
  let decimals;
  if (price >= 100) decimals = 0;
  else if (price >= 1) decimals = 2;
  else decimals = 3;
  const fixed = price.toFixed(decimals);
  return `$${Number(fixed).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

// Relative luminance -> decide whether ticker/logo-adjacent text should be
// near-white or near-black against this coin's brand color background.
function isLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

/**
 * Renders the 1536x401 banner for one milestone post.
 *
 * @param {object} opts
 * @param {string} opts.ticker
 * @param {number} opts.price
 * @param {'up'|'down'} opts.direction
 * @returns {Promise<Buffer>} PNG image buffer
 */
export async function generateBannerImage({ ticker, price, direction }) {
  ensureFontsRegistered();

  const coin = coinByTicker(ticker);
  const brandColor = coin.brandColor;
  const onBrandColor = isLightColor(brandColor) ? '#0b0b0d' : '#f5f5f5';
  const directionColor = direction === 'up' ? RISE_COLOR : FALL_COLOR;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  drawOuterFrame(ctx);
  drawBrandCard(ctx, brandColor);

  // --- Logo ---------------------------------------------------------
  const logoSize = 200;
  let logoDrawn = false;
  try {
    const logo = await loadImage(path.join(ASSETS_DIR, 'logos', `${ticker}.png`));
    const logoX = WIDTH / 2 - 330;
    const logoY = HEIGHT / 2 - logoSize / 2;
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
    logoDrawn = true;
  } catch {
    // Logo missing on disk (fetchAssets.js failed for this coin at deploy
    // time) — fall back gracefully to a text-only layout rather than
    // crashing the whole post.
  }

  // --- Ticker + price cluster ----------------------------------------
  const textBlockX = logoDrawn ? WIDTH / 2 - 60 : WIDTH / 2 - 260;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.font = '48px "Source Serif Regular"';
  ctx.fillStyle = onBrandColor;
  ctx.fillText(ticker, textBlockX, HEIGHT / 2 - 30);

  const arrow = direction === 'up' ? '▲' : '▼';
  const priceText = `${arrow} ${formatPrice(price)}`;
  ctx.font = '96px "Source Serif Bold"';
  drawOutlinedText(ctx, priceText, textBlockX, HEIGHT / 2 + 60, directionColor);

  // --- Watermark, bottom-right ----------------------------------------
  ctx.font = '32px "Source Serif Regular"';
  ctx.fillStyle = WATERMARK_COLOR;
  ctx.textAlign = 'right';
  ctx.fillText(CONFIG.watermark, WIDTH - CARD_MARGIN - 26, HEIGHT - CARD_MARGIN - 22);

  return canvas.encode('png');
}

// Thin neutral frame behind the brand card — this is the "gap" that keeps
// the brand color from bleeding edge-to-edge.
function drawOuterFrame(ctx) {
  ctx.fillStyle = '#0b0b0d';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

// The coin's brand-color card, inset by CARD_MARGIN, with a subtle
// gradient + soft sheen so it reads as high-quality rather than a flat fill.
function drawBrandCard(ctx, brandColor) {
  const x = CARD_MARGIN;
  const y = CARD_MARGIN;
  const w = WIDTH - CARD_MARGIN * 2;
  const h = HEIGHT - CARD_MARGIN * 2;

  const base = ctx.createLinearGradient(x, y, x + w, y + h);
  base.addColorStop(0, lighten(brandColor, -0.12));
  base.addColorStop(1, lighten(brandColor, 0.08));
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);

  // Soft top sheen for depth/HDR-like feel.
  const sheen = ctx.createLinearGradient(x, y, x, y + h * 0.6);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h * 0.6);

  // Faint dark vignette at the edges of the card for contrast/depth.
  const vignette = ctx.createRadialGradient(
    x + w / 2, y + h / 2, h * 0.2,
    x + w / 2, y + h / 2, w * 0.6
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);
}

// Draws text with a soft dark outline behind it, guaranteeing legibility
// even when the direction color's hue is close to the brand background
// (TRX red, USDT/USDC green).
function drawOutlinedText(ctx, text, x, y, fillColor) {
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 8;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}

function lighten(hex, amount) {
  const r = clamp(parseInt(hex.slice(1, 3), 16) + amount * 255);
  const g = clamp(parseInt(hex.slice(3, 5), 16) + amount * 255);
  const b = clamp(parseInt(hex.slice(5, 7), 16) + amount * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
