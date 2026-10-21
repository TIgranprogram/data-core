/* Чистка автоартикулов СКЛ-… → артикул поставщика из заявок (TASKS АР-Ч, протокол Ч.1–Ч.9). Данные не удаляются,
 * меняются только article, internalArticle (внутр. код = старый СКЛ-…) и sku (если пуст). Логика — src/modules/stock/article-clean.ts.
 *
 *   По умолчанию — ТОЛЬКО ОТЧЁТ (dry-run):  MONGO_URI=… [MONGO_DB=…] node scripts/clean-auto-articles.js [--groups A] [--csv файл] [--include-edited]
 *   Запись (после «да» пользователя и backup.sh): … --apply --expect <число строк выбранных групп> --backup <папка бэкапа> [--out-dir папка]
 *     → файл отката articles-before-<дата>.json (вне git), батчи по 50, условие «article всё ещё старый», запись в «Историю изменений».
 *   Откат: … --rollback <articles-before-….json> [--apply] — по умолчанию тоже только отчёт.
 * Нужна сборка (dist): в контейнере есть; локально — npx nest build. */
const path = require('path');
const fs = require('fs');
const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
const { classify, updateFor, beforeOf, rollbackFor } = require(path.join(__dirname, '..', 'dist', 'src', 'modules', 'stock', 'article-clean'));

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const has = (k) => process.argv.includes(k);
const apply = has('--apply');
const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

async function snapshot(db) {
  const mats = await db.collection('materials').find({ deletedAt: null }, { projection: { article: 1 } }).toArray();
  const counts = new Map();
  for (const m of mats) { const k = norm(m.article); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  const [qty] = await db.collection('storageitems').aggregate([{ $match: { deletedAt: null } }, { $group: { _id: null, q: { $sum: '$quantity' }, n: { $sum: 1 } } }]).toArray();
  return { materials: mats.length, emptyArticle: mats.filter((m) => !String(m.article ?? '').trim()).length,
    dupArticles: [...counts].filter(([, n]) => n > 1).map(([a]) => a).sort(), stockRows: qty?.n ?? 0, stockQty: Math.round((qty?.q ?? 0) * 1000) / 1000 };
}
const audit = (db, id, action, before, after, reason) => db.collection('auditlogs').insertOne({
  action, entityType: 'Material', entityId: new ObjectId(id), userName: 'система', details: { partial: true, before, after, reason }, createdAt: new Date(), updatedAt: new Date() });

async function rollback(db, file) {
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  let ok = 0, skipped = 0;
  console.log(`Откат по ${file}: записей ${plan.items.length} (чистка ${plan.meta.appliedAt}, бэкап ${plan.meta.backup || '—'})`);
  for (const it of plan.items) {
    const cur = await db.collection('materials').findOne({ _id: new ObjectId(it.id) });
    if (!cur || cur.article !== it.after) { skipped++; console.log(`  пропуск «${cur?.name ?? it.id}»: артикул уже ${cur?.article ?? '—'}, не ${it.after}`); continue; }
    const r = rollbackFor(it.before, { ...cur, _id: String(cur._id) });
    if (apply) {
      const res = await db.collection('materials').updateOne({ _id: new ObjectId(r.id), article: r.expectArticle }, { $set: r.set, $unset: r.unset });
      if (res.modifiedCount) { ok++; await audit(db, r.id, 'stock.item.article.restored', { article: it.after }, { article: it.before.article }, 'откат чистки артикулов'); } else skipped++;
    } else ok++;
  }
  console.log(`${apply ? 'Возвращено' : 'Будет возвращено'}: ${ok}; пропущено: ${skipped}${apply ? '' : ' (dry-run — ничего не изменено)'}`);
}

(async () => {
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  try {
    if (arg('--rollback')) { await rollback(db, arg('--rollback')); return; }
    const groups = new Set(String(arg('--groups') || 'A').toUpperCase().split(',').filter((g) => 'AB'.includes(g))); // C, D — только руками
    const mats = (await db.collection('materials').find({}, { projection: { name: 1, article: 1, sku: 1, internalArticle: 1, editedInApp: 1, deletedAt: 1 } }).toArray()).map((m) => ({ ...m, _id: String(m._id) }));
    const reqs = (await db.collection('supplyrequests').find({ deletedAt: null, article: { $nin: [null, ''] } }, { projection: { materialId: 1, title: 1, article: 1, num: 1 } }).toArray())
      .map((r) => ({ ...r, materialId: r.materialId ? String(r.materialId) : null }));
    const rows = classify(mats, reqs, { includeEdited: has('--include-edited') });
    const by = (g) => rows.filter((r) => r.group === g).length;
    console.log(`Позиций: ${mats.filter((m) => !m.deletedAt).length}; к рассмотрению: ${rows.length} — A (по связи): ${by('A')} · B (по названию): ${by('B')} · C (несколько): ${by('C')} · D (опасные): ${by('D')} · E (пропуск): ${by('E')}`);
    console.log('');
    console.log('Группа | позиция | id | артикул сейчас | новый | источник | причина пропуска / пара');
    for (const r of rows) console.log(`${r.group} | ${r.name} | ${r.id} | ${r.now || '—'} | ${r.next ?? '—'} | ${r.source} | ${[r.reason, r.pair && 'пара: ' + r.pair].filter(Boolean).join('; ')}`);
    if (arg('--csv')) {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      fs.writeFileSync(arg('--csv'), '﻿' + ['группа;позиция;id;артикул сейчас;новый;источник;причина;пара', ...rows.map((r) => [r.group, r.name, r.id, r.now, r.next, r.source, r.reason, r.pair].map(q).join(';'))].join('\r\n'));
      console.log(`\nТаблица: ${arg('--csv')}`);
    }
    const plan = rows.filter((r) => groups.has(r.group));
    console.log(`\nК записи (группы ${[...groups].join(', ')}): ${plan.length}`);
    if (!apply) { console.log('Ничего не изменено (dry-run).'); return; }

    // ---------- Запись (Ч.4–Ч.6) ----------
    if (Number(arg('--expect')) !== plan.length) { console.error(`СТОП: --expect ${arg('--expect') ?? '(нет)'} ≠ ${plan.length} строк к записи — данные изменились с показа, покажите таблицу заново`); process.exit(3); }
    if (!arg('--backup')) { console.error('СТОП: укажите --backup <папка свежего бэкапа> (backup.sh перед записью)'); process.exit(3); }
    const before = await snapshot(db);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const file = path.join(arg('--out-dir') || process.cwd(), `articles-before-${stamp}.json`);
    const byId = new Map(mats.map((m) => [m._id, m]));
    fs.writeFileSync(file, JSON.stringify({ meta: { appliedAt: new Date(), backup: arg('--backup'), groups: [...groups], count: plan.length }, items: plan.map((r) => ({ id: r.id, before: beforeOf(byId.get(r.id)), after: r.next })) }, null, 2));
    console.log(`Файл отката: ${file}`);
    let done = 0, skipped = 0;
    for (let i = 0; i < plan.length; i += 50) {
      for (const r of plan.slice(i, i + 50)) {
        const u = updateFor(r, byId.get(r.id));
        const res = await db.collection('materials').updateOne({ _id: new ObjectId(u.id), article: u.oldArticle, deletedAt: null }, { $set: u.set });
        if (res.modifiedCount) { done++; await audit(db, u.id, 'stock.item.article.cleaned', { article: u.oldArticle }, { article: r.next, internalArticle: u.set.internalArticle ?? byId.get(r.id).internalArticle ?? null }, 'чистка артикулов'); }
        else { skipped++; console.log(`  пропуск «${r.name}»: артикул поменялся с показа`); }
      }
    }
    const after = await snapshot(db);
    const newDups = after.dupArticles.filter((a) => !before.dupArticles.includes(a));
    const oldFound = await db.collection('materials').countDocuments({ internalArticle: { $in: plan.map((r) => r.now) } });
    console.log(`\nЗаписано: ${done} из ${plan.length}; пропущено: ${skipped}`);
    console.log('Проверка Ч.6:');
    console.log(`  число замен = плану: ${done === plan.length ? 'да' : 'НЕТ'}`);
    console.log(`  новых пустых артикулов: ${after.emptyArticle - before.emptyArticle} · новых дублей: ${newDups.length ? newDups.join(', ') : 0}`);
    console.log(`  позиций: ${before.materials} → ${after.materials} · строк остатка: ${before.stockRows} → ${after.stockRows} · сумма остатков: ${before.stockQty} → ${after.stockQty}`);
    console.log(`  старые СКЛ-… находятся как внутренний код: ${oldFound} из ${plan.length}`);
  } finally { await c.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
