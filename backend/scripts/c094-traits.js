#!/usr/bin/env node
/**
 * C094: признаки видов изделия (справочник «Функциональные элементы» — dict_values, dict = passportElements).
 * Условия текстов паспорта (guards / bin / bars / landing) смотрят на признаки вида — без них пункты выпадут у всех изделий с видом.
 * Признаки только ДОБАВЛЯЮТСЯ к уже стоящим (moving, walkable … остаются). Вид не найден по названию — пропуск.
 *
 *   MONGO_URI=… MONGO_DB=… node backend/scripts/c094-traits.js [--apply]
 *   На проде: bash deploy/synology/c094-traits.sh [--apply]  (через remote-access/run-script.sh)
 * Без --apply — план: вид → было → станет. Повтор безопасен.
 */
const path = require('path');

// вид (название в справочнике) → добавляемые признаки. План — docs/crew/C094-passport-text-fit/PLAN.md §4 п. 4.
const TRAITS = {
  'Ограждение (перила)': ['guards'], 'Ограждение площадки': ['guards'], 'Поручень': ['guards'], 'Борт': ['guards'],
  'Лестница': ['guards', 'landing'], 'Площадка': ['guards', 'landing'],
  'Урна': ['bin'], 'Корпус (ёмкость)': ['bin'],
  'Турник': ['bars'], 'Брусья': ['bars'], 'Шведская стенка': ['bars'], 'Рукоход': ['bars', 'landing'],
  'Горка': ['landing'], 'Качели': ['landing'], 'Карусель': ['landing'], 'Балансир': ['landing'], 'Канатная сеть': ['landing'],
};
const ORDER = ['bolts', 'welds', 'metal', 'wood', 'concrete', 'anchors', 'freestanding', 'moving', 'walkable', 'atTree', 'users', 'guards', 'bin', 'bars', 'landing'];
const split = (v) => String(v ?? '').split(/[,;\s]+/).filter(Boolean);

/** Чистая функция: записи справочника → строки плана { id, name, was, now, state }. */
function plan(rows) {
  const out = [];
  for (const [name, add] of Object.entries(TRAITS)) {
    const r = rows.find((x) => x.name === name);
    if (!r) { out.push({ name, add, state: 'missing' }); continue; }
    const was = split(r.traits);
    const now = ORDER.filter((c) => was.includes(c) || add.includes(c));
    const extra = was.filter((c) => !ORDER.includes(c)); // чужие коды не теряем
    const same = now.length === was.length && extra.length === 0;
    out.push({ id: r._id, name, was: was.join(', '), now: [...now, ...extra].join(', '), state: same ? 'same' : 'ok' });
  }
  return out;
}

module.exports = { TRAITS, plan };

if (!module.parent && !process.env.JEST_WORKER_ID) (async () => {
  const apply = process.argv.includes('--apply');
  const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  try {
    const db = client.db(process.env.MONGO_DB || 'datacore');
    const col = db.collection('dict_values');
    const rows = await col.find({ dict: 'passportElements', deletedAt: null }).project({ name: 1, traits: 1 }).toArray();
    const p = plan(rows);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    for (const x of p) console.log(`${x.state === 'ok' ? '  +' : '  ·'} ${x.name.padEnd(24)} ${x.state === 'missing' ? '⚠ нет такого вида — пропуск (признаки: ' + x.add.join(', ') + ')' : x.state === 'same' ? 'уже стоит: ' + x.now : (x.was || '(пусто)') + ' → ' + x.now}`);
    const todo = p.filter((x) => x.state === 'ok');
    console.log(`\nк записи ${todo.length} из ${p.length}`);
    if (!apply) { console.log('ПЛАН. Запись — только с --apply.'); return; }
    console.log('ОТКАТ (сохранить): ' + JSON.stringify(todo.map((x) => ({ id: String(x.id), traits: x.was }))));
    for (const x of todo) await col.updateOne({ _id: x.id }, { $set: { traits: x.now, updatedAt: new Date() } });
    console.log('записано: ' + todo.length);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
