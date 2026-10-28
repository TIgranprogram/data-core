/* Разовая заливка истории цен в `materialprices` из (а) оплаченных заявок с materialId и (б) supplieritems.priceHistory.
 * План по умолчанию (ничего не пишет), запись — с --apply. Повторный запуск дублей не создаёт.
 * Допущения: сумма строки заявки (priceHint) и цены priceHistory — с НДС 20 %; цена без НДС = с НДС / 1.2.
 * Внутри контейнера backend:
 *   docker cp backend/scripts/backfill-materialprices.js datacore-backend:/app/scripts/
 *   docker exec datacore-backend node scripts/backfill-materialprices.js [--apply]
 */
const path = require('path');
const root = path.join(__dirname, '..');
const { MongoClient } = require(require.resolve('mongodb', { paths: [root] }));
const apply = process.argv.includes('--apply');
const VAT = 20;
const r4 = (n) => Math.round(n * 10000) / 10000;
const split = (withVat) => ({ priceWithVat: r4(withVat), price: r4(withVat / (1 + VAT / 100)) });

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Нужен MONGO_URI (строка подключения к базе)');
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db();
    const out = db.collection('materialprices');
    const rows = [];

    // (а) оплаченные заявки: строка = одна заявка, дата — paidAt/invoiceDate
    const reqs = await db.collection('supplyrequests').find({ deletedAt: null, paid: true, materialId: { $ne: null }, qty: { $gt: 0 }, priceHint: { $gt: 0 } }).toArray();
    for (const r of reqs) {
      rows.push({ key: { requestId: r._id, source: 'invoice_paid' }, doc: {
        materialId: r.materialId, supplierId: r.supplierId, supplierName: r.supplierName, ...split(r.priceHint / r.qty), vatRate: VAT,
        unit: r.unit, qty: r.qty, currency: 'RUB', date: r.invoiceDate || r.paidAt || r.updatedAt || r.createdAt || new Date(),
        source: 'invoice_paid', invoiceId: r.invoiceId, requestId: r._id, salesOrderId: r.salesOrderId } });
    }
    const fromReq = rows.length;

    // (б) supplieritems.priceHistory (только позиции, привязанные к материалу)
    const items = await db.collection('supplieritems').find({ deletedAt: null, materialId: { $ne: null }, 'priceHistory.0': { $exists: true } }).toArray();
    for (const it of items) {
      for (const h of it.priceHistory) {
        if (!(h.price > 0) || !h.date) continue;
        const date = new Date(h.date);
        rows.push({ key: { materialId: it.materialId, supplierId: it.supplierId, source: 'import', date, priceWithVat: r4(h.price) }, doc: {
          materialId: it.materialId, supplierId: it.supplierId, ...split(h.price), vatRate: VAT, unit: it.unit, currency: 'RUB', date, source: 'import' } });
      }
    }
    console.log(`План: из оплаченных заявок ${fromReq}, из supplieritems.priceHistory ${rows.length - fromReq} (позиций ${items.length}); всего ${rows.length}`);
    if (!apply) { console.log('Это план. Запись — с --apply.'); return; }

    let added = 0; const now = new Date();
    for (const { key, doc } of rows) {
      const res = await out.updateOne(key, { $setOnInsert: { ...doc, createdAt: now, updatedAt: now } }, { upsert: true });
      if (res.upsertedCount) added++;
    }
    // lastPrice материалов — по самой свежей строке (только там, где ещё не заполнено)
    const last = await out.aggregate([{ $sort: { date: -1 } }, { $group: { _id: '$materialId', price: { $first: '$price' }, date: { $first: '$date' }, supplierId: { $first: '$supplierId' }, supplierName: { $first: '$supplierName' } } }]).toArray();
    let upd = 0;
    for (const l of last) {
      const res = await db.collection('materials').updateOne({ _id: l._id, lastPrice: { $exists: false } },
        { $set: { lastPrice: l.price, lastPriceDate: l.date, lastSupplierId: l.supplierId, lastSupplierName: l.supplierName } });
      upd += res.modifiedCount;
    }
    console.log(`Записано новых строк: ${added} (остальные уже были); материалов с lastPrice: ${upd}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
