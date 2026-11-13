import { session } from '../core/api.js';
import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { modal, stack, table, guide, hint } from '../ui/kit/index.js';

export function compareCatalogRows(rows) {
  if (rows.length !== 2) return;
  const fields = [
    ['Название', (r) => r.name],
    ['Поставщик', (r) => r.supplierName],
    ['Артикул', (r) => r.article?.startsWith('manual:') ? '' : r.article],
    ['Цвет', (r) => r.color],
    ['Единица измерения', (r) => r.unit],
    ['Позиция склада', (r) => [r.materialName, r.materialArticle].filter(Boolean).join(' · '), (r) => r.materialId],
    ['Цена', (r) => r.priceHint == null ? '' : money(r.priceHint), (r) => r.priceHint, true],
    ['Примечание', (r) => r.note],
  ].filter(([, , , moneyOnly]) => !moneyOnly || session.canMoney);
  const values = h('div');
  const render = (onlyDifferent) => {
    const visible = fields.filter(([, show, key = show]) => !onlyDifferent
      || String(key(rows[0]) ?? '').trim() !== String(key(rows[1]) ?? '').trim());
    values.replaceChildren(visible.length ? table({
      label: 'Сравнение позиций каталога',
      columns: [{ label: 'Свойство', wrap: true }, { label: 'Первая позиция', wrap: true }, { label: 'Вторая позиция', wrap: true }],
      rows: visible.map(([label, show]) => ({ cells: [label, ...rows.map((r) => show(r) || '—')] })),
    }) : hint('По показанным свойствам различий нет.'));
  };
  render(false);
  return modal({ title: 'Сравнение позиций', wide: true, okText: 'Закрыть', cancelText: '',
    body: stack(guide.toggle({ label: 'Показать только различия', onChange: render }), values) });
}
