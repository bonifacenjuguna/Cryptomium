// The price chart: a line, candlesticks, or two coins compared, drawn as SVG, updated live.
//
// Selecting a moment: moving the mouse over the chart or touching it puts a dotted
// crosshair on that moment. What it says is shown in a legend line ABOVE the chart (never in
// a card on top of the data), the way trading platforms do it. The crosshair STAYS where it
// was left, even after the finger or cursor leaves; it only goes away when the visitor clicks
// or taps somewhere else on the page, or presses Escape. While it is shown it keeps its place
// as live prices arrive.
//
// Zoom: two fingers pinch the time axis (the moment under the fingers stays under them, and moving
// both fingers pans). On a computer the wheel with Ctrl or Cmd, or a trackpad pinch, zooms around the
// cursor; dragging pans while zoomed; a double tap/click, 0, or the Reset chip returns to the whole
// range. One finger always means one crosshair. While a moment is selected the price scale is held
// still so the chart does not shake as the finger moves.
import { el, money, currency, pct, prefs } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const RANGE_MS = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, '90d': 90 * 864e5, '1y': 365 * 864e5 };
const RANGE_LABEL = { '24h': '24H', '7d': '7D', '30d': '30D', '90d': '90D', '1y': '1Y' };
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
const signed = v => pct(v);

export function createChart(host, { stable = false, legend = null, onChange = () => {} } = {}) {
  const st = {
    type: 'line', // line | candles | compare
    range: '7d',
    base: null, // [[t, usd]] from the server
    tail: [], // live points added since
    candles: null, // [[t, o, h, l, c]] in usd
    series: null, // compare: [{ label, points: [[t, usd]] }]
    message: 'Loading chart',
    sel: null, // selected moment (ms) or null
    win: null, // zoom window { a, b, pinned } in ms, or null for the whole range
    frozen: null, // price scale held while a moment is selected
    dom: null, // { T0, T1 } of the whole data
  };
  let view = null; // geometry of the last draw
  let dragging = false;
  let pinching = false;
  let panning = null;
  const MIN_SPAN_MS = 60 * 1000;

  // ---------------------------------------------------------------- data
  const lineSeries = () => (st.base ? st.base.concat(st.tail) : null);

  function setData({ type, range, points = null, candles = null, series = null, message = '' }) {
    st.type = type;
    st.range = range;
    st.base = points;
    st.tail = [];
    st.candles = candles;
    st.series = series;
    st.message = message;
    st.sel = null;
    st.win = null;
    st.frozen = null;
    draw();
  }
  function setMessage(message) { st.message = message; st.base = null; st.candles = null; st.series = null; draw(); }

  /** A new live price. Extends the line (or the newest candle) and redraws. */
  function tick(priceUsd, now = Date.now()) {
    if (!(priceUsd > 0) || st.type === 'compare') return;
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

  // ---------------------------------------------------------------- zoom window
  const fullData = () => (st.type === 'compare' ? null : st.type === 'candles' ? st.candles : lineSeries());
  function resolveWin(arr) {
    const T0 = arr[0][0], T1 = arr.at(-1)[0];
    const total = Math.max(1, T1 - T0);
    if (!st.win) return { a: T0, b: T1, T0, T1, total, zoomed: false };
    let { a, b } = st.win;
    const span = Math.min(total, Math.max(minSpan(arr), b - a));
    if (st.win.pinned) { b = T1; a = T1 - span; } else { b = a + span; }
    if (a < T0) { a = T0; b = a + span; }
    if (b > T1) { b = T1; a = b - span; }
    return { a, b, T0, T1, total, zoomed: span < total * 0.995 };
  }
  function minSpan(arr) {
    const T0 = arr[0][0], T1 = arr.at(-1)[0];
    return Math.max(MIN_SPAN_MS, ((T1 - T0) * 14) / Math.max(14, arr.length));
  }
  function slice(arr, w, pad) {
    if (!w.zoomed) return arr;
    let lo = 0, hi = arr.length - 1;
    while (lo < arr.length - 1 && arr[lo][0] < w.a) lo++;
    while (hi > 0 && arr[hi][0] > w.b) hi--;
    if (pad) { lo = Math.max(0, lo - 1); hi = Math.min(arr.length - 1, hi + 1); }
    if (hi - lo < 1) { lo = Math.max(0, Math.min(lo, arr.length - 2)); hi = lo + 1; }
    return arr.slice(lo, hi + 1);
  }
  function setWin(a, b, pinned = false) {
    const arr = fullData();
    if (!arr || arr.length < 3) return;
    const T0 = arr[0][0], T1 = arr.at(-1)[0];
    const total = T1 - T0;
    const span = Math.min(total, Math.max(minSpan(arr), b - a));
    if (span >= total * 0.995) st.win = null;
    else {
      let na = Math.max(T0, Math.min(T1 - span, a));
      st.win = { a: na, b: na + span, pinned: pinned || na + span >= T1 - total * 0.004 };
    }
    st.frozen = null;
    draw();
  }
  /** Zoom by `factor` (>1 zooms in) keeping the moment at fraction `frac` (0..1) of the plot in place. */
  function zoomAt(factor, frac) {
    const arr = fullData();
    if (!arr || arr.length < 3) return;
    const w = resolveWin(arr);
    const span = w.b - w.a;
    const next = Math.min(w.total, Math.max(minSpan(arr), span / factor));
    const anchor = w.a + frac * span;
    setWin(anchor - frac * next, anchor + (1 - frac) * next, false);
  }
  function resetZoom() { if (st.win) { st.win = null; st.frozen = null; draw(); } }
  const plotFrac = clientX => {
    const r = host.getBoundingClientRect();
    const padL = view ? view.padL : 0, iw = view ? view.iw : r.width;
    return Math.max(0, Math.min(1, (clientX - r.left - padL) / (iw || 1)));
  };

  // ---------------------------------------------------------------- legend (above the chart)
  function legendItem(label, value, cls = '') {
    const s = el('span', 'lg-item ' + cls);
    s.append(el('i', '', label), el('em', 'num', value));
    return s;
  }
  function paintLegend(sel) {
    if (!legend || !view) return;
    const v = view;
    const title = el('div', 'lg-title');
    const vals = el('div', 'lg-vals');
    if (v.mode === 'compare') {
      const i = sel == null ? v.n - 1 : sel;
      title.append(el('span', 'lg-time', sel == null ? 'Past ' + RANGE_LABEL[st.range] : tipTime(v.times[i], st.lr || st.range)));
      v.cmp.forEach((s, k) => {
        const idx = sel == null ? s.pts.length - 1 : s.nearest(v.times[i]);
        const ch = signed(s.pts[idx][1]);
        const item = legendItem(s.label, ch.text, 'chg ' + ch.cls);
        item.classList.add('lg-s' + k);
        vals.append(item);
      });
    } else if (sel == null) {
      const { data, isC } = v;
      const first = data[0][1];
      const lastV = isC ? data.at(-1)[4] : data.at(-1)[1];
      const ch = signed(((lastV - first) / first) * 100);
      const zoomLabel = v.zoomed ? timeLabel(v.t0, st.lr || st.range) + ' – ' + timeLabel(v.t1, st.lr || st.range) : 'Past ' + RANGE_LABEL[st.range];
      title.append(el('span', 'lg-time', zoomLabel), Object.assign(el('b', 'chg num ' + ch.cls), { textContent: ch.text }));
      if (isC) {
        const c = data.at(-1);
        for (const [l, x] of [['O', c[1]], ['H', c[2]], ['L', c[3]], ['C', c[4]]]) vals.append(legendItem(l, money(x, { stable })));
      } else {
        const ys = data.map(p => p[1]);
        vals.append(legendItem('High', money(Math.max(...ys), { stable })), legendItem('Low', money(Math.min(...ys), { stable })), legendItem('Last', money(lastV, { stable })));
      }
    } else {
      const d = v.data[sel];
      const startVal = v.data[0][1];
      title.append(el('span', 'lg-time', tipTime(d[0], st.lr || st.range)));
      if (v.isC) {
        const body = signed(((d[4] - d[1]) / d[1]) * 100);
        title.append(Object.assign(el('b', 'chg num ' + body.cls), { textContent: body.text }));
        for (const [l, x] of [['O', d[1]], ['H', d[2]], ['L', d[3]], ['C', d[4]]]) vals.append(legendItem(l, money(x, { stable })));
      } else {
        const ch = signed(((d[1] - startVal) / startVal) * 100);
        title.append(Object.assign(el('b', 'chg num ' + ch.cls), { textContent: ch.text }));
        vals.append(legendItem('Price', money(d[1], { stable })));
      }
    }
    legend.classList.toggle('is-sel', sel != null);
    legend.replaceChildren(title, vals);
  }

  // ---------------------------------------------------------------- drawing
  function draw() {
    host.replaceChildren();
    view = null;
    const mode = st.type;
    const isC = mode === 'candles';
    const isCmp = mode === 'compare';
    const whole = isCmp ? st.series?.[0]?.points : isC ? st.candles : lineSeries();
    if (!whole || whole.length < 2) {
      host.append(el('div', 'chart-msg', st.message || 'Loading chart'));
      if (legend) legend.replaceChildren();
      return;
    }
    if (isCmp) st.win = null; // comparing coins always shows the whole range
    const win = whole.length > 2 ? resolveWin(whole) : { a: whole[0][0], b: whole.at(-1)[0], T0: whole[0][0], T1: whole.at(-1)[0], total: 1, zoomed: false };
    st.dom = { T0: win.T0, T1: win.T1 };
    const data = isCmp ? whole : slice(whole, win, !isC);
    const rate = currency.rate;
    const W = host.clientWidth || 640;
    const H = host.clientHeight || 320;
    const inside = W < 560; // phones: the price scale sits over the chart so the data gets the full width
    const padL = 4, padT = 12, padB = 26;

    // Compare mode works in percent change from the start, so two very different prices share one scale.
    let cmp = null;
    if (isCmp) {
      cmp = st.series.map(s => {
        const pts = s.points.map(p => [p[0], (p[1] / s.points[0][1] - 1) * 100]);
        const times = pts.map(p => p[0]);
        const nearest = t => {
          let lo = 0, hi = times.length - 1;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m; else hi = m; }
          return Math.abs(times[lo] - t) <= Math.abs(times[hi] - t) ? lo : hi;
        };
        return { label: s.label, pts, nearest };
      });
    }

    const vals = isCmp ? cmp.flatMap(s => s.pts.map(p => p[1])) : isC ? data.flatMap(c => [c[2] * rate, c[3] * rate]) : data.map(p => p[1] * rate);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
    lo -= pad; hi += pad;
    if (st.sel != null && st.frozen) { lo = Math.min(lo, st.frozen.lo); hi = Math.max(hi, st.frozen.hi); }
    const tickValues = niceTicks(lo, hi);
    const fmtAxis = isCmp ? v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0) + '%' : v => money(v / rate, { stable });
    const longest = Math.max(0, ...tickValues.map(v => fmtAxis(v).length));
    let padR = inside ? 6 : Math.min(W * 0.42, Math.max(62, longest * 6.8 + 16));
    if (st.sel != null && st.frozen && !inside) padR = Math.max(padR, st.frozen.padR);
    st.frozen = st.sel != null ? { lo, hi, padR } : null;
    const iw = W - padL - padR, ih = H - padT - padB;
    const y = v => padT + (1 - (v - lo) / (hi - lo)) * ih;

    const t0 = isC || isCmp ? data[0][0] : win.a, t1 = isC || isCmp ? data.at(-1)[0] : win.b;
    st.lr = t1 - t0 <= 3 * 864e5 && st.range !== '24h' ? '24h' : null; // a zoomed-in view shows clock times
    const n = data.length;
    const band = iw / n;
    const x = isC ? i => padL + band * (i + 0.5) : i => padL + ((data[i][0] - t0) / (t1 - t0 || 1)) * iw;
    const xt = t => padL + ((t - t0) / (t1 - t0 || 1)) * iw;

    const first = isCmp ? 0 : data[0][1];
    const lastV = isCmp ? cmp[0].pts.at(-1)[1] : isC ? data.at(-1)[4] : data.at(-1)[1];
    const up = isCmp ? lastV >= 0 : lastV >= first;
    const color = isCmp ? cssVar('--accent') : cssVar(up ? '--up' : '--down');
    const color2 = cssVar('--focus');
    const upFill = cssVar('--up-fill'), downFill = cssVar('--down-fill');

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    const defs = svg('defs');
    const grad = svg('linearGradient', { id: 'cg', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(svg('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '.26' }), svg('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
    defs.append(grad);
    const clip = svg('clipPath', { id: 'cclip' });
    clip.append(svg('rect', { x: padL, y: 0, width: Math.max(1, iw), height: H }));
    defs.append(clip);
    root.append(defs);

    for (const v of tickValues) {
      const yy = y(v);
      root.append(svg('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yy, y2: yy }));
      const t = svg('text', inside
        ? { class: 'axis-t axis-in', x: W - 6, y: yy - 5, 'text-anchor': 'end' }
        : { class: 'axis-t', x: W - padR + 8, y: yy + 4 });
      t.textContent = fmtAxis(v);
      root.append(t);
    }
    if (isCmp) {
      const zy = y(0);
      if (zy > padT && zy < padT + ih) root.append(svg('line', { class: 'zero-line', x1: padL, x2: W - padR, y1: zy, y2: zy }));
    }
    const ticks = W < 520 ? 2 : 4;
    for (let k = 0; k <= ticks; k++) {
      const i = Math.round((k / ticks) * (n - 1));
      const tt = isC || isCmp ? data[i][0] : t0 + (k / ticks) * (t1 - t0);
      const tx = isC ? x(i) : xt(tt);
      const t = svg('text', { class: 'axis-t', x: tx, y: H - 6, 'text-anchor': k === 0 ? 'start' : k === ticks ? 'end' : 'middle' });
      t.textContent = timeLabel(tt, st.lr || st.range);
      root.append(t);
    }

    if (isCmp) {
      cmp.forEach((s, k) => {
        const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${xt(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join('');
        root.append(svg('path', { class: 'line', d, stroke: k ? color2 : color }));
      });
    } else if (isC) {
      const bodyW = Math.max(1.6, Math.min(16, band * 0.62));
      data.forEach((c, i) => {
        const [, o, h, l, cl] = c;
        const col = cl >= o ? upFill : downFill;
        const cx = x(i);
        root.append(svg('line', { class: 'wick', x1: cx, x2: cx, y1: y(h * rate), y2: y(l * rate), stroke: col }));
        const top = y(Math.max(o, cl) * rate), bot = y(Math.min(o, cl) * rate);
        root.append(svg('rect', { class: 'candle', x: cx - bodyW / 2, y: top, width: bodyW, height: Math.max(1.5, bot - top), fill: col, rx: Math.min(1.5, bodyW / 3) }));
      });
      const ly = y(lastV * rate);
      root.append(svg('line', { class: 'last-line', x1: padL, x2: W - padR, y1: ly, y2: ly, stroke: color }));
    } else {
      const d = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[1] * rate).toFixed(1)}`).join('');
      const g = svg('g', { 'clip-path': 'url(#cclip)' });
      g.append(svg('path', { d: `${d}L${x(n - 1).toFixed(1)} ${padT + ih}L${x(0).toFixed(1)} ${padT + ih}Z`, fill: 'url(#cg)' }), svg('path', { class: 'line', d, stroke: color }));
      root.append(g);
    }

    // The live end of the chart: a price tag on the axis and, for the line, a pulsing dot.
    const atEdge = !win.zoomed || win.b >= win.T1 - win.total * 0.004;
    const tagText = isCmp ? '' : money(lastV, { stable });
    const tagW = isCmp ? 0 : Math.max(52, tagText.length * 6.9 + 14);
    const tagX = inside ? W - tagW - 2 : W - padR + 3;
    const ey = isCmp ? 0 : y(lastV * rate);
    if (!isCmp && atEdge) {
      const tag = svg('g', { class: 'end-tag' });
      tag.append(svg('rect', { x: tagX, y: ey - 9, width: tagW, height: 18, rx: 5, fill: color }));
      const tagT = svg('text', { x: tagX + tagW / 2, y: ey + 4, 'text-anchor': 'middle', class: 'tag-t' });
      tagT.textContent = tagText;
      tag.append(tagT);
      root.append(tag);
    }
    if (!isC && !isCmp && !win.zoomed || (!isC && !isCmp && win.b >= win.T1 - win.total * 0.004)) {
      const ring = svg('circle', { class: 'live-ring', cx: x(n - 1), cy: ey, r: 5, fill: color });
      ring.style.animationDelay = `${-(Date.now() % 2200)}ms`;
      root.append(ring, svg('circle', { class: 'live-dot', cx: x(n - 1), cy: ey, r: 3.6, fill: color }));
    }

    // Crosshair (hidden until a moment is selected).
    const vline = svg('line', { class: 'cursor', y1: padT, y2: padT + ih, visibility: 'hidden' });
    const hline = svg('line', { class: 'cursor', x1: padL, x2: W - padR, visibility: 'hidden' });
    const dot = svg('circle', { class: 'sel-dot', r: 5, fill: color, visibility: 'hidden' });
    const dot2 = svg('circle', { class: 'sel-dot', r: 5, fill: color2, visibility: 'hidden' });
    const pill = svg('g', { class: 'cross-pill', visibility: 'hidden' });
    const pillR = svg('rect', { width: tagW || 56, height: 18, rx: 5 });
    const pillT = svg('text', { 'text-anchor': 'middle', class: 'pill-t' });
    pill.append(pillR, pillT);
    root.append(vline, hline, dot, dot2, pill);
    host.append(root);
    host.classList.toggle('is-zoomed', win.zoomed);
    if (win.zoomed) {
      const chip = el('button', 'zoom-reset', 'Reset zoom');
      chip.type = 'button';
      chip.addEventListener('pointerdown', e => e.stopPropagation());
      chip.addEventListener('click', resetZoom);
      host.append(chip);
    }

    view = { zoomed: win.zoomed, lo, hi, mode, data, isC, isCmp, cmp, x, xt, y, n, W, H, padL, padR, padT, ih, iw, rate, vline, hline, dot, dot2, pill, pillR, pillT, tagW, tagX, color, band, t0, t1, times: isCmp ? cmp[0].pts.map(p => p[0]) : null };

    if (isCmp) onChange(null, st.range);
    else onChange(signed(((lastV - first) / first) * 100), st.range);
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
    const { isC, n, band, padL, iw, t0, t1 } = view;
    if (isC) return Math.max(0, Math.min(n - 1, Math.floor((px - padL) / band)));
    const t = t0 + ((px - padL) / iw) * (t1 - t0);
    return indexOfTime(t);
  }

  function renderSelection() {
    if (!view) return;
    const v = view;
    if (st.sel == null) {
      for (const n of [v.vline, v.hline, v.dot, v.dot2, v.pill]) n.setAttribute('visibility', 'hidden');
      host.classList.remove('has-sel');
      paintLegend(null);
      return;
    }
    host.classList.add('has-sel');
    const i = indexOfTime(st.sel);
    const d = v.data[i];
    const px = v.isC ? v.x(i) : v.xt(d[0]);
    v.vline.setAttribute('x1', px); v.vline.setAttribute('x2', px); v.vline.setAttribute('visibility', 'visible');

    if (v.isCmp) {
      v.hline.setAttribute('visibility', 'hidden');
      v.pill.setAttribute('visibility', 'hidden');
      [v.dot, v.dot2].forEach((dt, k) => {
        const s = v.cmp[k];
        const p = s.pts[s.nearest(d[0])];
        dt.setAttribute('cx', v.xt(p[0])); dt.setAttribute('cy', v.y(p[1])); dt.setAttribute('visibility', 'visible');
      });
      paintLegend(i);
      return;
    }
    const price = v.isC ? d[4] : d[1];
    const py = v.y(price * v.rate);
    v.hline.setAttribute('y1', py); v.hline.setAttribute('y2', py); v.hline.setAttribute('visibility', 'visible');
    if (!v.isC) { v.dot.setAttribute('cx', px); v.dot.setAttribute('cy', py); v.dot.setAttribute('visibility', 'visible'); } else v.dot.setAttribute('visibility', 'hidden');
    const text = money(price, { stable });
    const pw = Math.max(52, text.length * 6.9 + 14);
    const pxl = v.padR === 6 ? v.W - pw - 2 : v.W - v.padR + 3;
    v.pillR.setAttribute('width', pw);
    v.pillR.setAttribute('x', pxl); v.pillR.setAttribute('y', py - 9);
    v.pillT.setAttribute('x', pxl + pw / 2); v.pillT.setAttribute('y', py + 4);
    v.pillT.textContent = text;
    v.pill.setAttribute('visibility', 'visible');
    paintLegend(i);
  }

  let lastIdx = -1;
  function select(i) {
    if (!view) return;
    const idx = Math.max(0, Math.min(view.n - 1, i));
    if (idx !== lastIdx) { lastIdx = idx; if (prefs.get('haptics') && navigator.vibrate) { try { navigator.vibrate(3); } catch { /* optional */ } } }
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
  const canZoom = () => view && !view.isCmp && st.type !== 'compare';
  host.addEventListener('pointerdown', e => {
    if (e.button > 0 || !e.isPrimary || pinching) return; // a second finger is never a second line
    if (e.pointerType === 'mouse' && canZoom() && view.zoomed) {
      panning = { x: e.clientX, a: st.win ? st.win.a : view.t0, b: st.win ? st.win.b : view.t1, moved: false };
      try { host.setPointerCapture(e.pointerId); } catch { /* fine */ }
      host.classList.add('is-panning');
      return;
    }
    dragging = true;
    place(e);
  });
  host.addEventListener('pointermove', e => {
    if (pinching || !e.isPrimary) return;
    if (panning) {
      const dx = e.clientX - panning.x;
      if (Math.abs(dx) > 2) panning.moved = true;
      const span = panning.b - panning.a;
      const dt = -(dx / (view.iw || 1)) * span;
      setWin(panning.a + dt, panning.b + dt, false);
      return;
    }
    if (e.pointerType === 'mouse' || dragging) place(e);
  });
  const endDrag = () => { dragging = false; if (panning) { panning = null; host.classList.remove('is-panning'); } };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);

  // Two fingers: pinch to zoom, move both to pan. The moment under the fingers stays under them.
  let pinch = null;
  const touchInfo = e => {
    const [p, q] = [e.touches[0], e.touches[1]];
    return { dist: Math.max(20, Math.hypot(p.clientX - q.clientX, p.clientY - q.clientY)), cx: (p.clientX + q.clientX) / 2 };
  };
  host.addEventListener('touchstart', e => {
    if (e.touches.length !== 2 || !canZoom()) return;
    e.preventDefault();
    pinching = true;
    dragging = false;
    clear(); // the first finger's crosshair gives way to the pinch
    const arr = fullData();
    const w = resolveWin(arr);
    const info = touchInfo(e);
    pinch = { dist: info.dist, a: w.a, b: w.b, total: w.total, anchorT: w.a + plotFrac(info.cx) * (w.b - w.a), minSpan: minSpan(arr) };
  }, { passive: false });
  host.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const info = touchInfo(e);
    const span0 = pinch.b - pinch.a;
    const span = Math.min(pinch.total, Math.max(pinch.minSpan, span0 * (pinch.dist / info.dist)));
    const frac = plotFrac(info.cx);
    setWin(pinch.anchorT - frac * span, pinch.anchorT + (1 - frac) * span, false);
  }, { passive: false });
  const endPinch = e => { if (pinch && (!e.touches || e.touches.length < 2)) { pinch = null; setTimeout(() => { pinching = false; }, 60); } };
  host.addEventListener('touchend', endPinch, { passive: true });
  host.addEventListener('touchcancel', endPinch, { passive: true });

  // Mouse wheel with Ctrl or Cmd (a trackpad pinch arrives the same way) zooms around the cursor.
  // Plain scrolling is left alone so the page still scrolls; sideways scrolling pans while zoomed.
  host.addEventListener('wheel', e => {
    if (!canZoom()) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.03 : 0.0042)), plotFrac(e.clientX));
    } else if (view.zoomed && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const w = resolveWin(fullData());
      const dt = (e.deltaX / (view.iw || 1)) * (w.b - w.a);
      setWin(w.a + dt, w.b + dt, false);
    }
  }, { passive: false });
  host.addEventListener('dblclick', () => resetZoom());
  let lastTap = 0;
  host.addEventListener('pointerup', e => {
    if (e.pointerType !== 'touch' || pinching) return;
    const now = Date.now();
    if (now - lastTap < 320) resetZoom();
    lastTap = now;
  });

  // Clicking or tapping anywhere else on the page is what clears the crosshair. The legend,
  // the controls around the chart, and the chart itself keep it.
  document.addEventListener('pointerdown', e => {
    if (host.contains(e.target) || (legend && legend.contains(e.target))) return;
    clear();
  }, true);
  host.addEventListener('keydown', e => {
    if (!view) return;
    const cur = st.sel == null ? null : indexOfTime(st.sel);
    if (e.key === 'ArrowLeft') { e.preventDefault(); select(cur == null ? view.n - 1 : cur - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); select(cur == null ? 0 : cur + 1); }
    else if (e.key === 'Escape') clear();
    else if ((e.key === '+' || e.key === '=') && canZoom()) { e.preventDefault(); zoomAt(1.5, 0.5); }
    else if ((e.key === '-' || e.key === '_') && canZoom()) { e.preventDefault(); zoomAt(1 / 1.5, 0.5); }
    else if (e.key === '0') { e.preventDefault(); resetZoom(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') clear(); });

  return { setData, setMessage, tick, redraw: draw, clear, resetZoom, zoomAt, get type() { return st.type; }, get range() { return st.range; } };
}
