/**
 * Accessible SVG line chart (no library). The same data is also given as a
 * table, so screen-reader users get every value.
 */
import { h, uid, dateLabel } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};

/**
 * @param {{ title: string, unit: string, series: { name: string, points: { t: string, y: number }[] }[] }} opts
 */
export function lineChart({ title, unit, series }) {
  const all = series.flatMap((x) => x.points);
  if (!all.length) return h('p', { class: 'muted' }, 'No readings yet for this period.');
  const W = 640;
  const H = 260;
  const pad = { l: 48, r: 16, t: 16, b: 36 };
  const times = all.map((p) => Date.parse(p.t));
  const minT = Math.min(...times);
  const maxT = Math.max(...times) === minT ? minT + 86_400_000 : Math.max(...times);
  const ys = all.map((p) => p.y);
  const spread = Math.max(...ys) - Math.min(...ys) || 10;
  const minY = Math.floor(Math.min(...ys) - spread * 0.15);
  const maxY = Math.ceil(Math.max(...ys) + spread * 0.15);
  const x = (t) => pad.l + ((Date.parse(t) - minT) / (maxT - minT)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - ((v - minY) / (maxY - minY)) * (H - pad.t - pad.b);

  const titleId = uid('chart');
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-labelledby': titleId });
  svg.append(s('title', { id: titleId }, `${title} over time, in ${unit}`));
  for (let i = 0; i <= 4; i += 1) {
    const v = minY + ((maxY - minY) * i) / 4;
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(s('text', { x: pad.l - 8, y: y(v) + 5, 'text-anchor': 'end', class: 'axis' }, Math.round(v)));
  }
  svg.append(s('text', { x: pad.l, y: H - 10, class: 'axis' }, dateLabel(new Date(minT).toISOString())));
  svg.append(s('text', { x: W - pad.r, y: H - 10, 'text-anchor': 'end', class: 'axis' }, dateLabel(new Date(maxT).toISOString())));

  series.forEach((ser, i) => {
    const pts = [...ser.points].sort((a, b) => a.t.localeCompare(b.t));
    svg.append(s('polyline', { points: pts.map((p) => `${x(p.t)},${y(p.y)}`).join(' '), class: `line line-${i}` }));
    for (const p of pts) svg.append(s(i === 0 ? 'circle' : 'rect', i === 0 ? { cx: x(p.t), cy: y(p.y), r: 5, class: `dot dot-${i}` } : { x: x(p.t) - 5, y: y(p.y) - 5, width: 10, height: 10, class: `dot dot-${i}` }));
  });

  const legend = series.length > 1
    ? h('ul', { class: 'legend' }, series.map((ser, i) => h('li', { class: `legend-${i}` }, ser.name)))
    : null;

  const rows = [...new Set(all.map((p) => p.t))].sort().reverse();
  const table = h(
    'details',
    { class: 'chart-table' },
    h('summary', {}, 'Show the readings as a table'),
    h(
      'table',
      {},
      h('caption', {}, `${title} (${unit})`),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'When'), series.map((ser) => h('th', { scope: 'col' }, ser.name)))),
      h('tbody', {}, rows.map((t) => h('tr', {}, h('th', { scope: 'row' }, dateLabel(t, { hour: 'numeric', minute: '2-digit' })), series.map((ser) => h('td', {}, ser.points.find((p) => p.t === t)?.y ?? '—'))))),
    ),
  );
  return h('figure', { class: 'chart-wrap' }, svg, legend, table);
}
