/* Новая наша компания + привязка её заказов из Excel (TASKS З.9: «Спортсет» — третья наша компания, решение 2026-10-20).
 * Заводит организацию с isOurCompany по образцу существующей нашей (СИЮ), затем заказы с importKey «<КЛЮЧ>|…»
 * без компании получают companyId (вместе с позициями), пометка «компания не определена» из примечания убирается.
 * По умолчанию — только отчёт; --apply — применить. Повтор безопасен.
 *   MONGO_URI=… [MONGO_DB=…] node scripts/add-our-company.js --name Спортсет --key СПОРТСЕТ [--apply] */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
(async () => {
  const name = arg('--name'), key = (arg('--key') || '').toUpperCase(), apply = process.argv.includes('--apply');
  if (!process.env.MONGO_URI || !name || !key) { console.error('Нужны MONGO_URI, --name и --key'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const orgs = db.collection('organizations');
  let org = await orgs.findOne({ deletedAt: null, $or: [{ name }, { shortName: name }] });
  if (!org) {
    const sample = await orgs.findOne({ isOurCompany: true, deletedAt: null });
    if (!sample) throw new Error('Нет ни одной нашей компании для образца');
    const { _id, name: _n, shortName: _s, inn: _i, createdAt: _c, updatedAt: _u, ...rest } = sample;
    org = { ...rest, name, shortName: name, inn: `БЕЗ-ИНН-${key.toLowerCase()}-${Date.now().toString(36)}`, isOurCompany: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() };
    console.log(`Наша компания «${name}»: будет создана (по образцу «${sample.shortName || sample.name}»)`);
    if (apply) org._id = (await orgs.insertOne(org)).insertedId;
  } else {
    console.log(`Наша компания «${name}»: уже есть${org.isOurCompany ? '' : ' — будет отмечена как наша'}`);
    if (apply && !org.isOurCompany) await orgs.updateOne({ _id: org._id }, { $set: { isOurCompany: true } });
  }
  const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\|');
  const orders = await db.collection('salesorders').find({ importKey: re, deletedAt: null }).toArray();
  console.log(`Заказов «${key}|…»: ${orders.length}, без компании: ${orders.filter((o) => !o.companyId).length}`);
  if (apply && org._id) {
    for (const o of orders) {
      const notes = String(o.notes || '').replace(/\s*Поставщик в файле:[^\n]*компания не определена[^\n]*/g, '').trim();
      await db.collection('salesorders').updateOne({ _id: o._id }, { $set: { companyId: org._id, notes: notes || null, updatedAt: new Date() } });
      await db.collection('incomes').updateMany({ orderId: o._id }, { $set: { companyId: org._id } });
    }
    console.log(`Применено: заказы и их позиции → «${name}»`);
  } else if (!apply) console.log('Это проверка. Применить: --apply');
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
