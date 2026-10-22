/* БЗ-7 шаг 1 (решение пользователя 2026-10-22: «оставить один вид паспорта»): паспортам без категории — категория по
 * старому полю `category` и текст по справочникам (тот же ProductPassportService.snapshot, что при выборе категории в
 * приложении). Номера, даты, заказчик, картинки не меняются. Детские («Качели», «Детский игровой комплекс», «Карусель»)
 * и без старой категории — не трогаем (ждут решения пользователя), их список печатается.
 *
 * Запуск — внутри контейнера backend (нужен собранный dist и переменные окружения приложения):
 *   docker cp backend/scripts/passports-to-v2.js datacore-backend:/app/scripts/
 *   План (ничего не меняет):  docker exec datacore-backend node scripts/passports-to-v2.js
 *   Записать (после бэкапа):  docker exec datacore-backend node scripts/passports-to-v2.js --apply
 */
const path = require('path');
const root = path.join(__dirname, '..');
const req = (m) => require(require.resolve(m, { paths: [root] }));

/** Старая категория (как в импорте старых паспортов) → категория справочника «Паспорта». */
const MAP = { 'уличный тренажер': 'TRN', 'воркаут': 'WRK', 'спортивное оборудование': 'WRK', 'благоустройство': 'MAF', 'маф': 'MAF' };
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е');

(async () => {
  const apply = process.argv.includes('--apply');
  const { NestFactory } = req('@nestjs/core');
  const { getConnectionToken } = req('@nestjs/mongoose');
  const { AppModule } = require(path.join(root, 'dist/src/app.module'));
  const { ProductPassportService } = require(path.join(root, 'dist/src/modules/product-passport/product-passport.service'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const coll = app.get(getConnectionToken()).collection('productpassports');
    const svc = app.get(ProductPassportService);
    const docs = await coll.find({ deletedAt: null, passportCategory: { $in: [null, ''] } }, { projection: { passportNumber: 1, category: 1, name: 1 } }).toArray();
    const plan = docs.map((d) => ({ d, to: MAP[norm(d.category)] || null }));
    const by = {};
    for (const p of plan) by[p.to || '—'] = (by[p.to || '—'] || 0) + 1;
    console.log(`${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}: паспортов без категории ${docs.length}`);
    for (const [k, n] of Object.entries(by)) console.log(`  ${k === '—' ? 'не трогаем' : k}: ${n}`);
    for (const p of plan.filter((x) => !x.to)) console.log(`    № ${p.d.passportNumber} · ${p.d.category || 'без старой категории'} · ${p.d.name || ''}`);
    if (!apply) return;
    let ok = 0; const fail = [];
    for (const p of plan.filter((x) => x.to)) {
      try {
        await coll.updateOne({ _id: p.d._id }, { $set: { passportCategory: p.to, updatedAt: new Date() } });
        if (!(await svc.snapshot(String(p.d._id)))) throw new Error('текст не собран');
        ok++;
      } catch (e) { fail.push(`№ ${p.d.passportNumber}: ${e.message}`); }
    }
    console.log(`Готово: переведено ${ok}${fail.length ? `, ошибок ${fail.length}:\n  ${fail.join('\n  ')}` : ''}`);
  } finally { await app.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
