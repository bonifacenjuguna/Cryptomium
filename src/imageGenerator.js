import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, coinByTicker } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const WIDTH = 1536;
const HEIGHT = 480;

// Vivid, higher-intensity than any brand color in the palette (including
// TRX's red and USDT/USDC's green) so the direction arrow never blends
// into a same-hue background. Only the arrow uses these; all other text
// is white.
const RISE_COLOR = '#00E676';
const RISE_COLOR_LIGHT = '#6BFFB0';
const FALL_COLOR = '#FF1744';
const FALL_COLOR_LIGHT = '#FF6B85';
const TEXT_COLOR = '#FFFFFF';
const WATERMARK_COLOR = 'rgba(255, 255, 255, 0.8)';

// --- Layout ----------------------------------------------------------
// Content is anchored to a fixed left position (rather than re-centered per
// post) so the logo never jumps around between banners, and sits a little
// left of center.
const LOGO_SIZE = 250; // diameter of the coin logo itself (CoinGecko art is 250px, so 1:1 = crisp)
const LOGO_RING = 12; // white margin around the logo; part of the badge
const BADGE_SIZE = LOGO_SIZE + LOGO_RING * 2;
const BADGE_LEFT = 340;
const BADGE_TEXT_GAP = 56;

const TICKER_SIZE = 84;
const TICKER_TRACKING = 8; // letter-spacing, so the ticker reads like a wordmark
const TICKER_EMBOLDEN = 2.5; // same-color stroke: pushes Poppins Bold toward Black weight
const PRICE_SIZE = 96;
const CAP_HEIGHT = 0.7; // Poppins cap/digit height as a fraction of font size
const STACK_GAP = 30; // space between ticker baseline and the top of the price digits

const ARROW_W = 60;
const ARROW_H = 52;
const ARROW_GAP = 24;

// Poppins (geometric sans-serif, SIL OFL) is bundled in assets/fonts so the
// bot never depends on an external font host. Bold is used for the ticker
// and price; Regular for the watermark.
const FONT_BOLD = '"Banner Bold", "Helvetica Neue", Arial, sans-serif';
const FONT_REGULAR = '"Banner Regular", "Helvetica Neue", Arial, sans-serif';

let fontsRegistered = false;
function ensureFontsRegistered() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(ASSETS_DIR, 'fonts', 'Poppins-Bold.ttf'), 'Banner Bold');
  GlobalFonts.registerFromPath(path.join(ASSETS_DIR, 'fonts', 'Poppins-Regular.ttf'), 'Banner Regular');
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

/**
 * Renders the 1536x480 banner for one milestone post.
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

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const cy = HEIGHT / 2;
  const badgeCx = BADGE_LEFT + BADGE_SIZE / 2;

  drawBackground(ctx, buildPalette(coin.brandColor), badgeCx, cy);

  // --- Logo badge ----------------------------------------------------
  let logoDrawn = false;
  try {
    const logo = await loadImage(path.join(ASSETS_DIR, 'logos', `${ticker}.png`));
    drawLogoBadge(ctx, logo, badgeCx, cy);
    logoDrawn = true;
  } catch {
    // Logo missing on disk (fetchAssets.js failed for this coin at deploy
    // time) — fall back gracefully to a text-only layout rather than
    // crashing the whole post.
  }

  // --- Ticker (top) + price (below) ------------------------------------
  const textX = logoDrawn ? BADGE_LEFT + BADGE_SIZE + BADGE_TEXT_GAP : 420;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const tickerCap = TICKER_SIZE * CAP_HEIGHT;
  const priceCap = PRICE_SIZE * CAP_HEIGHT;
  const stackHeight = tickerCap + STACK_GAP + priceCap;
  const tickerBase = cy - stackHeight / 2 + tickerCap;
  const priceBase = tickerBase + STACK_GAP + priceCap;

  ctx.font = `${TICKER_SIZE}px ${FONT_BOLD}`;
  drawSoftText(ctx, ticker, textX, tickerBase, {
    tracking: TICKER_TRACKING,
    embolden: TICKER_EMBOLDEN,
  });

  // Only the arrow is colored (green up / red down); the price is white.
  // The arrow is a vector triangle (not a font glyph) so it renders
  // identically on any server.
  const arrowY = priceBase - priceCap / 2 - ARROW_H / 2;
  drawArrow(ctx, textX, arrowY, ARROW_W, ARROW_H, direction);

  ctx.font = `${PRICE_SIZE}px ${FONT_BOLD}`;
  drawSoftText(ctx, formatPrice(price), textX + ARROW_W + ARROW_GAP, priceBase);

  // --- Watermark, bottom-right ----------------------------------------
  ctx.font = `32px ${FONT_REGULAR}`;
  ctx.fillStyle = WATERMARK_COLOR;
  ctx.textAlign = 'right';
  ctx.fillText(CONFIG.watermark, WIDTH - 26, HEIGHT - 22);

  return canvas.encode('png');
}

// ---------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------

// Builds a multi-tone gradient from the coin's brand color: a deeper,
// hue-shifted shade at the bottom-left, a mid tone (darkened just enough for
// white text to stay readable without any outline), and a bright, warmer
// highlight in the top-right corner. Deliberately NOT the flat brand color,
// so the logo (which is that exact color) pops off the background.
function buildPalette(hex) {
  const [h, s, l] = hexToHsl(hex);
  const sat = Math.min(1, s * 1.05 + 0.03);
  const midL = Math.min(l, maxLightnessForWhiteText(h, s));
  return {
    // Deep, richer shade (hue nudged one way, darker) - bottom-left.
    deep: hsl(h - 18, sat, Math.max(0.1, midL * 0.62)),
    // Main tone: the brand hue, only darkened if white text would struggle.
    mid: hsl(h - 4, sat, midL),
    // Lighter tone through the text area.
    midLight: hsl(h + 2, sat, Math.min(midL + 0.06, maxLightnessForWhiteText(h + 2, s) + 0.04)),
    // Bright, slightly shifted highlight in the far top-right corner.
    corner: hsl(h + 10, sat, Math.min(0.68, midL + 0.2)),
    // Saturated (not pastel) halo behind the logo badge.
    glow: (a) => hsl(h - 2, Math.min(1, sat + 0.1), Math.min(0.7, midL + 0.16), a),
  };
}

function drawBackground(ctx, p, glowX, glowY) {
  const w = WIDTH;
  const h = HEIGHT;

  // Diagonal multi-stop base gradient (bottom-left -> top-right).
  const base = ctx.createLinearGradient(0, h, w, 0);
  base.addColorStop(0, p.deep);
  base.addColorStop(0.45, p.mid);
  base.addColorStop(0.8, p.midLight);
  base.addColorStop(1, p.corner);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // Soft spotlight behind the logo badge.
  const glow = ctx.createRadialGradient(glowX, glowY, 20, glowX, glowY, 440);
  glow.addColorStop(0, p.glow(0.5));
  glow.addColorStop(1, p.glow(0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Broad diagonal light sweep.
  const sweep = ctx.createLinearGradient(w * 0.25, 0, w * 0.75, h);
  sweep.addColorStop(0.35, 'rgba(255,255,255,0)');
  sweep.addColorStop(0.5, 'rgba(255,255,255,0.07)');
  sweep.addColorStop(0.65, 'rgba(255,255,255,0)');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, w, h);

  // Edge vignette for depth.
  const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // Whisper of grain dithers the gradient so it stays smooth (no visible
  // banding) after Telegram re-compresses the photo.
  addGrain(ctx, 2);
}

function addGrain(ctx, amount) {
  const img = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount * 2;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------
// Logo badge: white margin + coin logo, with a very light 3D treatment
// ---------------------------------------------------------------------

function drawLogoBadge(ctx, logo, cx, cy) {
  const rLogo = LOGO_SIZE / 2;
  const rBadge = rLogo + LOGO_RING;

  // White disc (the margin) with a soft drop shadow beneath it.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.40)';
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 14;
  const disc = ctx.createLinearGradient(cx - rBadge, cy - rBadge, cx + rBadge, cy + rBadge);
  disc.addColorStop(0, '#FFFFFF');
  disc.addColorStop(1, '#DCDFE5');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, rBadge, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The logo itself, clipped to a circle, with gentle shading so it reads as
  // slightly domed: highlight top-left, soft shade toward the bottom.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rLogo, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(logo, cx - rLogo, cy - rLogo, LOGO_SIZE, LOGO_SIZE);

  const shade = ctx.createLinearGradient(0, cy - rLogo, 0, cy + rLogo);
  shade.addColorStop(0.45, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.20)');
  ctx.fillStyle = shade;
  ctx.fillRect(cx - rLogo, cy - rLogo, LOGO_SIZE, LOGO_SIZE);

  const hx = cx - rLogo * 0.35;
  const hy = cy - rLogo * 0.45;
  const highlight = ctx.createRadialGradient(hx, hy, 0, hx, hy, rLogo);
  highlight.addColorStop(0, 'rgba(255,255,255,0.30)');
  highlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(cx - rLogo, cy - rLogo, LOGO_SIZE, LOGO_SIZE);
  ctx.restore();

  // Hairline where the logo meets the white margin, for a crisp inset edge.
  ctx.beginPath();
  ctx.arc(cx, cy, rLogo, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---------------------------------------------------------------------
// Text + arrow
// ---------------------------------------------------------------------

// Draws white text with a soft drop shadow (no outline): a wide, diffuse
// shadow for lift plus a tight one for crisp edges. Optional letter-spacing
// (tracking) and same-color emboldening for a wordmark look.
function drawSoftText(ctx, text, x, y, opts = {}) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  paintText(ctx, text, x, y, opts);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.26)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  paintText(ctx, text, x, y, opts);
  ctx.restore();
}

function paintText(ctx, text, x, y, { tracking = 0, embolden = 0 } = {}) {
  ctx.fillStyle = TEXT_COLOR;
  ctx.strokeStyle = TEXT_COLOR;
  ctx.lineWidth = embolden;
  ctx.lineJoin = 'round';

  if (!tracking) {
    if (embolden) ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of text) {
    if (embolden) ctx.strokeText(ch, cx, y);
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

// Gradient-filled triangle with a thin white edge and soft shadow. The white
// edge keeps it legible even on a same-hue brand color (TRX red, USDT green).
function drawArrow(ctx, x, y, w, h, direction) {
  const up = direction === 'up';
  const color = up ? RISE_COLOR : FALL_COLOR;
  const colorLight = up ? RISE_COLOR_LIGHT : FALL_COLOR_LIGHT;

  const tri = () => {
    ctx.beginPath();
    if (up) {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w / 2, y);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w / 2, y + h);
    }
    ctx.closePath();
  };

  ctx.save();
  ctx.lineJoin = 'round';

  // White edge (only the outer half of the stroke shows once filled) + shadow.
  tri();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 8;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.restore();

  // Fill: lighter at the tip side, saturated at the base.
  ctx.save();
  tri();
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, up ? colorLight : color);
  fill.addColorStop(1, up ? color : colorLight);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hsl(h, s, l, a = 1) {
  const hh = ((h % 360) + 360) % 360;
  return `hsla(${hh.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;
}

function luminance([r, g, b]) {
  const lin = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Largest HSL lightness at which white text still has ~2.8:1+ contrast
// against this hue/saturation. That's deliberately modest: the text is very
// large and heavy and carries a soft shadow, and going darker turns warm
// brand colors (orange, yellow) muddy brown.
function maxLightnessForWhiteText(h, s) {
  const MAX_LUMINANCE = 0.33;
  let l = 0.7;
  while (l > 0.08 && luminance(hslToRgb(h, s, l)) > MAX_LUMINANCE) l -= 0.01;
  return l;
}
