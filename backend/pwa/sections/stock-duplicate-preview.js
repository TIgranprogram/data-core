import { api, session } from '../core/api.js';
import { canOpen } from '../core/route-access.js';
import { qty } from '../core/format.js';
import { hint, modal, stack, table, toastError } from '../ui/kit/index.js';

const mayCompare = () => session.canEditOrders && canOpen(session, 'stock');

async function showPreview(ids) {
  try {
    const q = new URLSearchParams({ sourceId: ids[0], targetId: ids[1] });
    const { items, blockers } = await api('/stock/duplicate-preview?' + q);
    const fields = [
      ['Наименование', (r) => r.fullName || r.name],
      ['Артикул', (r) => r.article],
      ['Единица', (r) => r.unit],
      ['Марка и стандарт', (r) => [r.grade, r.standard].filter(Boolean).join(' · ')],
      ['Движений в истории', (r) => r.movements],
      ['Броней в истории', (r) => r.reservations],
      ['Заявок', (r) => r.requests],
    ];
    const sides = [{ label: 'Первая позиция', wrap: true }, { label: 'Вторая позиция', wrap: true }];
    const placementList = items.flatMap((item) => item.placements.map((p) => ({ ...p, item })));
    const balances = table({
      label: 'Остатки по местам хранения',
      columns: [{ label: 'Позиция', wrap: true }, { label: 'Склад / зона', wrap: true },
        { label: 'Физический остаток', num: true }, { label: 'В брони', num: true }],
      rows: placementList.map((p) => ({ cells: [
        p.item.article || p.item.name, [p.warehouse, p.zone].filter(Boolean).join(' · '), qty(p.quantity), qty(p.reserved),
      ] })),
    });
    return modal({
      title: 'Сравнение складских дублей', wide: true, okText: 'Закрыть', cancelText: '',
      body: stack(
        table({ label: 'Карточки и история', columns: [{ label: 'Свойство', wrap: true }, ...sides],
          rows: fields.map(([label, value]) => ({ cells: [label, ...items.map((r) => value(r) ?? '—')] })) }),
        placementList.length ? balances : hint('У этих карточек нет складских размещений.'),
        ...blockers.map((message) => hint(message)),
      ),
    });
  } catch (error) {
    toastError(error, 'сравнить позиции');
  }
}

function catalogIds(rows) {
  return [...new Set(rows.map((r) => r.materialId || (r.kind === 'material' ? r.id.replace(/^m:/, '') : null)).filter(Boolean))];
}

export function stockDuplicateAction() {
  return {
    label: 'Сравнить дубли',
    when: (rows) => mayCompare() && rows.length === 2,
    run: (ids) => showPreview(ids),
  };
}

export const catalogStockLinksAction = {
  label: 'Складские связи',
  when: (rows) => mayCompare() && rows.length === 2 && catalogIds(rows).length === 2,
  run: (_ids, rows) => showPreview(catalogIds(rows)),
};
