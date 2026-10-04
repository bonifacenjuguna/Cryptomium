// The price chart: a line or candlesticks, drawn as SVG, updated live.
//
// Selecting a moment: moving the mouse over the chart or touching it puts a dotted
// crosshair on that moment, with a readout. The crosshair STAYS where it was left, even
// after the finger or cursor leaves; it only goes away when the visitor clicks or taps
// somewhere else on the page, or presses Escape. While it is shown it keeps its place
// as live prices arrive.
import { el, money, currency, pct } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const RANGE_MS = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, '90d': 90 * 864e5, '1y': 365 * 864e5 };
const MAX_TAIL = 600;

function niceTicks(min, max, n = 4) {
  const span = max - min || Math.abs(max) * 0.02 || 1;
  const raw = span / n;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * 10 ** exp;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}
function timeLabel(ms, range) {
  const d = new Date(ms);
  if (range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '1y') return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function tipTime(ms, range) {
  const d = new Date(ms);
  if (range === '24h' || range === '7d') return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export function createChart(host, { stable = false, onChange = () => {} } = {}) {
  const st = {
    type: 'line',
    range: '7d',
    base: null, // [[t, usd]] from the server
    tail: [], // live points added since
    candles: null, // [[t, o, h, l, c]] in usd
    message: 'Loading chart',
    sel: null, // selected moment (ms) or null
  };
  let view = null; // geometry of the last draw
  let dragging = false;

  // ---------------------------------------------------------------- data
  const lineSeries = () => (st.base ? st.base.concat(st.tail) : null);

  function setData({ type, range, points = null, candles = null, message = '' }) {
    st.type = type;
    st.range = range;
    st.base = points;
    st.tail = [];
    st.candles = candles;
    st.message = message;
    st.sel = null;
    draw();
  }
  function setMessage(message) { st.message = message; st.base = null; st.candles = null; draw(); }

  /** A new live price. Extends the line (or the newest candle) and redraws. */
  function tick(priceUsd, now = Date.now()) {
    if (!(priceUsd > 0)) return;
    if (st.type === 'candles') {
      const c = st.candles;
      if (!c || c.length < 2) return;
      const ivl = c.at(-1)[0] - c.at(-2)[0];
      const last = c.at(-1);
      if (ivl > 0 && now >= last[0] + ivl) {
        const t = last[0] + Math.floor((now - last[0]) / ivl) * ivl;
        c.push([t, last[4], Math.max(last[4], priceUsd), Math.min(last[4], priceUsd), priceUsd]);
        if (c.length > 400) c.shift();
      } else {
        last[4] = priceUsd;
        last[2] = Math.max(last[2], priceUsd);
        last[3] = Math.min(last[3], priceUsd);
      }
    } else {
      if (!st.base || st.base.length < 2) return;
      const step = RANGE_MS[st.range] / 220;
      const lastTail = st.tail.at(-1);
      const anchorT = lastTail ? lastTail[0] : st.base.at(-1)[0];
      if (!lastTail || now - lastTail[0] >= step) {
        if (now > anchorT) st.tail.push([now, priceUsd]);
      } else {
        lastTail[0] = now;
        lastTail[1] = priceUsd;
      }
      if (st.tail.length > MAX_TAIL) st.tail.shift();
    }
    draw();
  }

  // ---------------------------------------------------------------- drawing
  function draw() {
    host.replaceChildren();
    view = null;
    const isC = st.type === 'candles';
    const data = isC ? st.candles : lineSeries();
    if (!data || data.length < 2) {
      host.append(el('div', 'chart-msg', st.message || 'Loading chart'));
      return;
    }
    const rate = currency.rate;
    const W = host.clientWidth || 640;
    const H = host.clientHeight || 320;
    const padL = 4, padT = 14, padB = 26;

    const vals = isC ? data.flatMap(c => [c[2] * rate, c[3] * rate]) : data.map(p => p[1] * rate);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || hi * 0.01;
    lo -= pad; hi += pad;
    const tickValues = niceTicks(lo, hi);
    const longest = Math.max(0, ...tickValues.map(v => money(v / rate, { stable }).length));
    const padR = Math.min(W * 0.42, Math.max(62, longest * 6.8 + 16));
    const iw = W - padL - padR, ih = H - padT - padB;
    const y = v => padT + (1 - (v - lo) / (hi - lo)) * ih;

    const t0 = data[0][0], t1 = data.at(-1)[0];
    const n = data.length;
    const band = iw / n;
    const x = isC ? i => padL + band * (i + 0.5) : i => padL + ((data[i][0] - t0) / (t1 - t0 || 1)) * iw;

    const first = isC ? data[0][1] : data[0][1];
    const lastV = isC ? data.at(-1)[4] : data.at(-1)[1];
    const up = lastV >= first;
    const color = cssVar(up ? '--up' : '--down');
    const upFill = cssVar('--up-fill'), downFill = cssVar('--down-fill');

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    const defs = svg('defs');
    const grad = svg('linearGradient', { id: 'cg', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(svg('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '.26' }), svg('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
    defs.append(grad);
    root.append(defs);

    for (const v of tickValues) {
      const yy = y(v);
      root.append(svg('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yy, y2: yy }));
      const t = svg('text', { class: 'axis-t', x: W - padR + 8, y: yy + 4 });
      t.textContent = money(v / rate, { stable });
      root.append(t);
    }
    const ticks = W < 520 ? 2 : 4;
    for (let k = 0; k <= ticks; k++) {
      const i = Math.round((k / ticks) * (n - 1));
      const t = svg('text', { class: 'axis-t', x: x(i), y: H - 6, 'text-anchor': k === 0 ? 'start' : k === ticks ? 'end' : 'middle' });
      t.textContent = timeLabel(data[i][0], st.range);
      root.append(t);
    }

    if (isC) {
      const bodyW = Math.max(1.6, Math.min(16, band * 0.62));
      data.forEach((c, i) => {
        const [, o, h, l, cl] = c;
        const col = cl >= o ? upFill : downFill;
        const cx = x(i);
        root.append(svg('line', { class: 'wick', x1: cx, x2: cx, y1: y(h * rate), y2: y(l * rate), stroke: col }));
        const top = y(Math.max(o, cl) * rate), bot = y(Math.min(o, cl) * rate);
        root.append(svg('rect', { class: 'candle', x: cx - bodyW / 2, y: top, width: bodyW, height: Math.max(1.5, bot - top), fill: col, rx: Math.min(1.5, bodyW / 3) }));
      });
      // The live price as a thin line across the chart.
      const ly = y(lastV * rate);
      root.append(svg('line', { class: 'last-line', x1: padL, x2: W - padR, y1: ly, y2: ly, stroke: color }));
    } else {
      const d = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[1] * rate).toFixed(1)}`).join('');
      root.append(svg('path', { d: `${d}L${x(n - 1).toFixed(1)} ${padT + ih}L${x(0).toFixed(1)} ${padT + ih}Z`, fill: 'url(#cg)' }));
      root.append(svg('path', { class: 'line', d, stroke: color }));
    }

    // The live end of the chart: a price tag on the axis and, for the line, a pulsing dot.
    const ey = y(lastV * rate);
    const tagW = padR - 6;
    const tag = svg('g', { class: 'end-tag' });
    tag.append(svg('rect', { x: W - padR + 3, y: ey - 9, width: tagW, height: 18, rx: 5, fill: color }));
    const tagT = svg('text', { x: W - padR + 3 + tagW / 2, y: ey + 4, 'text-anchor': 'middle', class: 'tag-t' });
    tagT.textContent = money(lastV, { stable });
    tag.append(tagT);
    root.append(tag);
    if (!isC) {
      const phase = -(Date.now() % 2200);
      root.append(svg('circle', { class: 'live-ring', cx: x(n - 1), cy: ey, r: 5, fill: color, style: `animation-delay:${phase}ms` }));
      root.append(svg('circle', { class: 'live-dot', cx: x(n - 1), cy: ey, r: 3.6, fill: color }));
    }

    // Crosshair (hidden until a moment is selected).
    const vline = svg('line', { class: 'cursor', y1: padT, y2: padT + ih, visibility: 'hidden' });
    const hline = svg('line', { class: 'cursor', x1: padL, x2: W - padR, visibility: 'hidden' });
    const dot = svg('circle', { class: 'sel-dot', r: 5, fill: color, visibility: 'hidden' });
    const pill = svg('g', { class: 'cross-pill', visibility: 'hidden' });
    const pillR = svg('rect', { width: tagW, height: 18, rx: 5 });
    const pillT = svg('text', { 'text-anchor': 'middle', class: 'pill-t' });
    pill.append(pillR, pillT);
    root.append(vline, hline, dot, pill);
    host.append(root);

    const tip = el('div', 'chart-tip num');
    tip.hidden = true;
    host.append(tip);

    view = { data, isC, x, y, n, W, H, padL, padR, padT, ih, iw, rate, vline, hline, dot, pill, pillR, pillT, tip, tagW, color, band, t0, t1 };

    const pctChange = ((lastV - first) / first) * 100;
    onChange(pct(pctChange), st.range);
    renderSelection();
  }

  // ---------------------------------------------------------------- selection
  function indexOfTime(t) {
    const { data } = view;
    let best = 0, gap = Infinity;
    for (let i = 0; i < data.length; i++) {
      const g = Math.abs(data[i][0] - t);
      if (g < gap) { gap = g; best = i; }
    }
    return best;
  }
  function indexFromClientX(clientX) {
    const r = host.getBoundingClientRect();
    const px = clientX - r.left;
    const { isC, n, band, padL, iw, t0, t1, data } = view;
    if (isC) return Math.max(0, Math.min(n - 1, Math.floor((px - padL) / band)));
    const t = t0 + ((px - padL) / iw) * (t1 - t0);
    return indexOfTime(t);
  }

  function renderSelection() {
    if (!view) return;
    const v = view;
    if (st.sel == null) {
      for (const n of [v.vline, v.hline, v.dot, v.pill]) n.setAttribute('visibility', 'hidden');
      v.tip.hidden = true;
      host.classList.remove('has-sel');
      return;
    }
    host.classList.add('has-sel');
    const i = indexOfTime(st.sel);
    const d = v.data[i];
    const px = v.x(i);
    const price = v.isC ? d[4] : d[1];
    const py = v.y(price * v.rate);
    v.vline.setAttribute('x1', px); v.vline.setAttribute('x2', px); v.vline.setAttribute('visibility', 'visible');
    v.hline.setAttribute('y1', py); v.hline.setAttribute('y2', py); v.hline.setAttribute('visibility', 'visible');
    if (!v.isC) { v.dot.setAttribute('cx', px); v.dot.setAttribute('cy', py); v.dot.setAttribute('visibility', 'visible'); } else v.dot.setAttribute('visibility', 'hidden');
    v.pillR.setAttribute('x', v.W - v.padR + 3); v.pillR.setAttribute('y', py - 9);
    v.pillT.setAttribute('x', v.W - v.padR + 3 + v.tagW / 2); v.pillT.setAttribute('y', py + 4);
    v.pillT.textContent = money(price, { stable });
    v.pill.setAttribute('visibility', 'visible');

    const startVal = v.isC ? v.data[0][1] : v.data[0][1];
    const delta = pct(((price - startVal) / startVal) * 100);
    const tip = v.tip;
    tip.hidden = false;
    tip.replaceChildren();
    tip.append(el('b', 'tip-price', money(price, { stable })), el('span', 'tip-time', tipTime(d[0], st.range)));
    if (v.isC) {
      const grid = el('span', 'tip-ohlc');
      for (const [label, val] of [['O', d[1]], ['H', d[2]], ['L', d[3]], ['C', d[4]]]) {
        grid.append(el('i', '', label), el('em', '', money(val, { stable })));
      }
      tip.append(grid);
      const body = pct(((d[4] - d[1]) / d[1]) * 100);
      tip.append(Object.assign(el('span', 'tip-delta chg ' + body.cls), { textContent: body.text + ' this candle' }));
    } else {
      tip.append(Object.assign(el('span', 'tip-delta chg ' + delta.cls), { textContent: delta.text + ' since the start' }));
    }
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const topY = v.isC ? v.y(d[2] * v.rate) : py;
    let ty = topY - h - 14;
    if (ty < 0) ty = Math.min(v.H - h - 4, topY + 18);
    tip.style.transform = `translate(${Math.max(0, Math.min(v.W - w, px - w / 2))}px, ${ty}px)`;
  }

  function select(i) {
    if (!view) return;
    const idx = Math.max(0, Math.min(view.n - 1, i));
    st.sel = view.data[idx][0];
    renderSelection();
  }
  function clear() {
    if (st.sel == null) return;
    st.sel = null;
    renderSelection();
  }

  // ---------------------------------------------------------------- input
  const place = e => { if (view) select(indexFromClientX(e.clientX)); };
  host.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    dragging = true;
    place(e);
  });
  host.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse' || dragging) place(e);
  });
  const endDrag = () => { dragging = false; };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);
  // Clicking or tapping anywhere else on the page is what clears the crosshair.
  document.addEventListener('pointerdown', e => { if (!host.contains(e.target)) clear(); }, true);
  host.addEventListener('keydown', e => {
    if (!view) return;
    const cur = st.sel == null ? null : indexOfTime(st.sel);
    if (e.key === 'ArrowLeft') { e.preventDefault(); select(cur == null ? view.n - 1 : cur - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); select(cur == null ? 0 : cur + 1); }
    else if (e.key === 'Escape') clear();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') clear(); });

  return { setData, setMessage, tick, redraw: draw, clear, get type() { return st.type; }, get range() { return st.range; } };
}
