// Shared market-intelligence helpers: one fetch of the market details for every page,
// the merged live+market rows, and the Insights readings. Every label here comes from a
// stated rule applied to numbers we already have. Nothing is predicted.
import { getJSON, el, logoEl, money, pct } from './common.js';

let marketPromise = null;
/** Market details for all coins, shared by every caller on the page. */
export function loadMarket(force = false) {
  if (!marketPromise || force) {
    marketPromise = getJSON('/api/market').catch(err => { marketPromise = null; throw err; });
  }
  return marketPromise;
}

/** Joins the coin list, live prices and market details into one row per coin. */
export function buildRows(coins, live, market) {
  return coins.map((c, i) => {
    const l = live.get(c.ticker) || {};
    const m = market?.[c.ticker] || {};
    const price = l.price ?? null;
    return {
      ticker: c.ticker, name: c.name, stable: Boolean(c.stable || l.stable), order: i, logo: l.logo ?? null, color: l.color ?? null,
      price,
      c1h: m.change1h ?? null, c24: l.change24h ?? m.change24h ?? null, c7: m.change7d ?? null, c30: m.change30d ?? null, c1y: m.change1y ?? null,
      cap: m.marketCap ?? null, vol: m.volume24h ?? null,
      volCap: m.marketCap > 0 && m.volume24h != null ? (m.volume24h / m.marketCap) * 100 : null,
      rank: m.rank ?? null, high24: m.high24h ?? null, low24: m.low24h ?? null,
      ath: m.ath ?? null, athDate: m.athDate ?? null, atl: m.atl ?? null, atlDate: m.atlDate ?? null,
      athDist: price && m.ath ? (price / m.ath - 1) * 100 : (m.athChange ?? null),
      atlUp: price && m.atl > 0 ? (price / m.atl - 1) * 100 : (m.atlChange ?? null),
      circ: m.circulating ?? null, maxSupply: m.maxSupply ?? null, totalSupply: m.totalSupply ?? null,
      spark: m.spark || [],
    };
  });
}

// ---------- Insights (rules are shown to the reader in the UI) ----------
export const RULES = {
  momentum: 'Counts how many of the 24h, 7d and 30d changes are positive; "Strong" also needs 7d beyond 5%.',
  trend: '7-day change: above +1% positive, below −1% negative, otherwise flat.',
  volatility: '24h high–low range as a share of price: under 2% low, under 5% moderate, under 10% high, else extreme.',
  activity: '24h volume as a share of market cap: under 2% quiet, under 8% normal, under 20% busy, else very busy.',
  ath: 'Distance of the live price from its all-time high.',
  peg: 'Stablecoins only: how far the price is from $1. Under 0.2% holding, under 0.5% slight drift, beyond that off its peg.',
};

export function stableInsights(r) {
  if (!r || !r.stable || !(r.price > 0)) return null;
  const dev = Math.abs(r.price - 1) * 100;
  const peg = dev < 0.2 ? ['Holding', 'up'] : dev < 0.5 ? ['Slight drift', 'warn'] : ['Off peg', 'down'];
  const range = r.high24 != null && r.low24 != null ? ((r.high24 - r.low24) / r.price) * 100 : null;
  const activity = r.volCap == null ? null : r.volCap < 2 ? ['Quiet', 'flat'] : r.volCap < 8 ? ['Normal', 'flat'] : r.volCap < 20 ? ['Busy', 'warn'] : ['Very busy', 'warn'];
  return { peg, dev, range, activity };
}

export function insights(r) {
  if (!r || r.stable) return null;
  const ch = [r.c24, r.c7, r.c30].filter(v => typeof v === 'number');
  let momentum = null;
  if (ch.length >= 2) {
    const ups = ch.filter(v => v > 0).length;
    const downs = ch.filter(v => v < 0).length;
    momentum = ups === ch.length && (r.c7 ?? 0) >= 5 ? ['Strong', 'up']
      : downs === ch.length && (r.c7 ?? 0) <= -5 ? ['Weak', 'down']
      : ups > downs ? ['Positive', 'up'] : downs > ups ? ['Negative', 'down'] : ['Mixed', 'flat'];
  }
  const trend = typeof r.c7 === 'number' ? (r.c7 > 1 ? ['Positive', 'up'] : r.c7 < -1 ? ['Negative', 'down'] : ['Flat', 'flat']) : null;
  const range = r.price > 0 && r.high24 != null && r.low24 != null ? ((r.high24 - r.low24) / r.price) * 100 : null;
  const volatility = range == null ? null : range < 2 ? ['Low', 'flat'] : range < 5 ? ['Moderate', 'flat'] : range < 10 ? ['High', 'warn'] : ['Extreme', 'warn'];
  const activity = r.volCap == null ? null : r.volCap < 2 ? ['Quiet', 'flat'] : r.volCap < 8 ? ['Normal', 'flat'] : r.volCap < 20 ? ['Busy', 'warn'] : ['Very busy', 'warn'];
  return { momentum, trend, volatility, activity, range, athDist: r.athDist };
}

/** Distance from the all-time high / recovery from the low, as readable text. */
export const distText = v => (typeof v === 'number' && Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: v > 1000 ? 0 : 1 }) + '%' : '–');
export const dateText = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '–');
export const supplyText = v => (typeof v === 'number' ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(v) : '–');

/** A coin cell: logo, symbol, name. */
export function coinCell(r, { name = true } = {}) {
  const a = el('a', 'coin-cell');
  a.href = '/coin/' + r.ticker;
  a.append(logoEl({ ticker: r.ticker, logo: r.logo, color: r.color }));
  const t = el('span', 'cc-t');
  t.append(el('span', 'c-sym', r.ticker));
  if (name) t.append(el('span', 'c-name', r.name));
  a.append(t);
  return a;
}

export function changeSpan(v, cls = '') {
  const p = pct(v);
  return el('span', `chg num ${p.cls} ${cls}`.trim(), p.text);
}

export function tag(text, tone = 'flat') { return el('span', 'tag ' + tone, text); }

export function sparkLine(values, up, { w = 112, h = 34 } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'spark ' + (up ? 'up' : 'down'));
  svg.setAttribute('aria-hidden', 'true');
  if (!values || values.length < 2) return svg;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * (w - 1)).toFixed(1)} ${((h - 4) - ((v - min) / span) * (h - 8)).toFixed(1)}`).join('');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}

export { money, pct };
