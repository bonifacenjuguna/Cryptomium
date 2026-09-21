import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, coinByTicker } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Banner size: matches the reference card (1600x418).
const WIDTH = 1600;
const HEIGHT = 418;
// All layout sizes below were designed at 480px tall; S scales them.
const S = HEIGHT / 480;

// Direction chip colors (top -> bottom gradient). The arrow inside the chip is
// always white; only the chip's fill changes: green for a rise, red for a fall.
// Deep enough that a white arrow stays clearly readable on them.
const RISE_CHIP = ['#1FCB80', '#0BA35F'];
const FALL_CHIP = ['#FF4D6A', '#E0193F'];
const WATERMARK_COLOR = 'rgba(255, 255, 255, 0.8)';

// --- Layout ----------------------------------------------------------
// One content block, anchored to a fixed left edge (rather than re-centered per
// post) so nothing jumps around between banners. It sits slightly left of
// center and well inside the middle of the image, since Telegram crops very
// wide photos from the sides.
//
//   [logo]  BTC                          [ chip ]
//   $81,290
//
const BLOCK_LEFT = Math.round(WIDTH / 2 - 330); // fixed left edge, a touch left of center

const LOGO_SIZE = Math.round(250 * S); // logo diameter (CoinGecko art is 250px; a bit of downscale stays crisp)
const LOGO_RING = Math.round(12 * S); // white margin around the logo; part of the badge
const BADGE_SIZE = LOGO_SIZE + LOGO_RING * 2;
const BADGE_TICKER_GAP = Math.round(40 * S);

const TICKER_SIZE = Math.round(84 * S);
const TICKER_TRACKING = Math.round(9 * S); // letter-spacing, so the ticker reads like a wordmark
const TICKER_EMBOLDEN = 2.5 * S; // same-color stroke: pushes Poppins Bold toward Black weight
const PRICE_SIZE = Math.round(112 * S);
const CAP_HEIGHT = 0.7; // Poppins cap/digit height as a fraction of font size
const ROW_GAP = Math.round(34 * S); // space between the logo row and the top of the price digits

const CHIP_W = Math.round(118 * S);
const CHIP_H = Math.round(76 * S);
const CHIP_GAP = Math.round(40 * S); // minimum space between the ticker and the chip
const CHIP_ARROW_W = Math.round(38 * S);
const CHIP_ARROW_H = Math.round(32 * S);

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
 * Renders the 1600x418 banner for one milestone post.
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
  const pal = buildPalette(coin.brandColor, direction);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Vertical layout: the logo row (badge + ticker + chip) on top, the price
  // below, the whole group centered in the banner.
  const priceCap = PRICE_SIZE * CAP_HEIGHT;
  const groupHeight = BADGE_SIZE + ROW_GAP + priceCap;
  const groupTop = (HEIGHT - groupHeight) / 2 - 6; // nudged up: the price's comma/descenders hang below its baseline
  const rowCy = groupTop + BADGE_SIZE / 2;
  const priceBase = groupTop + BADGE_SIZE + ROW_GAP + priceCap;
  const badgeCx = BLOCK_LEFT + BADGE_SIZE / 2;

  drawBackground(ctx, pal, badgeCx, rowCy);

  // --- Logo badge ----------------------------------------------------
  let logoDrawn = false;
  try {
    const logo = await loadImage(path.join(ASSETS_DIR, 'logos', `${ticker}.png`));
    drawLogoBadge(ctx, logo, badgeCx, rowCy, pal);
    logoDrawn = true;
  } catch {
    // Logo missing on disk (fetchAssets.js failed for this coin at deploy
    // time) — fall back gracefully to a layout without it rather than
    // crashing the whole post.
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // --- Measure, so the chip can sit flush with the block's right edge -------
  const priceText = formatPrice(price);
  ctx.font = `${TICKER_SIZE}px ${FONT_BOLD}`;
  const tickerWidth = measureTracked(ctx, ticker, TICKER_TRACKING);
  ctx.font = `${PRICE_SIZE}px ${FONT_BOLD}`;
  const priceWidth = ctx.measureText(priceText).width;

  const tickerCap = TICKER_SIZE * CAP_HEIGHT;
  const tickerX = logoDrawn ? BLOCK_LEFT + BADGE_SIZE + BADGE_TICKER_GAP : BLOCK_LEFT;
  const rowMinRight = tickerX + tickerWidth + CHIP_GAP + CHIP_W;
  const blockRight = Math.max(BLOCK_LEFT + priceWidth, rowMinRight);

  // --- Ticker, beside the logo, vertically centered on it ---------------
  ctx.font = `${TICKER_SIZE}px ${FONT_BOLD}`;
  drawSoftText(ctx, ticker, tickerX, rowCy + tickerCap / 2, pal, {
    fill: pearlGradient(ctx, rowCy - tickerCap / 2, rowCy + tickerCap / 2, pal),
    tracking: TICKER_TRACKING,
    embolden: TICKER_EMBOLDEN,
  });

  // --- Direction chip, right end of the logo row --------------------------
  drawDirectionChip(ctx, blockRight - CHIP_W, rowCy - CHIP_H / 2, CHIP_W, CHIP_H, direction, pal);

  // --- Price, big, left-aligned under the logo -------------------------------
  ctx.font = `${PRICE_SIZE}px ${FONT_BOLD}`;
  drawSoftText(ctx, priceText, BLOCK_LEFT, priceBase, pal, {
    fill: pearlGradient(ctx, priceBase - priceCap, priceBase, pal),
  });

  // --- Watermark, bottom-right ----------------------------------------
  ctx.font = `${Math.round(32 * S)}px ${FONT_REGULAR}`;
  ctx.fillStyle = WATERMARK_COLOR;
  ctx.textAlign = 'right';
  ctx.fillText(CONFIG.watermark, WIDTH - 26 * S, HEIGHT - 22 * S);

  return canvas.encode('png');
}

// ---------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------

// Everything is derived from the coin's brand color: a hue-shifted base
// gradient, luminous glow colors, a tinted shadow color (never pure black,
// which looks dirty), and a "pearl" tint used for the white text.
function buildPalette(hex, direction) {
  const [brandH, s, l] = hexToHsl(hex);
  // Darkening yellows turns them olive/khaki; nudging toward amber keeps
  // them reading as rich gold.
  const h = brandH >= 35 && brandH <= 75 ? brandH - 10 : brandH;
  const sat = Math.min(1, s * 1.05 + 0.04);
  const glowSat = Math.min(1, sat * 1.25);

  // Darken only as much as white text needs; going further turns warm brand
  // colors (orange, yellow) into mud.
  let maxLum = 0.33;
  // If the brand color is close in hue to the direction chip (TRX red vs
  // the fall chip, USDT green vs the rise chip), the chip would vanish
  // into the background - so keep that background darker than the chip.
  const chip = direction === 'up' ? RISE_CHIP : FALL_CHIP;
  const chipHue = hexToHsl(chip[1])[0];
  const chipLum = luminance(hexToRgb(chip[1]));
  if (hueDistance(brandH, chipHue) < 40) {
    maxLum = Math.min(maxLum, (chipLum + 0.05) / 1.5 - 0.05);
  }
  const midL = Math.min(l, maxLightness(h, s, maxLum));

  return {
    // Base gradient, top-left -> bottom-right.
    c1: hsl(h - 18, sat, midL * 0.9),
    c2: hsl(h - 6, sat, midL),
    c3: hsl(h + 10, sat, Math.min(0.56, midL + 0.03)),
    // Luminous light sources (blended with "screen", so they glow).
    orbA: a => hsl(h - 2, glowSat, Math.min(0.62, midL + 0.22), a),
    orbB: a => hsl(h + 14, glowSat, Math.min(0.6, midL + 0.2), a),
    orbC: a => hsl(h - 26, glowSat, Math.min(0.55, midL + 0.12), a),
    // Brand-tinted shadow instead of black.
    shadow: a => hsl(h - 6, Math.min(1, sat + 0.1), 0.09, a),
    // Barely-tinted whites for the text gradient and the logo margin.
    pearl: hsl(h, Math.min(0.35, sat), 0.95),
    pearlEdge: hsl(h, Math.min(0.25, sat), 0.92),
  };
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ---------------------------------------------------------------------
// Background: web-style glowing gradient with a glass reflection
// ---------------------------------------------------------------------

function drawBackground(ctx, pal, badgeCx, cy) {
  const w = WIDTH;
  const h = HEIGHT;

  // Base: smooth diagonal gradient.
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, pal.c1);
  base.addColorStop(0.5, pal.c2);
  base.addColorStop(1, pal.c3);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // Glowing light sources. "screen" blending adds light rather than laying
  // a pale patch on top, which is what makes it look like a glow instead of
  // a smudge. They're kept away from the text area.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  glowOrb(ctx, badgeCx - 40 * S, cy + 40 * S, 400 * S, pal.orbA(0.5));
  glowOrb(ctx, w - 120 * S, -20 * S, 460 * S, pal.orbB(0.45));
  glowOrb(ctx, w * 0.55, h + 80 * S, 380 * S, pal.orbC(0.3));
  ctx.restore();

  // Glass reflection: a broad, soft diagonal sheen of light - the way light
  // catches a pane of glass. No hard edges (a crisp line reads as a scratch).
  const sheen = ctx.createLinearGradient(0, 0, w * 0.55, h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
  sheen.addColorStop(0.55, 'rgba(255,255,255,0.07)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w * 0.66, 0);
  ctx.lineTo(w * 0.36, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // Whisper of grain dithers the gradients so they stay smooth (no visible
  // banding) after Telegram re-compresses the photo.
  addGrain(ctx, 1);
}

function glowOrb(ctx, x, y, radius, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
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
// Logo badge: pearl-white margin + coin logo
// ---------------------------------------------------------------------

function drawLogoBadge(ctx, logo, cx, cy, pal) {
  const rLogo = LOGO_SIZE / 2;
  const rBadge = rLogo + LOGO_RING;

  // Pearl-white disc (the margin): white at the top-left easing to a
  // faintly tinted white at the bottom-right, with a soft brand-tinted
  // drop shadow and a whisper of light glow around it.
  ctx.save();
  ctx.shadowColor = pal.shadow(0.42);
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 14;
  const disc = ctx.createLinearGradient(cx - rBadge, cy - rBadge, cx + rBadge, cy + rBadge);
  disc.addColorStop(0, '#FFFFFF');
  disc.addColorStop(1, pal.pearlEdge);
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, rBadge, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The logo, clipped to a circle, with only a faint top-left highlight for
  // a hint of dome. Nothing darkens the logo, so white marks stay clean.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rLogo, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(logo, cx - rLogo, cy - rLogo, LOGO_SIZE, LOGO_SIZE);

  const hx = cx - rLogo * 0.4;
  const hy = cy - rLogo * 0.5;
  const highlight = ctx.createRadialGradient(hx, hy, 0, hx, hy, rLogo * 0.95);
  highlight.addColorStop(0, 'rgba(255,255,255,0.18)');
  highlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(cx - rLogo, cy - rLogo, LOGO_SIZE, LOGO_SIZE);
  ctx.restore();
}

// ---------------------------------------------------------------------
// Text + arrow
// ---------------------------------------------------------------------

// Vertical white -> pearl gradient so the text has a subtle, premium sheen
// instead of a flat #FFF.
function pearlGradient(ctx, top, bottom, pal) {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(1, pal.pearl);
  return g;
}

// Draws text with a soft brand-tinted drop shadow (no outline): a wide,
// diffuse shadow for lift plus a tight one for crisp edges. Optional
// letter-spacing (tracking) and same-color emboldening for a wordmark look.
function drawSoftText(ctx, text, x, y, pal, opts = {}) {
  ctx.save();
  ctx.shadowColor = pal.shadow(0.22);
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  paintText(ctx, text, x, y, opts);
  ctx.shadowColor = pal.shadow(0.28);
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 2;
  paintText(ctx, text, x, y, opts);
  ctx.restore();
}

// Width of text drawn by paintText with letter-spacing (no trailing gap).
function measureTracked(ctx, text, tracking) {
  let width = 0;
  const chars = [...text];
  chars.forEach((ch, i) => {
    width += ctx.measureText(ch).width;
    if (i < chars.length - 1) width += tracking;
  });
  return width;
}

function paintText(ctx, text, x, y, { fill = '#FFFFFF', tracking = 0, embolden = 0 } = {}) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
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

// Pill-shaped direction chip: green (rise) or red (fall) fill with a soft glass
// highlight, and a white arrow inside that never changes color.
function drawDirectionChip(ctx, x, y, w, h, direction, pal) {
  const up = direction === 'up';
  const [top, bottom] = up ? RISE_CHIP : FALL_CHIP;
  const r = h / 2;

  const pill = () => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
  };

  // Fill + soft shadow.
  ctx.save();
  pill();
  ctx.shadowColor = pal.shadow(0.35);
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, top);
  fill.addColorStop(1, bottom);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  // Glass highlight across the top half.
  ctx.save();
  pill();
  ctx.clip();
  const gloss = ctx.createLinearGradient(0, y, 0, y + h * 0.6);
  gloss.addColorStop(0, 'rgba(255,255,255,0.28)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(x, y, w, h * 0.6);
  ctx.restore();

  // White arrow (vector triangle with softly rounded corners), centered.
  const aw = CHIP_ARROW_W;
  const ah = CHIP_ARROW_H;
  const ax = x + (w - aw) / 2;
  const ay = y + (h - ah) / 2;
  const cr = Math.max(2, Math.round(3 * S));
  ctx.save();
  ctx.beginPath();
  if (up) {
    ctx.moveTo(ax + cr, ay + ah - cr);
    ctx.lineTo(ax + aw - cr, ay + ah - cr);
    ctx.lineTo(ax + aw / 2, ay + cr);
  } else {
    ctx.moveTo(ax + cr, ay + cr);
    ctx.lineTo(ax + aw - cr, ay + cr);
    ctx.lineTo(ax + aw / 2, ay + ah - cr);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = cr * 2;
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.stroke();
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

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
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

// Largest HSL lightness whose relative luminance stays under maxLum. The
// default (0.33) keeps white text at ~2.8:1+ contrast, which is plenty for
// text this large and heavy with a soft shadow.
function maxLightness(h, s, maxLum) {
  let l = 0.7;
  while (l > 0.08 && luminance(hslToRgb(h, s, l)) > maxLum) l -= 0.01;
  return l;
}
