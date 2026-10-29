/* Склейка дублей счетов: живые счета supplyinvoices (не отменённые) с одним поставщиком и одинаковым нормализованным №.
 * Склеиваем в самый ранний (createdAt): заявки переезжают, amount = сумма, fileIds объединяются, пустые contractId/payerCompanyId/date — из остальных,
 * остальные счета — deletedAt + mergedInto. Оплаченные — только если ВСЕ в группе paid (paidAt = поздний); смешанные — «спорные», не трогаются.
 * По умолчанию — ПЛАН (только чтение). --apply — запись (после «да» пользователя и бэкапа).
 *   MONGO_URI=… [MONGO_DB=…] node scripts/merge-duplicate-invoices.js [--apply] */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

// копия normInvoiceNo из src/modules/supply/supply-invoice-rules.ts — менять синхронно
const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[№#]|\bн[оo]\.?\s/g, '').replace(/\s+/g, '').trim();
const sum = (a, b) => (a != null && b != null ? Math.round((a + b) * 100) / 100 : a ?? b);

(async () => {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const invs = await db.collection('supplyinvoices').find({ deletedAt: null, status: { $ne: 'cancelled' }, supplierId: { $ne: null }, no: { $nin: [null, ''] } }).toArray();
  const groups = new Map();
  for (const i of invs) { const k = `${i.supplierId}|${norm(i.no)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const plan = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || String(a._id).localeCompare(String(b._id)));
    const paid = list.filter((x) => x.status === 'paid').length;
    const [target, ...rest] = list;
    const reqs = await db.collection('supplyrequests').find({ invoiceId: { $in: rest.map((x) => x._id) }, deletedAt: null }).toArray();
    let amount = target.amount; for (const r of rest) amount = sum(amount, r.amount);
    plan.push({ list, target, rest, reqs, amount, disputed: paid > 0 && paid < list.length, allPaid: paid === list.length });
  }
  for (const p of plan) {
    console.log(`${p.disputed ? 'СПОРНАЯ (оплаченные вперемешку, не трогаем)' : 'склейка'}: «${p.target.supplierName}» № ${p.target.no} — ${p.list.length} счетов → ${p.target._id}`);
    console.log(`  сумма: ${p.list.map((x) => `${x.amount ?? '—'}${x.status === 'paid' ? '(оплачен)' : ''}`).join(' + ')} → ${p.amount ?? '—'}; заявок переедет: ${p.reqs.length}${p.reqs.length ? ` (№ ${p.reqs.map((r) => r.num).join(', ')})` : ''}`);
  }
  console.log(`Групп: ${plan.length}, склеить: ${plan.filter((p) => !p.disputed).length}, спорных: ${plan.filter((p) => p.disputed).length}`);
  if (!apply) { console.log('ПЛАН. Запись — с --apply'); await c.close(); return; }
  let done = 0;
  for (const p of plan.filter((x) => !x.disputed)) {
    const { target, rest } = p;
    const $set = { amount: p.amount };
    const files = new Map(); for (const x of p.list) for (const f of x.fileIds || []) files.set(String(f), f);
    $set.fileIds = [...files.values()];
    for (const k of ['contractId', 'payerCompanyId', 'date']) if (!target[k]) { const o = rest.find((x) => x[k]); if (o) $set[k] = o[k]; }
    if (p.allPaid) $set.paidAt = p.list.map((x) => x.paidAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
    else if (rest.some((x) => x.status === 'issued') && target.status === 'draft') $set.status = 'issued';
    const ids = rest.map((x) => x._id);
    await db.collection('supplyrequests').updateMany({ invoiceId: { $in: ids }, deletedAt: null }, { $set: { invoiceId: target._id, supplierId: target.supplierId, editedInApp: true } });
    await db.collection('supplyinvoices').updateOne({ _id: target._id }, { $set });
    await db.collection('supplyinvoices').updateMany({ _id: { $in: ids } }, { $set: { deletedAt: new Date(), mergedInto: target._id } });
    done++;
  }
  console.log(`Склеено групп: ${done}`);
  await c.close();
})().catch((e) => { console.error(e); process.exit(1); });
