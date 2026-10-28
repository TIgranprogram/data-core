#!/usr/bin/env node
/**
 * Позиции заказов: старая «дата оплаты» -> один платёж (В-4, 2026-10-28).
 * Для каждой позиции с paidDate и без payments: payments = [{date: paidDate, amount: amount, method: <из формы оплаты, если нал>}], paidAmount = amount.
 * paidDate не меняется. Повторный запуск ничего не делает. Позиции без суммы (amount <= 0) пропускаются и печатаются.
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/incomes-payments-migrate.js            - план, ничего не пишет
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/incomes-payments-migrate.js --apply    - записать
 * Откат: $unset payments, paidAmount не нужен - сервис считает оплату по paidDate, если платежей нет.
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

/** Способ из формы оплаты: «нал» -> нал, «б/р…» -> безнал, иначе не указан. Чистая функция. */
function methodOf(form) {
  const f = String(form || '').toLowerCase();
  if (/нал/.test(f) && !/безнал/.test(f)) return 'нал';
  if (/б\/р|безнал/.test(f)) return 'безнал';
  return undefined;
}

/** Платёж для записи или null (нечего мигрировать). */
function planFor(doc) {
  if (!doc.paidDate || (doc.payments && doc.payments.length) || !(Number(doc.amount) > 0)) return null;
  const method = methodOf(doc.paymentForm);
  return { payments: [{ date: doc.paidDate, amount: Number(doc.amount), ...(method ? { method } : {}) }], paidAmount: Number(doc.amount) };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const coll = c.db(process.env.MONGO_DB || 'datacore').collection('incomes');
  let todo = 0, skipped = 0;
  for await (const d of coll.find({ paidDate: { $ne: null }, deletedAt: null })) {
    if (d.payments && d.payments.length) continue;
    const p = planFor(d);
    if (!p) { skipped++; console.log('пропуск (нет суммы):', String(d._id), d.title); continue; }
    todo++;
    if (apply) await coll.updateOne({ _id: d._id }, { $set: p });
  }
  console.log(`${apply ? 'Записано' : 'План (ничего не записано; --apply — записать)'}: платежей ${todo}, пропущено ${skipped}`);
  await c.close();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { methodOf, planFor };
