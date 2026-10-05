// Fear & Greed readings for the website.
//
// Overall market: the public Fear & Greed Index from alternative.me (free, no key). Their terms
// ask for the source to be acknowledged next to the figure, so the response carries `source` and
// the website shows a small "Source: alternative.me" under that gauge.
//
// Each coin: a 0-100 reading we compute ourselves from numbers we already hold (price momentum
// over 1 day, 7 days and 30 days, where the price sits inside its 24 hour range, and how busy
// trading is compared with the coin's size), nudged slightly toward the overall market mood.
const FNG_URL = 'https://api.alternative.me/fng/?limit=31&format=json';

export const labelFor = v => (v < 25 ? 'Extreme fear' : v < 45 ? 'Fear' : v <= 55 ? 'Neutral' : v < 75 ? 'Greed' : 'Extreme greed');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Maps x from [-span, +span] onto 0..100 (0 is the middle, 50). */
const scale = (x, span) => 50 + clamp(x / span, -1, 1) * 50;

export async function fetchOverall({ fetchFn = fetch } = {}) {
  const res = await fetchFn(FNG_URL, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Fear & Greed responded ${res.status}`);
  const body = await res.json();
  const rows = Array.isArray(body?.data) ? body.data : [];
  const nums = rows.map(r => Number(r.value)).filter(v => Number.isFinite(v));
  if (!nums.length) throw new Error('Fear & Greed returned no readings');
  const at = i => (nums[i] == null ? null : Math.round(nums[i]));
  const value = Math.round(nums[0]);
  return {
    value,
    label: labelFor(value),
    yesterday: at(1),
    lastWeek: at(7),
    lastMonth: at(30),
    updatedAt: rows[0]?.timestamp ? new Date(Number(rows[0].timestamp) * 1000).toISOString() : new Date().toISOString(),
    source: 'alternative.me',
  };
}

/** Our own reading for one coin from its market numbers. Returns null if there is too little to go on. */
export function coinScore(m, price, overall = null) {
  if (!m) return null;
  const parts = [];
  const add = (v, weight) => { if (typeof v === 'number' && Number.isFinite(v)) parts.push([v, weight]); };
  add(scale(m.change24h, 9), 0.30);
  add(scale(m.change7d, 22), 0.25);
  add(scale(m.change30d, 45), 0.15);
  if (m.high24h > m.low24h && price > 0) add(clamp(((price - m.low24h) / (m.high24h - m.low24h)) * 100, 0, 100), 0.15);
  if (m.marketCap > 0 && m.volume24h > 0) {
    // Heavy trading in a rising market reads as greed, in a falling one as fear.
    const heat = clamp((m.volume24h / m.marketCap) / 0.12, 0, 1);
    const dir = typeof m.change24h === 'number' ? Math.sign(m.change24h) : 0;
    add(50 + dir * heat * 40, 0.15);
  }
  if (parts.length < 2) return null;
  const weight = parts.reduce((a, [, w]) => a + w, 0);
  let v = parts.reduce((a, [x, w]) => a + x * w, 0) / weight;
  if (overall && Number.isFinite(overall.value)) v = v * 0.85 + overall.value * 0.15;
  v = Math.round(clamp(v, 1, 99));
  return { value: v, label: labelFor(v) };
}

/** market: { coins: { BTC: {...} } } from fetchMarket; prices: { BTC: 85000 } (optional). */
export async function buildSentiment({ market, prices = {}, fetchOverallFn = fetchOverall }) {
  let overall = null;
  try { overall = await fetchOverallFn(); } catch { /* the per-coin readings still work without it */ }
  const coins = {};
  for (const [ticker, m] of Object.entries(market?.coins || {})) {
    const s = coinScore(m, prices[ticker] ?? null, overall);
    if (s) coins[ticker] = s;
  }
  return { updatedAt: new Date().toISOString(), overall, coins };
}
