/** Только синтетические данные. Никаких ссылок, токенов и данных production. */
export function invoiceMergeData() {
  const source = { id: 'source', no: '102', date: '2026-11-01', supplierName: 'Тестовый поставщик', status: 'issued', amount: 300, requests: [
    { id: 'a', num: 101, title: 'Болт М8 с длинным наименованием позиции для проверки телефона', materialId: 'bolt', qty: 10, unit: 'шт.', priceHint: 100, status: 'ordered' },
    { id: 'b', num: 102, title: 'Гайка М8', materialId: 'nut', qty: 20, unit: 'шт.', priceHint: 200, status: 'ordered' },
    { id: 'cancelled', title: 'Отменённая строка не переносится', priceHint: 900, status: 'cancelled' },
  ] };
  const target = { id: 'target', no: '102', date: '2026-10-31', supplierName: 'Тестовый поставщик', status: 'issued', amount: 500, requests: [
    { id: 'c', num: 91, title: 'Другое имя того же болта', materialId: 'bolt', qty: 10, unit: 'шт.', priceHint: 100, status: 'ordered' },
    { id: 'd', num: 92, title: 'Шайба М8', materialId: 'washer', qty: 40, unit: 'шт.', priceHint: 400, status: 'ordered' },
  ] };
  const preview = {
    source: { id: source.id, no: source.no, date: source.date, status: source.status, lines: 2, amount: 300 },
    target: { id: target.id, no: target.no, date: target.date, status: target.status, lines: 2, amount: 500 },
    duplicates: 1, strategies: ['append', 'mergeSameRequest', 'replaceLines'], resultAmount: { append: 800, mergeSameRequest: 700, replaceLines: 300 },
  };
  return { source, target, preview };
}
