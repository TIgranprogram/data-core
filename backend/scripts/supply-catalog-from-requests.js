/* СКЕ-3: наполнить каталог поставщика (supplieritems) из прошлых заявок (supplyrequests).
 * Без --apply — только план (сколько строк будет создано/обновлено).
 * --apply    — реально upsert.
 *
 * Ключ позиции: supplierId + article + color (СКЕ-4 из QUESTIONS).
 * Заявки без supplierId или без article/title — пропускаются.
 * Цена в каталоге = последняя цена из заявок (по requestDate/createdAt).
 * Существующие заявки не изменяются.
 *
 * Запуск внутри контейнера:
 *   node scripts/supply-catalog-from-requests.js
 *   node scripts/supply-catalog-from-requests.js --apply
 */
'use strict';
const root = require('path').join(__dirname, '..');
const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [root] })).mongo;

(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URI);
  try {
    const db = client.db();
    const apply = process.argv.includes('--apply');

    // Все активные заявки с поставщиком и артикулом/названием
    const reqs = await db.collection('supplyrequests').find(
      { supplierId: { $exists: true, $ne: null }, deletedAt: null },
      { projection: { supplierId: 1, article: 1, title: 1, color: 1, priceHint: 1, requestDate: 1, createdAt: 1 } },
    ).toArray();

    // Группируем по (supplierId, article||title, color)
    const byKey = new Map();
    for (const r of reqs) {
      const article = (r.article || r.title || '').trim();
      if (!article) continue;
      const color = (r.color || '').trim();
      const supplierId = String(r.supplierId);
      const key = `${supplierId}|${article}|${color}`;
      const date = r.requestDate || r.createdAt || new Date(0);
      const existing = byKey.get(key);
      // Берём строку с самой поздней датой для цены
      if (!existing || date > existing.date) {
        byKey.set(key, { supplierId, article, color, name: article, price: r.priceHint ?? null, date });
      }
    }

    const entries = [...byKey.values()];
    if (!entries.length) { console.log('Нет подходящих заявок.'); return; }

    // Проверяем что уже есть в каталоге
    const existingItems = await db.collection('supplieritems').find(
      {}, { projection: { supplierId: 1, article: 1, color: 1 } }
    ).toArray();
    const existingSet = new Set(existingItems.map((i) => `${i.supplierId}|${i.article}|${i.color || ''}`));

    let newCount = 0;
    let updateCount = 0;
    for (const e of entries) {
      if (existingSet.has(`${e.supplierId}|${e.article}|${e.color}`)) updateCount++;
      else newCount++;
    }

    console.log(`Заявок: ${reqs.length} · Уникальных позиций: ${entries.length}`);
    console.log(`Новых: ${newCount} · Обновятся: ${updateCount}${apply ? '' : ' (план; добавьте --apply чтобы применить)'}`);

    if (!apply) {
      const sample = entries.slice(0, 10);
      console.log('\nПервые 10 позиций:');
      for (const e of sample) {
        const flag = existingSet.has(`${e.supplierId}|${e.article}|${e.color}`) ? 'upd' : 'new';
        const price = e.price != null ? ` · ${e.price} ₽` : '';
        console.log(`  [${flag}] ${e.article}${e.color ? ' / ' + e.color : ''}${price}`);
      }
      return;
    }

    // Apply
    const now = new Date();
    let done = 0;
    for (const e of entries) {
      const filter = { supplierId: new ObjectId(e.supplierId), article: e.article, color: e.color };
      const isNew = !existingSet.has(`${e.supplierId}|${e.article}|${e.color}`);
      const updateDoc = {
        $set: { name: e.name, source: 'request', updatedAt: now, ...(e.price != null ? { priceHint: e.price } : {}) },
        $setOnInsert: { createdAt: now, deletedAt: null, priceHistory: [], optGroup: null, photoUrl: null },
        ...(e.price != null && isNew ? { $push: { priceHistory: { price: e.price, date: e.date, source: 'request' } } } : {}),
      };
      await db.collection('supplieritems').updateOne(filter, updateDoc, { upsert: true });
      done++;
      if (done % 100 === 0) process.stdout.write(`\r  ${done}/${entries.length}…`);
    }
    console.log(`\nГотово: ${done} позиций (новых ${newCount}, обновлено ${updateCount}).`);
  } finally {
    await client.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
