// The Fear & Greed dial: five coloured bands from fear (left) to greed (right) and a needle.
const NS = 'http://www.w3.org/2000/svg';
const node = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const CX = 100, CY = 100, R = 78;
const pt = (deg, r = R) => [CX + r * Math.cos((deg * Math.PI) / 180), CY - r * Math.sin((deg * Math.PI) / 180)];
const arc = (from, to) => {
  const [x0, y0] = pt(from), [x1, y1] = pt(to);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

export const moodClass = v => (v < 25 ? 'm1' : v < 45 ? 'm2' : v <= 55 ? 'm3' : v < 75 ? 'm4' : 'm5');

/** Returns { svg, set(value) }. */
export function createGauge({ label = 'Fear and greed' } = {}) {
  const svg = node('svg', { viewBox: '0 0 200 118', class: 'gauge', role: 'img', 'aria-label': label });
  // Bands: 0-25, 25-45, 45-55, 55-75, 75-100 (left to right across the top half-circle).
  const bands = [[0, 25], [25, 45], [45, 55], [55, 75], [75, 100]];
  bands.forEach(([a, b], i) => {
    const from = 180 - a * 1.8 - 0.8, to = 180 - b * 1.8 + 0.8;
    svg.append(node('path', { d: arc(from, to), class: 'g-band g-m' + (i + 1) }));
  });
  const needle = node('g', { class: 'g-needle', transform: 'rotate(-90 100 100)' });
  needle.append(node('line', { x1: CX, y1: CY, x2: CX, y2: CY - 64, class: 'g-stem' }), node('circle', { cx: CX, cy: CY, r: 7, class: 'g-hub' }));
  svg.append(needle);
  return {
    svg,
    set(value) {
      const v = Math.max(0, Math.min(100, Number(value)));
      needle.setAttribute('transform', `rotate(${(-90 + v * 1.8).toFixed(1)} 100 100)`);
      svg.setAttribute('aria-label', `${label}: ${Math.round(v)} out of 100`);
    },
  };
}
