#!/usr/bin/env node
/**
 * ИЗ-21 (C093): изделия, у которых ручная категория паспорта не совпадает с категорией группы.
 * По умолчанию — только план. Запись — только `--apply` (после «да» владельца).
 *   MONGO_URI=… MONGO_DB=… node backend/scripts/iz21-regroup.js [--apply] [--out откат.json] [--with-disputed]
 *   На проде: bash remote-access/run-script.sh iz21-regroup [--apply] (без --out откат печатается в вывод).
 *   node backend/scripts/iz21-regroup.js --dump папка   (план без базы: в папке items.json + cats.json)
 * Действия: move — перенести в группу `to` (ручная категория снимается, если равна категории новой группы);
 *           fix  — поставить ручную категорию `to` (если равна категории группы — снять);
 *           disp — спорно: пишется только с --with-disputed.
 * Удалений нет. Перед записью проверяется, что «было» совпадает с базой; --out пишет откат.
 */
const fs = require('fs');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const has = (n) => process.argv.includes(n);

// артикул → [действие, куда, уверенность, причина]. Данные прода на 2026-11-12.
const D = {
  // (а) не та группа
  '1224': ['move', 'Информационные стенды и указатели', 'высокая', 'информационный стенд лежит в Воркауте'],
  '23_1': ['move', 'Информационные стенды и указатели', 'высокая', 'стела лежит в Тренажёрах'],
  '3_5_12': ['move', 'Воркаут', 'высокая', 'воркаут-комплекс лежит в Тренажёрах'],
  '3_2_11': ['move', 'Воркаут', 'высокая', 'скамья для пресса «воркаут» лежит в Скамьях'],
  '3_2_3': ['move', 'Воркаут', 'высокая', 'воркаут-скамья лежит в Скамьях'],
  // (б) группа верна, ручная категория не та
  '1269': ['fix', 'WRK', 'высокая', 'гимнастическая скамья воркаута'],
  '1268': ['fix', 'WRK', 'высокая', 'гимнастическая скамья воркаута'],
  '1267': ['fix', 'WRK', 'высокая', 'гимнастическая скамья воркаута'],
  '1246': ['fix', 'WRK', 'высокая', 'скамья для пресса'],
  '1245': ['fix', 'WRK', 'высокая', 'скамья для пресса'],
  '1244': ['fix', 'WRK', 'высокая', 'скамья для пресса'],
  '1225': ['fix', 'WRK', 'высокая', 'столбики для отжиманий'],
  '3_2_2': ['fix', 'WRK', 'высокая', 'скамья для пресса'],
  'ПС-F4D83A': ['fix', 'WRK', 'высокая', 'Воркаут ВС-70 в группе Воркаут'],
  '3408': ['fix', 'BLG', 'высокая', 'парковая скамья'],
  '3307': ['fix', 'BLG', 'высокая', 'ограждение'],
  '21_7': ['fix', 'DIO', 'высокая', 'детская площадка'],
  '21_6': ['fix', 'DIO', 'высокая', 'детская горка'],
  '21_5': ['fix', 'DIO', 'высокая', 'детский игровой комплекс'],
  '21_1': ['fix', 'DIO', 'высокая', 'детский игровой комплекс'],
  '22_1': ['fix', 'DIO', 'высокая', 'качалка на пружине'],
  '11_8': ['fix', 'DIO', 'высокая', 'детская качель-гнездо'],
  '11_4': ['fix', 'DIO', 'высокая', 'качалка-балансир'],
  'ПС-00806A': ['fix', 'DIO', 'высокая', 'карусель'],
  '1004': ['fix', 'TRN', 'средняя', '«Брусья жим» — тренажёр'],
  // решено владельцем 2026-11-12
  // Качели 3205, 3206, 3208, 3209, 3213, 3217 НЕ трогать: владелец поменяет вручную позже вместе с PDM (в плане их нет).
  '1125': ['fix', 'WRK', 'высокая', 'решение владельца: остаётся в «Спорт оборудование», категория от группы'],
  '1117': ['fix', 'WRK', 'высокая', 'решение владельца: остаётся в «Спорт оборудование», категория от группы'],
  '1116': ['fix', 'WRK', 'высокая', 'решение владельца: остаётся в «Спорт оборудование», категория от группы'],
  '1115': ['fix', 'WRK', 'высокая', 'решение владельца: остаётся в «Спорт оборудование», категория от группы'],
  '1114': ['fix', 'WRK', 'высокая', 'решение владельца: остаётся в «Спорт оборудование», категория от группы'],
  '1113': ['fix', 'WRK', 'высокая', 'решение владельца: остаётся в «Спорт оборудование», категория от группы'],
  '1112': ['fix', 'WRK', 'высокая', 'решение владельца: остаётся в «Спорт оборудование», категория от группы'],
  '1108': ['fix', 'WRK', 'высокая', 'решение владельца: остаётся в «Спорт оборудование», категория от группы'],
  '1106': ['fix', 'WRK', 'высокая', 'решение владельца: остаётся в «Спорт оборудование», категория от группы'],
  '11_12': ['move', 'Качели городские', 'высокая', 'решение владельца: городские, группа 41'],
  '11_11': ['move', 'Качели городские', 'высокая', 'решение владельца: городские, группа 41'],
  '11_5': ['move', 'Качели городские', 'высокая', 'решение владельца: городские, группа 41'],
};

async function load() {
  const dump = arg('--dump');
  if (dump) {
    const items = JSON.parse(fs.readFileSync(dump + '/items.json', 'utf8'));
    const cats = JSON.parse(fs.readFileSync(dump + '/cats.json', 'utf8'));
    return {
      items: items.map((p) => ({ _id: p._id, sku: String(p.sku), name: p.name, cat: p.categoryId && String(p.categoryId.id || p.categoryId), pc: (p.passportDefaults || {}).passportCategory || '' })),
      cats: cats.map((c) => ({ _id: c.id, name: c.name, parentId: c.parentId, groupNo: c.groupNo, pc: c.passportCategory || '' })),
      db: null,
    };
  }
  const path = require('path');
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  const db = client.db(process.env.MONGO_DB || 'datacore');
  const cats = (await db.collection('categories').find({ type: 'product', deletedAt: null }).toArray())
    .map((c) => ({ _id: String(c._id), name: c.name, parentId: c.parentId && String(c.parentId), groupNo: c.groupNo, pc: c.passportCategory || '' }));
  const items = (await db.collection('products').find({ deletedAt: null }).toArray())
    .map((p) => ({ _id: String(p._id), raw: p._id, sku: String(p.sku), name: p.name, cat: p.categoryId && String(p.categoryId), pc: (p.passportDefaults || {}).passportCategory || '' }));
  return { items, cats, db, client, ObjectId };
}

function buildPlan({ items, cats }) {
  const byId = new Map(cats.map((c) => [c._id, c]));
  const leaf = (n) => cats.find((c) => c.name === n && c.parentId);
  return items.filter((p) => D[p.sku]).map((p) => {
    const [act, to, conf, why] = D[p.sku];
    const g = byId.get(p.cat);
    const row = { sku: p.sku, name: p.name, _id: p._id, act, conf, why, group: g && g.name, was: { cat: p.cat, pc: p.pc } };
    if (act === 'move') {
      const t = leaf(to);
      if (!t) throw new Error('нет группы: ' + to);
      row.toGroup = t.name; row.newCat = t._id; row.newPc = p.pc === t.pc ? '' : p.pc;
    } else {
      row.newCat = p.cat; row.toPc = to; row.newPc = g && g.pc === to ? '' : to;
    }
    return row;
  });
}

// (г) правило владельца: первые две цифры артикула = номер группы (groupNo). Артикулы без двух цифр в начале пропускаются.
function byArticle({ items, cats }) {
  const byId = new Map(cats.map((c) => [c._id, c]));
  const byNo = new Map(cats.filter((c) => c.groupNo).map((c) => [String(c.groupNo), c]));
  const out = { rows: [], skipped: 0, ok: 0 };
  for (const p of items) {
    const m = p.sku.match(/^(\d{2})/);
    if (!m) { out.skipped++; continue; }
    const g = byId.get(p.cat);
    if (g && String(g.groupNo) === m[1]) { out.ok++; continue; }
    const t = byNo.get(m[1]);
    out.rows.push({ sku: p.sku, name: p.name, _id: p._id, group: g && g.name, groupNo: g && g.groupNo, was: { cat: p.cat, pc: p.pc }, toGroup: t && t.name, toNo: m[1], newCat: t && t._id, newPc: t && p.pc === t.pc ? '' : p.pc, act: 'move' });
  }
  return out;
}

(async () => {
  const L = await load();
  if (has('--by-article')) {
    const r = byArticle(L);
    for (const x of r.rows) console.log(`${x.sku.padEnd(16)} ${String(x.name).slice(0, 36).padEnd(36)} лежит в ${x.group} (${x.groupNo}) -> должно быть ${x.toNo} ${x.toGroup || 'ТАКОЙ ГРУППЫ НЕТ'}`);
    const movable = r.rows.filter((x) => x.newCat && !D[x.sku]);
    console.log(`
совпало ${r.ok}, не совпало ${r.rows.length} (есть целевая группа: ${movable.length}), без двух цифр в начале ${r.skipped}`);
    console.log('ОТЧЁТ. Ничего не пишется: «NN_k» часто старая нумерация. Применять по артикулу нельзя.'); if (L.client) await L.client.close(); return;
  }
  const plan = buildPlan(L);
  const doApply = has('--apply'), withDisp = has('--with-disputed');
  const todo = plan.filter((r) => r.act !== 'disp' || withDisp);
  for (const r of plan) {
    const target = r.toGroup ? 'в группу «' + r.toGroup + '»' : 'категория ' + r.toPc;
    console.log(`${r.act.padEnd(4)} ${r.sku.padEnd(10)} ${String(r.name).slice(0, 40).padEnd(40)} ${r.group} [${r.was.pc}] -> ${target}${r.newPc === '' ? ' (ручная снимается)' : ''}${todo.includes(r) ? '' : '  · не пишется (спорно)'}`);
  }
  const n = (a) => plan.filter((r) => r.act === a).length;
  console.log(`\nвсего ${plan.length}: перенос ${n('move')}, исправить категорию ${n('fix')}, спорно ${n('disp')}`);
  if (!doApply) { console.log('ПЛАН. Запись — только с --apply.'); return; }
  if (!L.db) throw new Error('--apply нужна база (MONGO_URI), не --dump');
  const bad = todo.filter((r) => { const p = L.items.find((x) => x._id === r._id); return !p || p.cat !== r.was.cat || p.pc !== r.was.pc; });
  if (bad.length) throw new Error('база изменилась, «было» не совпало: ' + bad.map((r) => r.sku).join(', '));
  const undo = JSON.stringify(todo.map((r) => ({ _id: r._id, sku: r.sku, categoryId: r.was.cat, passportCategory: r.was.pc })), null, 1);
  if (arg('--out')) fs.writeFileSync(arg('--out'), undo); else console.log('ОТКАТ (сохранить): ' + undo.replace(/s+/g, ' '));
  const col = L.db.collection('products');
  for (const r of todo) {
    const p = L.items.find((x) => x._id === r._id);
    const set = { updatedAt: new Date() };
    if (r.act === 'move') set.categoryId = new L.ObjectId(r.newCat);
    const upd = { $set: set };
    if (r.newPc) set['passportDefaults.passportCategory'] = r.newPc; else upd.$unset = { 'passportDefaults.passportCategory': '' };
    await col.updateOne({ _id: p.raw }, upd);
  }
  console.log('записано: ' + todo.length);
  await L.client.close();
})().catch((e) => { console.error(e.message); process.exit(2); });
