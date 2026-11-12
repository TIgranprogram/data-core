// Общие помощники «Карты сайта» (C097): SVG, блоки по id, перенос строк, ломаные линии. Без DOM-состояния.
import { SECTIONS } from './help-guide-data.js';
import { BANDS, NODES } from './atlas-data.js';

export const NS = 'http://www.w3.org/2000/svg';
export const s = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  e.append(...kids.flat().filter((k) => k != null)); return e;
};

export const byId = new Map(NODES.map((n) => [n.id, n]));
export const bandOf = new Map(BANDS.map((b, i) => [b.id, { ...b, i }]));
export const tone = (n) => bandOf.get(n.band).tok;
export const nameOf = (n) => (n.t === 'ИЗДЕЛИЕ' ? 'Изделие' : n.t);
/** Подпись будущего: «идея» (предложение, решает владелец) или «в разработке» (задача в очереди). */
export const planLabel = (plan) => (plan === 'идея' ? 'идея' : 'в разработке');
export const hrefOf = (n) => n.href || (n.sec ? SECTIONS[n.sec]?.href : null);

/** Ломаная с чуть скруглёнными углами (радиус r): прямые отрезки, без дуг-«макарон». */
export function roundPath(pts, r) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const r1 = Math.min(r, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const ax = x - Math.sign(x - px) * r1, ay = y - Math.sign(y - py) * r1, bx = x + Math.sign(nx - x) * r1, by = y + Math.sign(ny - y) * r1;
    d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + ` L${lx},${ly}`;
}

/** Перенос по словам в lines строк; не влезло — многоточие в последней. */
export function fit(t, max, lines) {
  const out = wrap(t, max);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].slice(0, max - 1).replace(/[\s;,]+$/, '') + '…'; }
  return out;
}

export function wrap(t, max) {
  const out = [];
  for (const w of t.split(' ')) { const last = out[out.length - 1]; if (last && (last + ' ' + w).length <= max) out[out.length - 1] = last + ' ' + w; else out.push(w); }
  return out;
}
