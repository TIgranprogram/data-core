// Блокер 3: расхождения amount счёта и суммы строк — ТОЛЬКО ЧТЕНИЕ (ничего не пишет).
// Инвариант: amount счёта = сумма priceHint его строк (кроме удалённых и отменённых).
// Строки лежат в supplyrequests с invoiceId = _id счёта; priceHint у строки счёта — сумма по строке, не цена за штуку.
// Запуск на стенде/VM (пароль берётся из окружения контейнера, в вывод не попадает):
//   ssh datacore-vm 'docker exec -i datacore-mongo sh -c '"'"'mongo --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin datacore'"'"'' < backend/scripts/audit-invoice-amounts.js
// Итог: сводка по статусам + список расхождений (id, №, поставщик, строк, amount, сумма строк, разница).
var round2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };
var byStatus = {};
var rows = [];
db.supplyinvoices.find({ deletedAt: null }, { no: 1, status: 1, amount: 1, supplierName: 1, date: 1 }).forEach(function (inv) {
  var sum = 0;
  var lines = 0;
  db.supplyrequests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }, { priceHint: 1 }).forEach(function (l) {
    sum += Number(l.priceHint) || 0;
    lines++;
  });
  sum = round2(sum);
  var amount = round2(inv.amount);
  var diff = round2(amount - sum);
  var st = inv.status || 'draft';
  if (!byStatus[st]) byStatus[st] = { invoices: 0, bad: 0, diff: 0 };
  byStatus[st].invoices++;
  if (Math.abs(diff) > 0.009) {
    byStatus[st].bad++;
    byStatus[st].diff = round2(byStatus[st].diff + diff);
    rows.push([
      String(inv._id), st, inv.no || '', inv.supplierName || '', lines,
      amount.toFixed(2), sum.toFixed(2), diff.toFixed(2),
      inv.date ? new Date(inv.date).toISOString().slice(0, 10) : ''
    ].join('\t'));
  }
});
print(['status', 'invoices', 'with_discrepancy', 'sum_diff'].join('\t'));
Object.keys(byStatus).sort().forEach(function (s) {
  var x = byStatus[s];
  print([s, x.invoices, x.bad, x.diff.toFixed(2)].join('\t'));
});
if (rows.length) {
  print('');
  print(['id', 'status', 'no', 'supplier', 'lines', 'amount', 'sum_lines', 'diff', 'date'].join('\t'));
  rows.forEach(function (r) { print(r); });
} else {
  print('');
  print('Расхождений нет.');
}
