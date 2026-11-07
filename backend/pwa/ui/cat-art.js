/*
 * Рисунки категорий «Продукции» (первая страница — плитки разделов и групп).
 * Один стиль: графитовый металл, дерево, один зелёный акцент; фон — белый «paper» в обеих темах.
 * Подбор по названию категории (первое совпадение сверху вниз); нет совпадения — общий рисунок.
 */
import { familyOf } from "../core/facets.js";
const M = '#3b4148'; // металл
const W = '#b98552'; // дерево
const W2 = '#9a6a3d'; // дерево в тени
const A = '#4e7d5b'; // акцент
const G = '#e4e8e6'; // тень на земле
const ground = (cx = 80, rx = 58) => `<ellipse cx="${cx}" cy="88" rx="${rx}" ry="5" fill="${G}"/>`;
const ln = (d, c = M, w = 3) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const rect = (x, y, w, h, c, r = 1.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}"/>`;

const bench = () => ground() + ln('M38 86 V62 M122 86 V62 M44 86 L46 52 M116 86 L114 52') +
  rect(30, 58, 100, 5, W) + rect(30, 65, 100, 5, W2) + rect(40, 36, 80, 5, W) + rect(40, 44, 80, 5, W) + ln('M34 60 H126', M, 2);
const bin = (x = 80) => ground(x, 22) + `<path d="M${x - 15} 40 H${x + 15} L${x + 12} 86 H${x - 12} Z" fill="${M}"/>` + rect(x - 17, 34, 34, 7, A, 2) + ln(`M${x - 8} 50 V78 M${x} 50 V78 M${x + 8} 50 V78`, '#59616a', 2);
const SETS = [
  // склады (плитки «Остатков»): трубы — профильные и круглые вместе; основной — стеллаж с коробками
  [/^трубы$/i, () => ground(80, 64) + [[22, 60], [52, 60], [37, 34]].map(([x, y]) => rect(x, y, 26, 24, M, 2) + rect(x + 5, y + 5, 16, 14, '#f4f6f5', 1)).join('') +
    [[100, 72], [126, 72], [113, 50]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12" fill="${M}"/><circle cx="${x}" cy="${y}" r="7" fill="#f4f6f5"/>`).join('')],
  [/основн|^склад$/i, () => ground(80, 64) + ln('M30 86 V22 M130 86 V22', M, 4) + ln('M30 46 H130 M30 70 H130', M, 3) +
    `<path d="M40 26 L54 20 L68 26 V44 L54 50 L40 44 Z" fill="${W}"/><path d="M40 26 L54 32 L68 26 L54 20 Z" fill="#d1a173"/>` +
    rect(78, 28, 22, 16, A, 2) + rect(104, 32, 18, 12, W2, 2) + rect(40, 52, 30, 16, W2, 2) + rect(76, 54, 18, 14, W, 2) + `<circle cx="112" cy="61" r="7" fill="${M}"/><circle cx="112" cy="61" r="3" fill="#f4f6f5"/>`],
  // склад (мобильный «Выдать / Принять»): категории материалов
  [/метиз|крепёж|крепеж/i, () => ground(80, 60) + `<path d="M34 34 h22 v12 h-22 Z" fill="${M}"/>` + rect(40, 46, 10, 40, '#59616a', 1) +
    [52, 58, 64, 70, 76, 82].map((y) => ln(`M38 ${y} L52 ${y - 3}`, '#c9d0cc', 1.4)).join('') +
    `<path d="M76 58 l12 -7 l12 7 v14 l-12 7 l-12 -7 Z" fill="${M}"/><circle cx="88" cy="65" r="5" fill="#f4f6f5"/>` +
    `<circle cx="124" cy="72" r="12" fill="${A}"/><circle cx="124" cy="72" r="5" fill="#f4f6f5"/>`],
  [/расходн/i, () => ground(80, 60) + `<circle cx="58" cy="56" r="26" fill="${A}"/><circle cx="58" cy="56" r="18" fill="#5f8f6b"/><circle cx="58" cy="56" r="6" fill="#f4f6f5"/>` +
    rect(96, 30, 10, 18, M, 2) + `<path d="M98 48 h6 l-1 34 l-2 4 l-2 -4 Z" fill="#59616a"/>` + ln('M98 56 l6 4 M98 64 l6 4 M98 72 l6 4', '#c9d0cc', 1.4) +
    rect(118, 50, 22, 34, W, 3) + ln('M122 58 H136 M122 66 H136', W2, 2)],
  [/покупн/i, () => ground() + `<path d="M50 44 L80 30 L110 44 V76 L80 90 L50 76 Z" fill="${W}"/><path d="M50 44 L80 58 L110 44 L80 30 Z" fill="#d1a173"/>` +
    ln('M80 58 V90', W2, 2) + `<path d="M104 26 h26 l8 10 l-8 10 h-26 Z" fill="${A}"/><circle cx="110" cy="36" r="3" fill="#f4f6f5"/>`],
  [/профильн/i, () => ground(80, 64) + [[26, 60], [62, 60], [98, 60], [44, 30], [80, 30]].map(([x, y]) =>
    rect(x, y, 30, 26, M, 2) + rect(x + 5, y + 5, 20, 16, '#f4f6f5', 1)).join('') + ln('M130 86 H146 M130 82 V90 M146 82 V90', A, 2)],
  [/кругл.*труб|труба кругл/i, () => ground(80, 64) + [[50, 74], [80, 74], [110, 74], [65, 49], [95, 49], [80, 24]].map(([x, y]) =>
    `<circle cx="${x}" cy="${y}" r="13" fill="${M}"/><circle cx="${x}" cy="${y}" r="8" fill="#f4f6f5"/>`).join('')],
  [/лист/i, () => ground(80, 64) + [0, 1, 2, 3].map((i) => `<path d="M${28 + i * 4} ${76 - i * 9} L${96 + i * 4} ${62 - i * 9} L${136 + i * 2} ${70 - i * 9} L${68 + i * 2} ${84 - i * 9} Z" fill="${i === 3 ? '#9aa3ab' : i % 2 ? '#59616a' : M}"/>`).join('') +
    ln('M44 50 l18 -4', '#f4f6f5', 2)],
  [/^оборудование$|инструмент|станок/i, () => ground() + `<path d="M40 40 h56 a10 10 0 0 1 10 10 v4 a10 10 0 0 1 -10 10 h-56 Z" fill="${A}"/>` +
    `<path d="M58 64 h18 l-4 22 h-16 Z" fill="${M}"/>` + rect(106, 46, 12, 12, M, 2) + rect(118, 50, 22, 4, '#59616a', 1) + ln('M46 46 v12', '#5f8f6b', 3)],
  [/комплектующ|фурнитур/i, () => ground(80, 60) + `<path d="M30 34 h12 v40 h34 v12 h-46 Z" fill="${M}"/>` +
    `<circle cx="36" cy="46" r="3" fill="#f4f6f5"/><circle cx="36" cy="62" r="3" fill="#f4f6f5"/><circle cx="54" cy="80" r="3" fill="#f4f6f5"/>` +
    rect(92, 36, 18, 44, A, 2) + rect(112, 36, 18, 44, '#5f8f6b', 2) + rect(108, 34, 6, 48, M, 3) + `<circle cx="101" cy="48" r="2.5" fill="#f4f6f5"/><circle cx="121" cy="68" r="2.5" fill="#f4f6f5"/>`],
  [/невош|прочее|^благоустройство$/i, () => ground(80, 66) + `<g transform="translate(-22 10) scale(.8)">${bench()}</g>` + `<g transform="translate(36 6) scale(.9)">${bin(80)}</g>` +
    ln('M128 86 V52') + `<circle cx="128" cy="44" r="16" fill="${A}"/><circle cx="120" cy="52" r="10" fill="#5f8f6b"/>`],
  [/скам|мебел/i, bench],
  [/урн/i, () => bin()],
  [/велопарк/i, () => ground() + [34, 58, 82, 106].map((x) => ln(`M${x} 86 V58 a10 10 0 0 1 20 0 V86`)).join('') + ln('M28 86 H132', M, 3) +
    `<circle cx="56" cy="70" r="13" fill="none" stroke="${A}" stroke-width="3"/><circle cx="92" cy="70" r="13" fill="none" stroke="${A}" stroke-width="3"/>` + ln('M56 70 L70 58 H84 L92 70 M70 58 L74 70 H56', A, 2.5)],
  [/стенд|указат|вывеск/i, () => ground() + ln('M48 86 V30 M92 86 V30') + rect(40, 24, 60, 40, M, 3) + rect(45, 29, 50, 30, '#f4f6f5', 2) +
    rect(49, 33, 30, 4, A) + rect(49, 41, 42, 3, '#c9d0cc') + rect(49, 47, 36, 3, '#c9d0cc') + ln('M120 86 V34') + `<path d="M108 38 H136 L142 44 L136 50 H108 Z" fill="${A}"/>`],
  [/навес|беседк/i, () => ground(80, 66) + ln('M30 86 V44 M130 86 V44 M48 82 V48 M112 82 V48') + `<path d="M20 46 L80 22 L140 46 Z" fill="${M}"/>` + rect(22, 44, 116, 4, W) +
    rect(58, 64, 44, 4, W) + ln('M62 68 V82 M98 68 V82', M, 2.5)],
  [/огражд|забор/i, () => ground(80, 64) + ln('M20 86 V36 M80 86 V36 M140 86 V36', M, 4) + ln('M20 46 H140 M20 78 H140', M, 3) +
    [28, 36, 44, 52, 60, 68, 88, 96, 104, 112, 120, 128].map((x) => ln(`M${x} 46 V78`, W, 3)).join('')],
  [/стол|шахмат/i, () => ground(80, 64) + rect(46, 44, 68, 6, W) + ln('M54 50 V84 M106 50 V84') + rect(62, 40, 36, 4, '#2c3136') +
    rect(26, 62, 26, 5, W2) + rect(108, 62, 26, 5, W2) + ln('M30 67 V86 M48 67 V86 M112 67 V86 M130 67 V86', M, 2.5)],
  [/трибун/i, () => ground(80, 66) + `<path d="M18 86 V74 H48 V62 H78 V50 H108 V38 H142 V86 Z" fill="${M}"/>` +
    [[22, 70], [52, 58], [82, 46], [112, 34]].map(([x, y]) => [0, 9, 18].map((d) => rect(x + d, y, 7, 5, A, 1)).join('')).join('')],
  [/вазон|клумб/i, () => ground(80, 40) + `<path d="M50 54 H110 L104 86 H56 Z" fill="${M}"/>` + rect(46, 50, 68, 6, '#4a5159', 2) +
    `<circle cx="66" cy="40" r="10" fill="${A}"/><circle cx="82" cy="34" r="12" fill="#5f8f6b"/><circle cx="98" cy="41" r="9" fill="${A}"/>` +
    `<circle cx="70" cy="34" r="3" fill="#d9ab33"/><circle cx="90" cy="30" r="3" fill="#d9ab33"/>`],
  [/горк/i, () => ground() + ln('M40 86 V34 M60 86 V34') + [42, 52, 62, 72, 82].map((y) => ln(`M40 ${y} H60`, M, 2)).join('') + rect(36, 30, 28, 5, W) +
    `<path d="M60 32 C 90 34, 96 74, 130 80 L130 86 C 92 82, 86 42, 60 40 Z" fill="${A}"/>`],
  [/карусел/i, () => ground() + ln('M80 86 V30') + `<ellipse cx="80" cy="72" rx="48" ry="9" fill="${W}"/><ellipse cx="80" cy="70" rx="48" ry="9" fill="${W2}"/>` +
    ln('M44 70 Q60 40 80 30 Q100 40 116 70', A, 3) + ln('M62 70 V50 M98 70 V50', M, 2.5)],
  [/пружин/i, () => ground(80, 34) + ln('M74 86 q-8 -4 0 -8 q8 -4 0 -8 q-8 -4 0 -8 q8 -4 0 -8', M, 3) + rect(56, 50, 52, 9, A, 4) +
    `<path d="M100 50 q10 -22 -4 -26 q-8 -2 -10 8 L92 50 Z" fill="${A}"/>` + ln('M90 30 H104', M, 2.5) + rect(60, 44, 18, 6, W, 2)],
  [/балансир/i, () => ground() + `<path d="M70 86 L80 64 L90 86 Z" fill="${M}"/>` + `<g transform="rotate(-10 80 62)">${rect(22, 58, 116, 6, W)}${ln('M34 58 V48 M126 58 V48', A, 3)}</g>`],
  [/качел/i, () => ground(80, 64) + ln('M24 86 L44 26 L64 86 M136 86 L116 26 L96 86 M40 26 H120', M, 3.5) + ln('M64 28 V66 M82 28 V66 M88 28 V66 M106 28 V66', '#59616a', 1.5) +
    rect(60, 66, 26, 5, A, 2) + rect(84, 66, 26, 5, A, 2)],
  [/песочн/i, () => ground(80, 64) + `<path d="M24 66 L80 54 L136 66 L80 80 Z" fill="#e8d3a7"/>` + `<path d="M24 66 L80 80 V88 L24 74 Z" fill="${W}"/><path d="M136 66 L80 80 V88 L136 74 Z" fill="${W2}"/>` +
    `<path d="M80 54 L110 30 L132 58" fill="none" stroke="${A}" stroke-width="4"/>`],
  [/домик/i, () => ground() + rect(46, 46, 68, 40, W) + `<path d="M38 48 L80 18 L122 48 Z" fill="${A}"/>` + rect(70, 60, 20, 26, W2, 2) + rect(52, 56, 12, 12, '#f4f6f5', 2) + rect(96, 56, 12, 12, '#f4f6f5', 2)],
  [/сет|паутин/i, () => ground(80, 64) + ln('M22 86 L80 18 L138 86 M80 18 V86', M, 3) +
    [40, 54, 68].map((y) => { const k = (y - 18) / 68; return ln(`M${80 - 58 * k} ${y} L80 ${y + 6} L${80 + 58 * k} ${y}`, A, 2); }).join('') + ln('M51 52 L80 86 M109 52 L80 86', A, 1.8)],
  [/игров.*комплекс|детских игровых|игровой комплекс/i, () => ground(80, 66) + ln('M30 86 V40 M56 86 V40 M96 86 V30 M122 86 V30') +
    `<path d="M24 42 L43 22 L62 42 Z" fill="${A}"/><path d="M90 32 L109 10 L128 32 Z" fill="${A}"/>` + rect(28, 56, 30, 4, W) + rect(94, 50, 30, 4, W) +
    ln('M58 58 L94 52', W, 4) + `<path d="M122 50 C 140 54, 140 80, 150 84 L148 88 C 134 84, 134 60, 122 58 Z" fill="${A}"/>` + [64, 72, 80].map((y) => ln(`M30 ${y} H56`, M, 2)).join('')],
  [/игров.*оборуд/i, () => ground() + ln('M40 86 V26 M120 86 V26') + rect(44, 30, 72, 52, W, 3) +
    [0, 1, 2].map((i) => [0, 1, 2].map((j) => `<circle cx="${62 + i * 18}" cy="${42 + j * 15}" r="6" fill="${(i + j) % 2 ? A : M}"/>`).join('')).join('')],
  [/детск.*спорт/i, () => ground() + ln('M36 86 V26 M124 86 V26 M36 30 H124') + [40, 50, 60, 70, 80].map((y) => ln(`M36 ${y} H62`, M, 2)).join('') +
    ln('M80 30 V60 M100 30 V54', '#59616a', 1.5) + `<circle cx="80" cy="64" r="5" fill="none" stroke="${A}" stroke-width="3"/><circle cx="100" cy="58" r="5" fill="none" stroke="${A}" stroke-width="3"/>` + ln('M116 30 V80', W, 3)],
  [/полос|препятств/i, () => ground(80, 66) + rect(22, 34, 36, 52, W) + [44, 56, 68].map((y) => ln(`M22 ${y} H58`, W2, 2)).join('') +
    ln('M70 86 V64 M118 86 V64') + `<rect x="66" y="58" width="56" height="7" rx="3.5" fill="${W2}"/>` + ln('M132 86 V40 M146 86 V40', M, 3) + ln('M132 52 H146 M132 66 H146', A, 3)],
  [/воркаут/i, () => ground(80, 66) + ln('M24 86 V30 M60 86 V30 M100 86 V44 M136 86 V44 M24 32 H60 M100 46 H136', M, 3.5) +
    ln('M60 56 H100 M60 70 H100', A, 3.5) + [40, 52, 64, 76].map((y) => ln(`M100 ${y + 4} H136`, '#59616a', 1.8)).join('')],
  [/тренаж/i, () => ground() + ln('M50 86 V40 L70 30 M50 64 H96 L110 86 M96 64 L104 46') + rect(42, 60, 34, 7, A, 3) + rect(54, 34, 7, 26, A, 3) +
    rect(100, 40, 22, 8, W, 3) + ln('M70 30 V44 M64 44 H76', M, 2.5)],
  [/спорт/i, () => ground(80, 66) + ln('M18 86 V44 H66 V86', M, 3.5) + [26, 34, 42, 50, 58].map((x) => ln(`M${x} 46 V84`, '#c9d0cc', 1)).join('') +
    ln('M122 86 V28', M, 4) + rect(104, 22, 34, 22, '#f4f6f5', 2) + `<rect x="104" y="22" width="34" height="22" rx="2" fill="none" stroke="${M}" stroke-width="2"/>` +
    ln('M114 46 h14', A, 3) + `<circle cx="90" cy="76" r="9" fill="#d9822b"/>` + ln('M81 76 H99 M90 67 V85', '#8a4f16', 1.2)],
  [/благоустр/i, () => ground(80, 66) + `<g transform="translate(-22 10) scale(.8)">${bench()}</g>` + `<g transform="translate(36 6) scale(.9)">${bin(80)}</g>` +
    ln('M128 86 V52') + `<circle cx="128" cy="44" r="16" fill="${A}"/><circle cx="120" cy="52" r="10" fill="#5f8f6b"/>`],
];
const fallback = () => ground() + `<path d="M50 44 L80 30 L110 44 V76 L80 90 L50 76 Z" fill="${W}"/><path d="M50 44 L80 58 L110 44 L80 30 Z" fill="#d1a173"/><path d="M80 58 V90" stroke="${W2}" stroke-width="2"/>`;

/** SVG-разметка рисунка для категории по её названию. */
export function catArt(name) {
  const draw = (SETS.find(([re]) => re.test(name || '')) || [null, fallback])[1];
  return `<svg viewBox="10 12 140 82" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${draw()}</svg>`;
}

/* Иконки типов позиций (C039): плоские пиктограммы на прозрачном фоне — графит + один зелёный акцент, сетка 100×100.
 * Семейство (Болты, Гайки, Шайбы…) считает core/facets.js (TYPE_FAMILIES); тут — рисунок типа и запасной рисунок семейства. */
const I = M; // графит
const S2 = '#59616a'; // металл посветлее
const P = '#f4f6f5'; // «вырез» (как фон плитки)
const L = '#c9d0cc'; // блик
const hex = (cx, cy, r, c) => `<path d="${[0, 1, 2, 3, 4, 5].map((i) => `${i ? 'L' : 'M'}${(cx + r * Math.cos(Math.PI / 3 * i)).toFixed(1)} ${(cy + r * Math.sin(Math.PI / 3 * i)).toFixed(1)}`).join(' ')} Z" fill="${c}"/>`;
const ci = (cx, cy, r, c) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
const ring = (cx, cy, r, w, c, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="${w}" ${extra}/>`;
const pa = (d, c) => `<path d="${d}" fill="${c}"/>`;
/** Нарезка: косые чёрточки по стержню. */
const tl = (x, y1, y2, w, c = P) => { let s = ''; for (let y = y1; y < y2; y += 7) s += ln(`M${x - w} ${y + 5} L${x + w} ${y}`, c, 2.2); return s; };
const star = (cx, cy, r1, r2, n, c) => pa(Array.from({ length: n * 2 }, (_, i) => { const a = Math.PI / n * i; const r = i % 2 ? r2 : r1; return `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ') + ' Z', c);
const radial = (cx, cy, r1, r2, n, c, w = 2) => Array.from({ length: n }, (_, i) => { const a = Math.PI * 2 / n * i; return ln(`M${(cx + r1 * Math.cos(a)).toFixed(1)} ${(cy + r1 * Math.sin(a)).toFixed(1)} L${(cx + r2 * Math.cos(a)).toFixed(1)} ${(cy + r2 * Math.sin(a)).toFixed(1)}`, c, w); }).join('');
const pipeShine = ln('M20 38 A32 32 0 0 1 36 20', L, 3.4);

/** key → [подпись, рисунок]. */
const ICONS = {
  bolt: ['Болт', () => rect(30, 8, 40, 18, I, 3) + ln('M36 14 H64', P, 2) + rect(41, 26, 18, 62, I, 1) + pa('M41 88 L45 95 H55 L59 88 Z', I) + tl(50, 32, 86, 9)],
  boltFurn: ['Болт мебельный', () => pa('M22 32 A28 26 0 0 1 78 32 Z', I) + rect(40, 32, 20, 10, A, 0) + rect(42, 42, 16, 46, I, 1) + pa('M42 88 L46 95 H54 L58 88 Z', I) + tl(50, 46, 86, 8) + ln('M34 22 Q42 14 52 13', P, 2)],
  boltAnchor: ['Анкерный болт', () => rect(32, 6, 36, 14, I, 3) + rect(45, 20, 10, 70, I, 1) + rect(35, 38, 30, 38, A, 3) + ln('M42 44 V76 M50 44 V76 M58 44 V76', P, 1.8) + pa('M45 90 L48 96 H52 L55 90 Z', I)],
  nut: ['Гайка', () => hex(50, 50, 42, I) + ci(50, 50, 18, P) + ring(50, 50, 13, 1.8, L)],
  nutCap: ['Гайка колпачковая', () => pa('M24 88 V42 A26 26 0 0 1 76 42 V88 Z', I) + ln('M41 52 V88 M59 52 V88', P, 2) + ln('M32 40 Q36 26 50 22', L, 3)],
  nutInsert: ['Гайка со вставкой', () => hex(50, 50, 42, I) + ci(50, 50, 24, A) + ci(50, 50, 13, P)],
  nutRym: ['Рым-гайка', () => ring(50, 30, 20, 9, I) + rect(30, 54, 40, 14, I, 3) + rect(40, 68, 20, 22, I, 1) + tl(50, 70, 90, 8)],
  washer: ['Шайба плоская', () => ci(50, 50, 42, I) + ci(50, 50, 17, P)],
  washerBig: ['Шайба увеличенная', () => ci(50, 50, 46, I) + ci(50, 50, 11, P) + ring(50, 50, 38, 1.8, L)],
  washerSpring: ['Шайба гроверная', () => ring(50, 50, 30, 20, I, 'stroke-dasharray="165 24" transform="rotate(-80 50 50)"') + ln('M68 18 L82 14', A, 3.4) + ln('M70 26 L84 24', A, 3.4)],
  screw: ['Саморез', () => rect(26, 8, 48, 12, I, 6) + ln('M50 11 V17 M44 14 H56', P, 2.2) + pa('M41 20 H59 V70 L50 95 L41 70 Z', I) + tl(50, 24, 66, 9)],
  woodScrew: ['Шуруп', () => pa('M24 8 H76 L58 26 H42 Z', I) + ln('M36 13 H64', P, 2.4) + pa('M42 26 H58 L53 92 H47 Z', I) + [34, 46, 58, 70, 82].map((y) => ln(`M33 ${y + 6} L67 ${y}`, I, 3.4)).join('')],
  vint: ['Винт', () => rect(28, 8, 44, 18, I, 4) + ln('M33 17 H67', P, 3.4) + rect(40, 26, 20, 60, I, 1) + tl(50, 32, 84, 9)],
  ringScrew: ['Винт-кольцо', () => ring(50, 24, 17, 8, I) + rect(43, 42, 14, 48, I, 1) + tl(50, 46, 88, 8)],
  stud: ['Шпилька', () => rect(43, 5, 14, 90, I, 3) + tl(50, 9, 92, 8) + rect(35, 40, 30, 12, A, 3)],
  rivet: ['Заклёпка', () => ln('M50 3 V56', A, 5) + rect(24, 14, 52, 10, I, 5) + rect(37, 24, 26, 46, I, 1) + rect(30, 70, 40, 10, I, 5)],
  rivetHex: ['Заклёпка шестигранная', () => hex(50, 24, 24, I) + rect(40, 36, 20, 44, I, 1) + rect(32, 80, 36, 10, I, 5) + ci(50, 24, 8, P)],
  pipeRound: ['Труба круглая', () => ci(50, 50, 42, I) + ci(50, 50, 29, P)],
  pipeRoundSS: ['Труба круглая нержавеющая', () => ci(50, 50, 42, S2) + ci(50, 50, 29, P) + pipeShine + ln('M27 62 A28 28 0 0 0 40 74', L, 3.4)],
  pipeProf: ['Труба профильная', () => rect(8, 20, 84, 60, I, 8) + rect(24, 34, 52, 32, P, 3)],
  pipeProfSS: ['Труба профильная нержавеющая', () => rect(8, 20, 84, 60, S2, 8) + rect(24, 34, 52, 32, P, 3) + ln('M16 34 V26 Q16 26 24 26', L, 3.4)],
  sheet: ['Лист', () => [0, 1, 2].map((i) => pa(`M8 ${72 - i * 13} L46 ${54 - i * 13} L92 ${66 - i * 13} L52 ${86 - i * 13} Z`, i === 2 ? S2 : I)).join('') + ln('M26 38 L40 34', P, 2.6)],
  sheetPlate: ['Лист рифлёный', () => pa('M8 60 L46 38 L92 54 L52 80 Z', I) + [[34, 56], [48, 62], [62, 62], [44, 48], [58, 52], [70, 56]].map(([x, y]) => ln(`M${x - 4} ${y + 2} L${x + 4} ${y - 2}`, L, 3)).join('')],
  angle: ['Профиль, уголок', () => pa('M18 12 H40 V60 H84 V80 H18 Z', I) + ln('M26 20 V70', P, 2)],
  mesh: ['Сетка', () => [10, 30, 50, 70, 90].map((v) => ln(`M${v} 10 V90 M10 ${v} H90`, I, 4)).join('')],
  drill: ['Сверло', () => rect(41, 4, 18, 24, S2, 3) + pa('M36 28 H64 L50 96 Z', I) + [38, 50, 62, 74].map((y) => ln(`M${42 - (y - 38) / 8} ${y} L${58 + (y - 38) / 8 - 6} ${y - 6}`, P, 3)).join('')],
  bit: ['Бита', () => rect(34, 6, 32, 12, A, 3) + rect(38, 18, 24, 50, I, 2) + pa('M38 68 H62 L56 90 H44 Z', I) + ln('M44 24 V62 M56 24 V62', P, 1.8)],
  mill: ['Фреза', () => rect(42, 4, 16, 28, S2, 3) + rect(32, 32, 36, 58, I, 4) + [40, 52, 64, 76].map((y) => ln(`M32 ${y + 8} L68 ${y - 4}`, P, 3.2)).join('')],
  burr: ['Борфреза', () => rect(46, 4, 8, 42, S2, 2) + `<ellipse cx="50" cy="68" rx="19" ry="27" fill="${I}"/>` + ln('M36 52 L64 84 M36 66 L60 92 M44 46 L66 70 M64 52 L36 84', P, 2.2)],
  collet: ['Цанга', () => rect(24, 8, 52, 16, I, 3) + rect(32, 24, 36, 64, I, 4) + ln('M40 40 V88 M50 40 V88 M60 40 V88', P, 2.2) + rect(40, 24, 20, 10, A, 2)],
  disc: ['Диск, круг отрезной', () => ci(50, 50, 44, I) + ci(50, 50, 11, P) + ring(50, 50, 30, 1.8, L) + ln('M20 30 A34 34 0 0 1 36 18', L, 3)],
  saw: ['Диск пильный', () => star(50, 50, 46, 38, 18, I) + ci(50, 50, 12, P) + ring(50, 50, 26, 1.8, L)],
  flap: ['Круг лепестковый', () => ci(50, 50, 44, I) + radial(50, 50, 14, 43, 18, P, 2.6) + ci(50, 50, 12, P)],
  blade: ['Лезвие, нож', () => pa('M8 66 L84 28 L92 44 L16 80 Z', I) + ln('M30 64 L70 44', P, 2.2) + ci(24, 70, 3, P) + rect(80, 24, 14, 24, A, 3)],
  hammer: ['Молоток, инструмент', () => rect(44, 34, 12, 58, W, 4) + rect(18, 10, 60, 24, I, 4) + pa('M78 14 L94 24 L78 30 Z', I) + ln('M26 17 H60', L, 3)],
  rule: ['Рулетка', () => rect(10, 22, 60, 56, I, 14) + ci(40, 50, 17, P) + ci(40, 50, 6, I) + rect(66, 54, 28, 8, A, 2)],
  caliper: ['Штангенциркуль, микрометр', () => rect(6, 38, 88, 12, I, 3) + rect(6, 38, 12, 46, I, 3) + rect(42, 38, 16, 30, A, 3) + [26, 34, 70, 78, 86].map((x) => ln(`M${x} 44 V50`, P, 1.8)).join('') + rect(42, 50, 6, 36, I, 1)],
  level: ['Уровень', () => rect(6, 32, 88, 36, I, 6) + rect(34, 42, 32, 16, P, 8) + ci(50, 50, 5, A) + ln('M34 50 H29 M66 50 H71', P, 2)],
  scale: ['Весы', () => rect(10, 64, 80, 22, I, 6) + ci(50, 36, 26, I) + ci(50, 36, 18, P) + ln('M50 36 L60 24', A, 3.4)],
  gloves: ['Перчатки', () => rect(30, 48, 42, 40, I, 12) + rect(30, 16, 9, 38, I, 4.5) + rect(41, 8, 9, 46, I, 4.5) + rect(52, 8, 9, 46, I, 4.5) + rect(63, 16, 9, 38, I, 4.5) + ln('M32 70 L12 52', I, 12) + rect(30, 78, 42, 10, A, 4)],
  mask: ['Маска сварщика', () => pa('M20 52 A30 30 0 0 1 80 52 V72 Q50 92 20 72 Z', I) + rect(30, 46, 40, 14, P, 3) + ln('M34 53 H66', A, 3)],
  suit: ['Костюм, пелерина', () => pa('M34 10 L8 28 L20 46 L30 40 V90 H70 V40 L80 46 L92 28 L66 10 Q50 24 34 10 Z', I) + ln('M50 24 V90', P, 2) + ci(44, 50, 2, P) + ci(44, 62, 2, P)],
  spray: ['Краска-спрей', () => rect(32, 32, 34, 58, I, 6) + rect(40, 16, 18, 16, A, 3) + rect(46, 6, 6, 10, I, 2) + rect(32, 50, 34, 20, P, 2) + ln('M38 60 H60', I, 3) + ci(14, 16, 3, A) + ci(8, 28, 3, A) + ci(20, 30, 3, A)],
  marker: ['Маркер', () => rect(36, 36, 28, 52, I, 5) + pa('M40 36 H60 L53 10 H47 Z', A) + rect(36, 54, 28, 16, P, 2) + ln('M42 62 H58', I, 3)],
  glue: ['Клей', () => pa('M32 12 H68 L62 76 H38 Z', I) + rect(38, 76, 24, 14, A, 3) + ln('M42 28 L45 62', P, 3)],
  grease: ['Смазка', () => rect(20, 40, 60, 46, I, 6) + rect(16, 26, 68, 16, A, 3) + rect(30, 54, 40, 18, P, 2) + ln('M36 63 H64', I, 3)],
  putty: ['Шпаклёвка', () => pa('M20 32 H80 L74 90 H26 Z', I) + rect(16, 20, 68, 14, A, 3) + ln('M30 48 V80 M50 48 V80 M70 48 V80', P, 2.2)],
  tapeRoll: ['Скотч, лента', () => ring(50, 50, 30, 22, I) + pa('M80 60 L94 88 L72 84 Z', A)],
  film: ['Плёнка, рулон', () => `<ellipse cx="50" cy="28" rx="30" ry="12" fill="${S2}"/>` + pa('M20 28 V72 A30 12 0 0 0 80 72 V28 A30 12 0 0 1 20 28 Z', I) + `<ellipse cx="50" cy="28" rx="10" ry="4" fill="${P}"/>`],
  bearing: ['Подшипник', () => ci(50, 50, 44, I) + ci(50, 50, 32, P) + Array.from({ length: 8 }, (_, i) => ci((50 + 25.5 * Math.cos(Math.PI / 4 * i)).toFixed(1), (50 + 25.5 * Math.sin(Math.PI / 4 * i)).toFixed(1), 6.5, I)).join('') + ci(50, 50, 19, I) + ci(50, 50, 9, P)],
  rail: ['Направляющая, вал', () => rect(6, 56, 88, 14, I, 3) + rect(28, 32, 44, 32, A, 5) + ci(38, 48, 4, P) + ci(62, 48, 4, P)],
  spring: ['Пружина', () => ln('M26 14 L74 22 L26 32 L74 40 L26 50 L74 58 L26 68 L74 76 L26 86', I, 7)],
  wheel: ['Колесо', () => ci(50, 50, 44, I) + ci(50, 50, 28, P) + ci(50, 50, 10, I) + radial(50, 50, 10, 28, 6, I, 4)],
  bush: ['Втулка', () => pa('M22 30 V72 A28 12 0 0 0 78 72 V30 Z', I) + `<ellipse cx="50" cy="30" rx="28" ry="12" fill="${S2}"/><ellipse cx="50" cy="30" rx="13" ry="5" fill="${P}"/>` + ln('M30 44 V72', L, 3)],
  shackle: ['Скоба, такелаж', () => ln('M30 18 V58 A20 20 0 0 0 70 58 V18', I, 10) + rect(18, 10, 64, 12, A, 4)],
  swivel: ['Вертлюг', () => ring(50, 22, 14, 8, I) + rect(40, 36, 20, 28, S2, 3) + rect(36, 48, 28, 6, A, 2) + ring(50, 78, 14, 8, I)],
  chain: ['Цепь', () => `<rect x="9" y="41" width="32" height="18" rx="9" fill="none" stroke="${I}" stroke-width="7"/>` + rect(38, 43, 24, 14, I, 7) + `<rect x="59" y="41" width="32" height="18" rx="9" fill="none" stroke="${I}" stroke-width="7"/>`],
  clamp: ['Хомут', () => ring(50, 58, 30, 9, I) + rect(40, 8, 20, 24, A, 3) + ci(50, 20, 4, P)],
  zap: ['Электрика', () => pa('M58 4 L22 54 H46 L38 96 L78 42 H54 Z', A)],
  neon: ['Гибкий неон', () => ln('M8 62 Q28 20 50 52 T92 38', I, 15) + ln('M8 62 Q28 20 50 52 T92 38', A, 8)],
  router: ['Роутер', () => rect(10, 56, 80, 28, I, 6) + rect(22, 16, 7, 42, I, 3) + rect(71, 16, 7, 42, I, 3) + ci(26, 70, 3.4, A) + ci(38, 70, 3.4, A) + ln('M56 70 H78', P, 3)],
  ups: ['ИБП, блок', () => rect(16, 12, 68, 76, I, 8) + rect(26, 22, 48, 20, P, 3) + pa('M52 24 L38 34 H48 L44 40 L58 30 H48 Z', A) + ci(34, 62, 4, P) + ci(50, 62, 4, P) + ci(66, 62, 4, P)],
  battery: ['Батарейка', () => rect(28, 22, 44, 68, I, 6) + rect(40, 10, 20, 13, A, 2) + rect(28, 46, 44, 14, A, 0) + ln('M50 28 V40', P, 3)],
  plug: ['Разъём', () => rect(8, 36, 38, 28, I, 5) + rect(54, 36, 38, 28, A, 5) + ln('M46 44 H54 M46 56 H54', S2, 4) + ci(22, 50, 3, P) + ci(78, 50, 3, P)],
  swing: ['Качели', () => ln('M26 8 L38 54 M74 8 L62 54', I, 3) + `<ellipse cx="50" cy="72" rx="32" ry="13" fill="none" stroke="${W2}" stroke-width="9"/>`],
  seat: ['Сиденье', () => ln('M24 8 V52 M76 8 V52', I, 3) + rect(10, 50, 80, 14, W, 6) + ln('M18 57 H82', W2, 2)],
  pallet: ['Поддон', () => rect(8, 22, 84, 12, W, 1) + rect(8, 44, 84, 10, W2, 1) + rect(8, 64, 84, 10, W, 1) + rect(10, 34, 14, 10, I, 0) + rect(43, 34, 14, 10, I, 0) + rect(76, 34, 14, 10, I, 0) + rect(10, 54, 14, 10, I, 0) + rect(43, 54, 14, 10, I, 0) + rect(76, 54, 14, 10, I, 0)],
  cap: ['Заглушка', () => rect(14, 26, 72, 14, I, 5) + pa('M24 40 H76 L68 76 H32 Z', I) + rect(38, 76, 24, 12, A, 3)],
  box: ['Прочее', () => pa('M50 8 L90 26 L50 44 L10 26 Z', S2) + pa('M50 44 L90 26 V70 L50 92 Z', I) + pa('M50 44 L10 26 V70 L50 92 Z', '#4a5159') + ln('M30 18 L70 36', P, 2.4)],
};
/** Тип → свой рисунок (первое совпадение сверху вниз; тип приходит как есть, регистр не важен). */
const TYPE_OWN = [
  [/вертлюг/i, 'swivel'], [/шакле|[cс]коб|такелаж/i, 'shackle'], [/[cс]труб/i, 'clamp'],
  [/анкер/i, 'boltAnchor'], [/мебельн/i, 'boltFurn'], [/болт/i, 'bolt'],
  [/колпачк/i, 'nutCap'], [/вставк/i, 'nutInsert'], [/рым/i, 'nutRym'], [/гайк/i, 'nut'],
  [/гровер/i, 'washerSpring'], [/увеличен/i, 'washerBig'], [/шайб/i, 'washer'],
  [/саморез/i, 'screw'], [/шуруп/i, 'woodScrew'], [/винт-кольц/i, 'ringScrew'], [/винт/i, 'vint'], [/шпильк/i, 'stud'],
  [/шестигр.*закл|закл.*шестигр/i, 'rivetHex'], [/закл[её]пк/i, 'rivet'],
  [/^труб.*нерж.*проф|^труб.*проф.*нерж/i, 'pipeProfSS'], [/^труб.*нерж/i, 'pipeRoundSS'], [/^труб.*проф/i, 'pipeProf'], [/^труб/i, 'pipeRound'],
  [/рифл/i, 'sheetPlate'], [/^лист/i, 'sheet'], [/^профиль/i, 'angle'], [/сетк/i, 'mesh'],
  [/сверл/i, 'drill'], [/борфрез/i, 'burr'], [/фрез/i, 'mill'], [/^бит[аы]?(\s|$)/i, 'bit'], [/цанг/i, 'collet'],
  [/пильн/i, 'saw'], [/лепестк/i, 'flap'], [/диск|^круг/i, 'disc'], [/лезви|^нож/i, 'blade'],
  [/молот/i, 'hammer'], [/рулетк/i, 'rule'], [/микрометр|штангенц/i, 'caliper'], [/уровень/i, 'level'], [/весы/i, 'scale'],
  [/перчатк/i, 'gloves'], [/маска/i, 'mask'], [/костюм|пелерин/i, 'suit'],
  [/маркер/i, 'marker'], [/спрей|краск/i, 'spray'], [/клей/i, 'glue'], [/смазк/i, 'grease'], [/шпаклев|шпаклёв/i, 'putty'],
  [/скотч|лент/i, 'tapeRoll'], [/стрейч|рулоны|пл[её]нк|вспен|пэт/i, 'film'],
  [/подшипник/i, 'bearing'], [/^вал(\s|$)|модуль линейн/i, 'rail'], [/пружин/i, 'spring'], [/колес/i, 'wheel'], [/втулк/i, 'bush'],
  [/цеп/i, 'chain'], [/шакле|[cс]коб/i, 'shackle'], [/вертлюг/i, 'swivel'], [/х[ао]мут/i, 'clamp'],
  [/неон/i, 'neon'], [/роутер|wi-?fi/i, 'router'], [/ибп|блок/i, 'ups'], [/марганц/i, 'battery'], [/разъ[её]м/i, 'plug'],
  [/качел/i, 'swing'], [/сиден|сидень/i, 'seat'], [/поддон/i, 'pallet'], [/заглушк/i, 'cap'],
];
/** Запасной рисунок семейства (id семейства — core/facets.js TYPE_FAMILIES). */
const FAMILY_ICON = { bolt: 'bolt', nut: 'nut', washer: 'washer', screw: 'woodScrew', vint: 'vint', rivet: 'rivet', rig: 'shackle', pipe: 'pipeRound', sheet: 'sheet', cut: 'drill', tool: 'hammer', ppe: 'gloves', chem: 'spray', bearing: 'bearing', elec: 'zap', play: 'swing', other: 'box' };

/** Какой рисунок у типа: { own: ключ своего | null, family: ключ семейства, key: итоговый }. */
export function typeIconKind(type) {
  const t = String(type || '').trim();
  const own = TYPE_OWN.find(([re]) => re.test(t))?.[1] || null;
  const family = FAMILY_ICON[familyOf(t).id] || 'box';
  return { own, family, key: own || family };
}
/** SVG-разметка рисунка для типа позиции («Болт», «Гайка шестигранная»): свой → семейства → общий. */
export function typeArt(type, _categoryName) {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${ICONS[typeIconKind(type).key][1]()}</svg>`;
}
/** Все иконки с подписями (витрина #kit «Иконки типов»). */
export const typeIconList = () => Object.entries(ICONS).map(([key, [label, draw]]) => ({ key, label, svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${draw()}</svg>` }));
