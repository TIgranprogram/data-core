import { h } from '../core/dom.js';
import { guide, table } from '../ui/kit/index.js';

/**
 * «?» → «Как устроена продукция» (просьба пользователя 2026-11-09): изделие в центре, вокруг — из чего состоит,
 * слева — откуда приходят данные, справа — куда уходят (паспорт, техописание, производство, закупка, заказы).
 * ♻ — переиспользуется: запись одна на весь каталог, изделия на неё ссылаются. Наведите на блок — подсветятся его связи.
 * Источник правды по связям — docs/crew/C057-pdm-import/DECISIONS.md и TZ C055/C056; меняется модель — править здесь.
 */
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };

// tone: где живёт — src (откуда), core (изделие), part (состав), out (результат)
const TONE = {
  src: ['var(--neutral-soft)', 'var(--border-strong)'],
  core: ['var(--primary-soft)', 'var(--primary)'],
  part: ['var(--info-soft)', 'var(--info)'],
  out: ['var(--gold-soft)', 'var(--gold)'],
};
const B = [
  // источники
  { id: 'pdm', x: 20, y: 110, w: 230, hh: 120, tone: 'src', t: 'PDM (SolidWorks)', l: ['обозначения, дерево сборки,', 'размеры, масса, сортамент,', 'чертежи PDF и DXF'], go: '' },
  { id: 'dict', x: 20, y: 330, w: 230, hh: 100, tone: 'src', t: 'Справочники паспорта', l: ['категории, тексты, элементы,', 'способы установки, части'], go: '#dicts' },
  { id: 'stock', x: 20, y: 520, w: 230, hh: 110, tone: 'src', t: 'Склад и поставщики', l: ['форматы листа и трубы,', 'остатки, цены закупки'], go: '#stock' },
  // изделие и состав
  { id: 'prod', x: 430, y: 300, w: 240, hh: 120, tone: 'core', t: 'ИЗДЕЛИЕ', l: ['артикул = обозначение PDM,', 'название, фото, категория,', 'габариты, масса, цвет'], go: '#products', big: true },
  { id: 'work', x: 440, y: 30, w: 220, hh: 80, tone: 'part', t: 'Работы', l: ['виды работ и маршрут'], go: '#products' },
  { id: 'mod', x: 290, y: 150, w: 200, hh: 90, tone: 'part', t: 'Модули ♻', l: ['узлы из деталей и метизов;', 'общие — для многих изделий'] },
  { id: 'part', x: 610, y: 150, w: 200, hh: 90, tone: 'part', t: 'Детали ♻', l: ['номенклатура «деталь»:', 'размер, заготовка, RAL'] },
  { id: 'raw', x: 290, y: 490, w: 200, hh: 90, tone: 'part', t: 'Сырьё-сортамент ♻', l: ['«Лист 4 мм Ст3» в м²,', '«Труба 25×2,8» в м'] },
  { id: 'hw', x: 610, y: 490, w: 200, hh: 90, tone: 'part', t: 'Метизы и покупные ♻', l: ['номенклатура склада,', 'артикул склада + код PDM'], go: '#suppliercatalog' },
  { id: 'files', x: 440, y: 610, w: 220, hh: 80, tone: 'part', t: 'Файлы ♻', l: ['PDF и DXF с версиями'] },
  // куда уходит
  { id: 'pass', x: 860, y: 30, w: 220, hh: 100, tone: 'out', t: 'Паспорт', l: ['категория, тексты, части,', 'материалы, рисунки'], go: '#passports' },
  { id: 'tech', x: 860, y: 160, w: 220, hh: 100, tone: 'out', t: 'Техописание', l: ['часть → материал →', 'размеры'], go: '#products' },
  { id: 'make', x: 860, y: 290, w: 220, hh: 100, tone: 'out', t: 'Производство', l: ['модули, работы,', 'развёртки DXF'], go: '#work' },
  { id: 'buy', x: 860, y: 420, w: 220, hh: 100, tone: 'out', t: 'Что купить', l: ['сырьё в листах и хлыстах,', 'метизы − остатки склада'], go: '#supply' },
  { id: 'order', x: 860, y: 550, w: 220, hh: 100, tone: 'out', t: 'Заказы и КП', l: ['изделие, цена,', 'себестоимость по составу'], go: '#salesorders' },
];
// связи: [откуда, куда, вид] — in: данные приходят; has: входит в состав; out: уходит в результат
const E = [
  ['pdm', 'prod', 'in'], ['pdm', 'mod', 'in'], ['pdm', 'files', 'in'], ['stock', 'raw', 'in'], ['stock', 'hw', 'in'], ['dict', 'pass', 'in'],
  ['mod', 'prod', 'has'], ['part', 'prod', 'has'], ['work', 'prod', 'has'], ['files', 'prod', 'has'], ['part', 'mod', 'has'], ['hw', 'mod', 'has'], ['raw', 'part', 'has'],
  ['prod', 'pass', 'out'], ['part', 'pass', 'out'], ['files', 'pass', 'out'], ['part', 'tech', 'out'], ['raw', 'tech', 'out'],
  ['mod', 'make', 'out'], ['work', 'make', 'out'], ['files', 'make', 'out'], ['raw', 'buy', 'out'], ['hw', 'buy', 'out'], ['prod', 'order', 'out'],
];
const EDGE = { in: 'var(--muted)', has: 'var(--info)', out: 'var(--gold-deep)' };
const byId = new Map(B.map((b) => [b.id, b]));
const mid = (b) => [b.x + b.w / 2, b.y + b.hh / 2];

/** Точка на краю блока в сторону другой точки. */
function edgePoint(b, tx, ty) {
  const [cx, cy] = mid(b); const dx = tx - cx; const dy = ty - cy;
  const k = Math.min(Math.abs((b.w / 2) / (dx || 1e-9)), Math.abs((b.hh / 2) / (dy || 1e-9)));
  return [cx + dx * k, cy + dy * k];
}

function diagram() {
  const svg = s('svg', { viewBox: '0 0 1100 710', role: 'img', 'aria-label': 'Схема: из чего состоит изделие и куда уходят его данные' });
  svg.setAttribute('width', '100%'); // схема ужимается по ширине; на телефоне то же самое — таблицей ниже
  svg.append(s('defs', {}, ...Object.entries(EDGE).map(([k, c]) => s('marker', { id: `pm-${k}`, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' },
    s('path', { d: 'M0,0 L10,5 L0,10 z', fill: c })))));
  const lines = E.map(([a, b, k]) => {
    const A = byId.get(a); const Bb = byId.get(b); const [bx, by] = mid(Bb); const [ax, ay] = mid(A);
    const [x1, y1] = edgePoint(A, bx, by); const [x2, y2] = edgePoint(Bb, ax, ay);
    const p = s('path', { d: `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`, fill: 'none', stroke: EDGE[k], 'stroke-width': k === 'has' ? '2.2' : '1.6',
      'stroke-dasharray': k === 'in' ? '5 4' : '', 'marker-end': `url(#pm-${k})`, opacity: '.55' });
    p.dataset.a = a; p.dataset.b = b; return p;
  });
  svg.append(...lines);
  const light = (id) => lines.forEach((l) => l.setAttribute('opacity', !id ? '.55' : (l.dataset.a === id || l.dataset.b === id) ? '1' : '.1'));
  for (const b of B) {
    const [fill, stroke] = TONE[b.tone];
    const g = s('g', { tabindex: '0', ...(b.go ? { cursor: 'pointer' } : {}) },
      s('rect', { x: b.x, y: b.y, width: b.w, height: b.hh, rx: '10', fill, stroke, 'stroke-width': b.big ? '2.5' : '1.4' }),
      s('text', { x: b.x + 12, y: b.y + 24, fill: 'var(--heading)', 'font-size': b.big ? '17' : '15', 'font-weight': '700' }, b.t),
      ...b.l.map((t, i) => s('text', { x: b.x + 12, y: b.y + 46 + i * 18, fill: 'var(--muted)', 'font-size': '13' }, t)));
    g.addEventListener('mouseenter', () => light(b.id)); g.addEventListener('focus', () => light(b.id));
    g.addEventListener('mouseleave', () => light(null)); g.addEventListener('blur', () => light(null));
    if (b.go) g.addEventListener('click', () => { location.hash = b.go; });
    svg.append(g);
  }
  return svg;
}

// «Где живёт и где править» — то же словами (и для телефона)
const ROWS = [
  ['Изделие', 'Продукция', 'Продукция → карточка изделия', 'нет — у изделия своё', 'паспорт, заказы, «Что купить»'],
  ['Модуль', 'Модули (общая таблица)', 'загрузка из PDM; карточка модуля', '♻ да — общие модули', 'производство, состав изделий'],
  ['Деталь', 'Номенклатура, вид «деталь»', 'загрузка из PDM; название — менеджер', '♻ да — общие детали', 'паспорт (части), техописание, производство'],
  ['Сырьё-сортамент', 'Номенклатура, вид «сырьё»', 'склад → форматы; загрузка из PDM', '♻ да — один на все детали', 'техописание, «Что купить»'],
  ['Метизы, покупные', 'Номенклатура склада', 'Каталог номенклатуры', '♻ да — артикул склада + код PDM', 'модули, «Что купить»'],
  ['Работы', 'Виды работ', 'Продукция → «Состав и работы»', '♻ справочник видов', 'производство, себестоимость'],
  ['Файлы PDF / DXF', 'Файлы PDM (с версиями)', 'только загрузка из PDM', '♻ по обозначению', 'паспорт (рисунки), производство (развёртки)'],
  ['Тексты, категории, части паспорта', 'Справочники', 'Справочники → «Паспорта»', '♻ на всю категорию', 'паспорт'],
];

export function productMapCat() {
  const legend = h('p', { class: 'muted small' },
    'Серое — откуда приходят данные · синее — из чего состоит изделие · жёлтое — куда уходит. ',
    'Пунктир — данные приходят, сплошная — входит в состав, золотая — уходит в документ или работу. ',
    '♻ — запись одна на весь каталог: правите в одном месте — меняется во всех изделиях. Наведите на блок — подсветятся его связи; нажмите — откроется раздел.');
  const tbl = table({ label: 'Где живёт и где править', columns: ['Что', 'Где живёт', 'Где править', 'Переиспользуется', 'Куда уходит'].map((label) => ({ label, wrap: true })),
    rows: ROWS.map((r) => ({ cells: r })) });
  return guide.cat({ title: 'Как устроена продукция', what: 'Из чего состоит изделие, что переиспользуется и куда уходит — в паспорт, работу, закупку', count: 'схема', name: 'hp-product',
    body: [legend, diagram(), h('h3', null, 'Где живёт и где править'), tbl] });
}
