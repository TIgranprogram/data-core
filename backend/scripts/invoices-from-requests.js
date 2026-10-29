/* Счета из заявок (TASKS СЧ): заявки снабжения с текстовым invoiceNo и без invoiceId → запись в supplyinvoices + invoiceId в заявках.
 * Группа = поставщик (supplierId) + № счёта нормализованный + дата (день). Счёт с тем же поставщиком+№ уже есть → только привязка.
 * По умолчанию — ПЛАН (только чтение) + CSV. --apply — запись (после «да» пользователя и бэкапа). --out=файл.csv — путь CSV плана.
 * Заявкам пишется только invoiceId (invoiceNo/invoiceDate/paid уже стоят). Спорные группы и без поставщика — не применяются.
 *   MONGO_URI=… [MONGO_DB=…] node scripts/invoices-from-requests.js [--apply] [--out=plan.csv] */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[№#]|\bн[оo]\.?\s/g, '').replace(/\s+/g, '').trim();
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);

(async () => {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const reqs = await db.collection('supplyrequests').find({
    deletedAt: null, invoiceNo: { $nin: [null, ''] }, $or: [{ invoiceId: { $exists: false } }, { invoiceId: null }],
  }).toArray();
  const orgs = await db.collection('organizations').find({}, { projection: { name: 1, shortName: 1 } }).toArray();
  const orgName = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name || '')]));
  const existing = await db.collection('supplyinvoices').find({ deletedAt: null }).toArray();
  const exByKey = new Map();
  for (const e of existing) { const k = `${e.supplierId || ''}|${norm(e.no)}`; if (!exByKey.has(k)) exByKey.set(k, []); exByKey.get(k).push(e); }

  // группы «поставщик + № счёта»; даты внутри — отдельно, чтобы увидеть спор
  const bySN = new Map();
  for (const r of reqs) {
    const k = `${r.supplierId || ''}|${norm(r.invoiceNo)}`;
    if (!bySN.has(k)) bySN.set(k, []);
    bySN.get(k).push(r);
  }
  const plan = [];
  for (const [k, list] of bySN) {
    const dates = [...new Set(list.map((r) => day(r.invoiceDate)))];
    const withTotal = list.filter((r) => Number(r.lineTotal) > 0);
    const amount = withTotal.length === list.length ? Math.round(list.reduce((s, r) => s + Number(r.lineTotal), 0) * 100) / 100 : null;
    const ex = exByKey.get(k) || [];
    const problems = [];
    if (!list[0].supplierId) problems.push('пустой поставщик');
    if (dates.length > 1) problems.push(`разные даты: ${dates.map((d) => d || 'пусто').join(' / ')}`);
    if (ex.length > 1) problems.push('в supplyinvoices уже несколько счетов с таким поставщиком+№');
    if (ex.length === 1 && ex[0].date && dates.length === 1 && dates[0] && day(ex[0].date) !== dates[0]) problems.push(`дата счёта ${day(ex[0].date)} ≠ заявок ${dates[0]}`);
    if (ex.length === 1 && amount != null && ex[0].amount != null && Math.abs(ex[0].amount - amount) > 0.01) problems.push(`сумма счёта ${ex[0].amount} ≠ заявок ${amount}`);
    plan.push({
      action: ex.length ? 'привязать' : 'создать', supplier: orgName.get(String(list[0].supplierId)) || '', supplierId: list[0].supplierId,
      no: String(list[0].invoiceNo).trim(), date: dates.length === 1 ? dates[0] : '', amount, existingId: ex.length === 1 ? ex[0]._id : null,
      reqs: list, problems,
    });
  }

  const out = arg('out') || path.join(process.cwd(), `invoices-plan-${new Date().toISOString().slice(0, 10)}.csv`);
  const rows = ['действие;поставщик;№ счёта;дата;сумма;заявок;№ заявок;спорное'];
  for (const p of plan) rows.push([p.action, p.supplier, p.no, p.date, p.amount ?? '', p.reqs.length, p.reqs.map((r) => r.num ?? r._id).join(' '), p.problems.join('; ')].map(csv).join(';'));
  fs.writeFileSync(out, '﻿' + rows.join('\r\n'));

  const ok = plan.filter((p) => !p.problems.length), bad = plan.filter((p) => p.problems.length);
  const cnt = (a, f) => `${a.filter(f).length} (заявок ${a.filter(f).reduce((s, p) => s + p.reqs.length, 0)})`;
  console.log(`Заявок с № счёта без связи: ${reqs.length}; групп: ${plan.length}`);
  console.log(`К созданию: ${cnt(ok, (p) => p.action === 'создать')}; к привязке к существующему: ${cnt(ok, (p) => p.action === 'привязать')}`);
  console.log(`Спорные (не применяются): ${cnt(bad, () => true)}; пустой поставщик: ${cnt(bad, (p) => !p.supplierId)}`);
  for (const p of bad) console.log(`  ! ${p.supplier || '—'} №${p.no}: ${p.problems.join('; ')} (заявки ${p.reqs.map((r) => r.num ?? '—').join(', ')})`);
  console.log(`CSV плана: ${out}`);

  if (!apply) { console.log('План. Ничего не изменено. Запись — флаг --apply.'); await c.close(); return; }
  let made = 0, linked = 0, touched = 0;
  const now = new Date();
  for (const p of ok) {
    let id = p.existingId;
    if (!id) {
      const allPaid = p.reqs.every((r) => r.paid === true);
      const paidAts = p.reqs.map((r) => r.paidAt).filter(Boolean).sort((a, b) => b - a);
      const inv = {
        no: p.no, supplierId: p.supplierId, supplierName: p.supplier, fileIds: [], deletedAt: null, createdAt: now, updatedAt: now,
        status: allPaid ? 'paid' : (p.date && p.amount > 0 ? 'issued' : 'draft'),
      };
      if (p.date) inv.date = new Date(p.date);
      if (p.amount != null) inv.amount = p.amount;
      const company = p.reqs.map((r) => r.companyId).find(Boolean);
      if (company) inv.payerCompanyId = company;
      if (allPaid && paidAts[0]) inv.paidAt = paidAts[0];
      id = (await db.collection('supplyinvoices').insertOne(inv)).insertedId;
      made++;
    } else linked++;
    const res = await db.collection('supplyrequests').updateMany(
      { _id: { $in: p.reqs.map((r) => r._id) }, deletedAt: null, $or: [{ invoiceId: { $exists: false } }, { invoiceId: null }] },
      { $set: { invoiceId: id } });
    touched += res.modifiedCount;
  }
  console.log(`ЗАПИСАНО: счетов создано ${made}, привязано к существующим ${linked}, заявок обновлено ${touched}`);
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
