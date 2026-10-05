// Renders a price history chart (line or candlestick), styled in the dark,
// gridded look most trading charts use. Not a pixel-for-pixel TradingView
// clone (that's a whole charting engine), but the same visual language: dark
// background, muted gridlines, a labeled price axis and time axis, a colored
// period-change readout, and green/red candles or a gradient-filled line.
import { createCanvas } from '@napi-rs/canvas';
import { CONFIG, coinByTicker } from './config.js';
import { formatPrice } from './priceFormat.js';
import { FONT_BOLD, FONT_REGULAR, ensureFontsRegistered } from './fonts.js';

const WIDTH = 1600;
const HEIGHT = 900;

// Colors modeled on TradingView's dark theme, since that's the reference look.
const BG = '#131722';
const GRID = '#242833';
const AXIS_TEXT = '#9598a1';
const TITLE_TEXT = '#d1d4dc';
const UP = '#26a69a';
const UP_LIGHT = 'rgba(38, 166, 154, 0.28)';
const DOWN = '#ef5350';
const DOWN_LIGHT = 'rgba(239, 83, 80, 0.28)';

const PLOT = { left: 40, right: 150, top: 130, bottom: 70 };

/**
 * @param {object} opts
 * @param {string} opts.ticker
 * @param {'line'|'candles'} opts.style
 * @param {number} opts.days
 * @param {string} opts.rangeLabel  e.g. "7D", "Custom (45d)"
 * @param {Array} opts.points  from chartData.js: {t, price} for line, {t,o,h,l,c} for candles
 * @returns {Promise<Buffer>}
 */
export async function generateChartImage({ ticker, style, days, rangeLabel, points }) {
  ensureFontsRegistered();
  const coin = coinByTicker(ticker);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const plotW = WIDTH - PLOT.left - PLOT.right;
  const plotH = HEIGHT - PLOT.top - PLOT.bottom;
  const plotX = PLOT.left;
  const plotY = PLOT.top;

  const lows = style === 'candles' ? points.map(p => p.l) : points.map(p => p.price);
  const highs = style === 'candles' ? points.map(p => p.h) : points.map(p => p.price);
  const dataMin = Math.min(...lows);
  const dataMax = Math.max(...highs);
  const pad = (dataMax - dataMin) * 0.08 || dataMax * 0.01 || 1; // headroom; guards against a flat series
  const min = dataMin - pad;
  const max = dataMax + pad;

  const first = style === 'candles' ? points[0].o : points[0].price;
  const last = style === 'candles' ? points.at(-1).c : points.at(-1).price;
  const changePct = ((last - first) / first) * 100;
  const isUp = changePct >= 0;
  const lineColor = isUp ? UP : DOWN;
  const fillColor = isUp ? UP_LIGHT : DOWN_LIGHT;

  const xAt = i => plotX + (i / Math.max(1, points.length - 1)) * plotW;
  const yAt = price => plotY + (1 - (price - min) / (max - min)) * plotH;

  drawGridAndAxes(ctx, { plotX, plotY, plotW, plotH, min, max, points, days });
  drawTitle(ctx, { coin, last, changePct, isUp, rangeLabel, style });

  if (style === 'candles') {
    drawCandles(ctx, points, xAt, yAt, plotW);
  } else {
    drawLine(ctx, points, xAt, yAt, plotY, plotH, lineColor, fillColor);
  }

  drawWatermark(ctx);
  return canvas.encode('png');
}

// ---------------------------------------------------------------------
// Axes + grid
// ---------------------------------------------------------------------

const PRICE_ROWS = 5; // horizontal price rows on every chart image

function drawGridAndAxes(ctx, { plotX, plotY, plotW, plotH, min, max, points, days }) {
  // Always the same number of price rows, evenly spaced, so the grid never changes shape from one chart to the next.
  ctx.textBaseline = 'middle';
  ctx.font = `22px ${FONT_REGULAR}`;
  for (let k = 1; k <= PRICE_ROWS; k++) {
    const price = min + ((max - min) * k) / (PRICE_ROWS + 1);
    const y = plotY + (1 - (price - min) / (max - min)) * plotH;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotW, y);
    ctx.stroke();

    ctx.fillStyle = AXIS_TEXT;
    ctx.textAlign = 'left';
    ctx.fillText(formatPrice(price), plotX + plotW + 16, y);
  }

  // Time axis: ~6 evenly spaced labels along the bottom. The first and last
  // are edge-aligned (not centered) so they don't clip off the canvas.
  const tickCount = 6;
  ctx.textBaseline = 'top';
  for (let i = 0; i <= tickCount; i++) {
    const idx = Math.round((i / tickCount) * (points.length - 1));
    const x = plotX + (idx / Math.max(1, points.length - 1)) * plotW;
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(x, plotY);
    ctx.lineTo(x, plotY + plotH);
    ctx.stroke();
    ctx.fillStyle = AXIS_TEXT;
    ctx.textAlign = i === 0 ? 'left' : i === tickCount ? 'right' : 'center';
    ctx.fillText(formatAxisTime(points[idx].t, days), x, plotY + plotH + 14);
  }

  // Plot border.
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(plotX, plotY, plotW, plotH);
}

function formatAxisTime(ms, days) {
  const d = new Date(ms);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  if (days <= 2) return `${hh}:${mm}`;
  if (days <= 90) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------
// Title / legend
// ---------------------------------------------------------------------

function drawTitle(ctx, { coin, last, changePct, isUp, rangeLabel, style }) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `44px ${FONT_BOLD}`;
  ctx.fillStyle = TITLE_TEXT;
  ctx.fillText(`${coin.name} (${coin.ticker})`, 40, 62);

  ctx.font = `30px ${FONT_REGULAR}`;
  ctx.fillStyle = AXIS_TEXT;
  const styleLabel = style === 'candles' ? 'Candles' : 'Line';
  ctx.fillText(`${rangeLabel} · ${styleLabel} · USD`, 40, 96);

  ctx.textAlign = 'right';
  ctx.font = `48px ${FONT_BOLD}`;
  ctx.fillStyle = TITLE_TEXT;
  ctx.fillText(formatPrice(last, { stable: coin.stable }), WIDTH - 40, 62);

  ctx.textAlign = 'right';
  ctx.font = `28px ${FONT_BOLD}`;
  ctx.fillStyle = isUp ? UP : DOWN;
  const changeText = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
  ctx.fillText(changeText, WIDTH - 40, 96);
  drawTriangle(ctx, WIDTH - 40 - ctx.measureText(changeText).width - 22, 84, 16, 14, isUp, isUp ? UP : DOWN);
}

// A small filled triangle in place of a ▲/▼ text glyph — Poppins doesn't
// include that character, which would otherwise render as a missing-glyph box.
function drawTriangle(ctx, cx, cy, w, h, up, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy + h / 2);
  } else {
    ctx.moveTo(cx, cy + h / 2);
    ctx.lineTo(cx + w / 2, cy - h / 2);
    ctx.lineTo(cx - w / 2, cy - h / 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------

function drawLine(ctx, points, xAt, yAt, plotY, plotH, lineColor, fillColor) {
  // Gradient area fill under the line.
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(points[0].price));
  points.forEach((p, i) => ctx.lineTo(xAt(i), yAt(p.price)));
  ctx.lineTo(xAt(points.length - 1), plotY + plotH);
  ctx.lineTo(xAt(0), plotY + plotH);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
  gradient.addColorStop(0, fillColor);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // The line itself.
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.price);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawCandles(ctx, points, xAt, yAt, plotW) {
  // A little breathing room between candles; body width shrinks with density.
  const slotW = plotW / points.length;
  const bodyW = Math.max(2, Math.min(18, slotW * 0.6));

  points.forEach((p, i) => {
    const x = xAt(i);
    const up = p.c >= p.o;
    const color = up ? UP : DOWN;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    // Wick.
    ctx.beginPath();
    ctx.moveTo(x, yAt(p.h));
    ctx.lineTo(x, yAt(p.l));
    ctx.stroke();

    // Body.
    const yOpen = yAt(p.o);
    const yClose = yAt(p.c);
    const top = Math.min(yOpen, yClose);
    const h = Math.max(1.5, Math.abs(yClose - yOpen));
    ctx.fillRect(x - bodyW / 2, top, bodyW, h);
  });
}

function drawWatermark(ctx) {
  ctx.font = `26px ${FONT_REGULAR}`;
  ctx.fillStyle = 'rgba(209, 212, 220, 0.55)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(CONFIG.watermark, WIDTH - 40, HEIGHT - 28);
}
