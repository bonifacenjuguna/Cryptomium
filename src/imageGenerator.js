import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, coinByTicker } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Width stays exactly as specified; height was bumped up a bit so the
// card's inset border reads as a subtle frame rather than a heavy dark
// bezel at this width.
const WIDTH = 1536;
const HEIGHT = 460;
const CARD_MARGIN = 8; // minimal inset gap so the brand color reads as a card, not a full-bleed fill

// Only the arrow character itself carries the direction color. Everything
// else (ticker, price digits) is always white/bold, on every coin.
const RISE_COLOR = '#00E676';
const FALL_COLOR = '#FF1744';
const TEXT_COLOR = '#ffffff';
const WATERMARK_COLOR = 'rgba(255, 255, 255, 0.55)';

let fontsRegistered = false;
let fontsAvailable = false;
function ensureFontsRegistered() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  try {
    GlobalFonts.registerFromPath(
      path.join(ASSETS_DIR, 'fonts', 'SpaceGrotesk-Bold.ttf'),
      'Space Grotesk Bold'
    );
    GlobalFonts.registerFromPath(
      path.join(ASSETS_DIR, 'fonts', 'SpaceGrotesk-Regular.ttf'),
      'Space Grotesk Regular'
    );
    fontsAvailable = true;
  } catch (err) {
    // If the font files failed to download at deploy time, fall back to
    // a generic system sans-serif rather than letting every single post
    // fail silently — same failure class we already hit once with the
    // launch bug, worth guarding against here too.
    console.warn('[imageGenerator] Custom fonts unavailable, falling back to default sans-serif:', err.message);
  }
}

function boldFont() {
  return fontsAvailable ? 'Space Grotesk Bold' : 'sans-serif';
}

function regularFont() {
  return fontsAvailable ? 'Space Grotesk Regular' : 'sans-serif';
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

/**
 * Renders the banner for one milestone post.
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
  const directionColor = direction === 'up' ? RISE_COLOR : FALL_COLOR;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  drawOuterFrame(ctx);
  drawBrandCard(ctx, coin.brandColor);

  // --- Logo, with a thin white margin/ring around it -------------------
  const logoSize = 220;
  const logoX = WIDTH / 2 - 340;
  const logoY = HEIGHT / 2 - logoSize / 2;
  let logoDrawn = false;
  try {
    const logo = await loadImage(path.join(ASSETS_DIR, 'logos', `${ticker}.png`));
    drawWhiteRing(ctx, logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2);
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

  // Ticker rendered bold and white, like a wordmark rather than a muted label.
  ctx.font = `52px "${boldFont()}"`;
  drawOutlinedText(ctx, ticker, textBlockX, HEIGHT / 2 - 30, TEXT_COLOR, 4);

  // Arrow and price are drawn as two separate fills: the arrow carries
  // the direction color, the price number is always white.
  const arrow = direction === 'up' ? '▲ ' : '▼ ';
  const priceStr = formatPrice(price);
  ctx.font = `104px "${boldFont()}"`;

  drawOutlinedText(ctx, arrow, textBlockX, HEIGHT / 2 + 68, directionColor, 8);
  const arrowWidth = ctx.measureText(arrow).width;
  drawOutlinedText(ctx, priceStr, textBlockX + arrowWidth, HEIGHT / 2 + 68, TEXT_COLOR, 8);

  // --- Watermark, bottom-right ----------------------------------------
  ctx.font = `32px "${regularFont()}"`;
  ctx.fillStyle = WATERMARK_COLOR;
  ctx.textAlign = 'right';
  ctx.fillText(CONFIG.watermark, WIDTH - CARD_MARGIN - 26, HEIGHT - CARD_MARGIN - 22);

  return canvas.encode('png');
}

// Thin neutral frame behind the brand card — this is the minimal "gap"
// that keeps the brand color from bleeding edge-to-edge.
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

// A very thin white ring around the coin logo — keeps the icon readable
// even when its own art shares the card's brand color (e.g. BTC's orange
// glyph on an orange card).
function drawWhiteRing(ctx, cx, cy, radius) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fill();
  ctx.restore();
}

// Draws text with a soft dark outline behind it, so it stays legible
// against any brand color — including light ones like BNB's yellow or
// DOGE's gold.
function drawOutlinedText(ctx, text, x, y, fillColor, lineWidth) {
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = lineWidth;
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
