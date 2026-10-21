/* «Заказчик» в заявках — план чистки (TASKS ЗЧ.4). ТОЛЬКО ОТЧЁТ (dry-run): ничего не пишет в базу.
 * Для каждого текста `orderLabel` в заявках — сколько заявок, откуда (Google-таблица / приложение) и что предлагается:
 *   - совпадает с заказчиком (контрагенты type customer, заказы) — оставить / привести написание;
 *   - «X, Y» и X — заказчик — заказчик X, «Y» → «Объект СМР / уточнение» (costObject, если пуст);
 *   - иначе — это не заказчик (участок, место, направление) — РЕШАЕТ ПОЛЬЗОВАТЕЛЬ (перенести в объект / направление / завести заказчика).
 * Применение — отдельно, только после «да» пользователя и свежего бэкапа (план — в --out файл JSON).
 *   MONGO_URI=… [MONGO_DB=…] node scripts/customers-cleanup.js [--out plan.json] */
const path = require('path');
const fs = require('fs');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
// как backend/src/modules/partners/customer-names.ts
const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'„“”]/g, '').replace(/\s+/g, ' ').trim();

(async () => {
  if (process.argv.includes('--apply')) { console.error('Этот скрипт только показывает план. Применение — после «да» пользователя, отдельным шагом.'); process.exit(2); }
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const [labels, so, inc, orgs] = await Promise.all([
    db.collection('supplyrequests').aggregate([{ $match: { deletedAt: null, orderLabel: { $nin: [null, ''] } } },
      { $group: { _id: '$orderLabel', n: { $sum: 1 }, fromSheet: { $sum: { $cond: [{ $ifNull: ['$sheetSource', false] }, 1, 0] } }, withObject: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$costObject', ''] } }, 0] }, 1, 0] } } } }]).toArray(),
    db.collection('salesorders').distinct('customer', { deletedAt: null }),
    db.collection('incomes').distinct('customer', { deletedAt: null }),
    db.collection('organizations').find({ deletedAt: null, type: 'customer', isOurCompany: { $ne: true } }, { projection: { name: 1 } }).toArray(),
  ]);
  const known = new Map();
  for (const x of [...orgs.map((o) => o.name), ...so, ...inc]) if (x && !known.has(norm(x))) known.set(norm(x), String(x).trim());
  const plan = labels.sort((a, b) => b.n - a.n).map((l) => {
    const t = String(l._id), k = norm(t), i = t.indexOf(',');
    const head = i > 0 ? t.slice(0, i).trim() : '', tail = i > 0 ? t.slice(i + 1).trim() : '';
    let action, to = null, object = null;
    if (known.has(k)) { to = known.get(k); action = to === t ? 'оставить — это заказчик' : `привести написание к «${to}»`; }
    else if (head && known.has(norm(head))) { to = known.get(norm(head)); object = tail; action = `заказчик «${to}», «${tail}» → «Объект СМР / уточнение»`; }
    else action = 'НЕ заказчик (участок / место / направление) — решает пользователь';
    return { label: t, requests: l.n, fromSheet: l.fromSheet, withObject: l.withObject, action, to, object };
  });
  console.log(`Заказчиков (контрагенты + заказы): ${known.size}; разных текстов «Заказчик» в заявках: ${labels.length}\n`);
  console.log('Текст в заявках | заявок (из таблицы) | предложение');
  for (const p of plan) console.log(`${JSON.stringify(p.label)} | ${p.requests} (${p.fromSheet}) | ${p.action}`);
  const out = arg('--out');
  if (out) { fs.writeFileSync(out, JSON.stringify({ createdAt: new Date(), plan }, null, 2)); console.log(`\nПлан записан: ${out}`); }
  console.log('\nНичего не изменено (dry-run).');
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
