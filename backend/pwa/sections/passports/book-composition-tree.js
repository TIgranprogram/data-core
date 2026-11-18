/** Лист книжки использует серверный compositionSheet — ту же проекцию, что PDF.
 * Черновик получает её через GET паспорта; выпущенный документ использует свой снимок.
 */
import { h } from '../../core/dom.js';
import { table as kitTable } from '../../ui/kit/index.js';

const numText = (v) => String(v ?? '').replace('.', ',');

function flatRows(nodes, depth, acc) {
  for (const n of nodes) {
    const pad = depth ? '— '.repeat(Math.min(depth, 8)) : '';
    const label = n.label || n.name || 'Без имени';
    const name = pad + label + (!n.label && n.article ? ' · ' + n.article : '');
    acc.push([n.word || '', name, numText(n.qty) + ' ' + (n.unit || 'шт')]);
    if (n.children?.length) flatRows(n.children, depth + 1, acc);
  }
  return acc;
}

/** Таблица состава на листе без повторного раскрытия сырья и вложенных изделий. */
export function compositionSheet(lines) {
  const rows = flatRows(lines || [], 0, []);
  if (!rows.length) return null;
  return h('div', { class: 'bk-p' }, kitTable({
    label: 'Состав изделия',
    columns: [{ label: 'Что' }, { label: 'Наименование' }, { label: 'Количество', num: true }],
    rows: rows.map((cells) => ({ cells })),
  }));
}
