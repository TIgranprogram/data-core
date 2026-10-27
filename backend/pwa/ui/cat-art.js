/*
 * Рисунки категорий «Продукции» (первая страница — плитки разделов и групп).
 * Один стиль: графитовый металл, дерево, один зелёный акцент; фон — белый «paper» в обеих темах.
 * Подбор по названию категории (первое совпадение сверху вниз); нет совпадения — общий рисунок.
 */
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
