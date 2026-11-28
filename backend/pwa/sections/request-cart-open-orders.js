/** Открытые потребности и заказы поставщику. При частичной приёмке qty уже содержит остаток. */
export function purchaseSignals(rows) {
  const stages = new Map([
    ['Уже в заявках', new Map()],
    ['Ожидаем поставку', new Map()],
    ['Оплачено, ждём поставку', new Map()],
  ]);
  for (const row of rows) {
    for (const { status, qty, unit, paid } of row.openPurchases || []) {
      if (!['ordered', 'requested', 'in_progress'].includes(status) || !(qty > 0)) continue;
      const stage = status === 'ordered' ? (paid ? 'Оплачено, ждём поставку' : 'Ожидаем поставку') : 'Уже в заявках';
      const totals = stages.get(stage);
      const label = String(unit || row.unit || '').trim();
      totals.set(label, (totals.get(label) || 0) + qty);
    }
  }
  return [...stages].filter(([, totals]) => totals.size).map(([stage, totals]) =>
    stage + ': ' + [...totals].map(([unit, qty]) => (qty.toLocaleString('ru-RU', { maximumFractionDigits: 6 }) + ' ' + unit).trim()).join(' + '));
}

export function lastPurchaseText(row) {
  const last = row.lastPurchase;
  if (!last?.date) return '';
  const date = new Date(last.date);
  if (!Number.isFinite(date.valueOf())) return '';
  const number = last.num ? ' · заявка №' + last.num : '';
  return 'Последний заказ: ' + (last.dateKind === 'invoice' ? 'счёт от ' : '') + date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) + number;
}
