import { downloadXlsx } from '../core/xlsx-write.js';
import { orderLength, pipeOrder } from './request-cart-pipe-input.js';

export function exportCart(rows, numberOf) {
  const withPipes = rows.some(row => row.pipe);
  downloadXlsx('Заявки из каталога.xlsx', [
    ['Наименование', 'Артикул', 'Единица', 'Количество', ...(withPipes ? ['Марка', 'Длина хлыста, м', 'Штуки', 'Метры'] : [])],
    ...rows.map(row => {
      const order = pipeOrder(row, row.qty);
      const pieces = order?.pieces ?? (row.pipe?.unitMode === 'pieces' ? numberOf(row.qty) : '');
      const metres = order?.metres ?? (row.pipe?.unitMode === 'metres' ? numberOf(row.qty) : '');
      return [row.name, row.pipe ? '' : String(row.article || ''), row.unit || '', numberOf(row.qty),
        ...(withPipes ? [row.grade || '', orderLength(row) || '', pieces, metres] : [])];
    }),
  ], 'Заявки');
}

const russian = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 6 });
/** API создаёт одну заявку на materialId в его основной единице. Сохраняем
 * раскрой заказа с ручными длинами в штатном примечании этой заявки. */
export function bulkLines(rows, numberOf) {
  const byMaterial = new Map();
  for (const row of rows) {
    if (!byMaterial.has(row.materialId)) byMaterial.set(row.materialId, []);
    byMaterial.get(row.materialId).push(row);
  }
  return [...byMaterial].map(([materialId, variants]) => {
    const qty = Number(variants.reduce((sum, row) => sum + numberOf(row.qty), 0).toPrecision(15));
    if (!variants.some(row => row.orderLengthM)) return { materialId, qty };
    const details = variants.map(row => {
      const order = pipeOrder(row, row.qty);
      return order ? russian(order.pieces) + ' шт × ' + russian(orderLength(row)) + ' м'
        : russian(numberOf(row.qty)) + ' ' + row.unit + ' без указания длины';
    });
    return { materialId, qty, note: 'Хлысты: ' + details.join('; ') };
  });
}
