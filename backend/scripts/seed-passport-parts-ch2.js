/* ПЧ-2 (2026-10-30): недостающие части изделия и сортамент — аудит AUDIT-PASSPORT-PARTS §4.1–4.2.
 * Только добавляет (по имени / material+name); существующие не трогает.
 *
 *   План:     MONGO_URI=… [MONGO_DB=datacore] node scripts/seed-passport-parts-ch2.js
 *   Записать: … --apply
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, 'е');

// ─── Новые части изделия ──────────────────────────────────────────────────────
// Поля: name, genSingular, genPlural
const NEW_PARTS = [
  { name: 'Диск-отягощение',       genSingular: 'диска-отягощения',       genPlural: 'дисков-отягощений' },
  { name: 'Весовой стек',           genSingular: 'весового стека',          genPlural: 'весовых стеков' },
  { name: 'Дуга',                   genSingular: 'дуги',                   genPlural: 'дуг' },
  { name: 'Зацеп',                  genSingular: 'зацепа',                 genPlural: 'зацепов' },
  { name: 'Ферма',                  genSingular: 'фермы',                  genPlural: 'ферм' },
  { name: 'Кольцо баскетбольное',   genSingular: 'кольца баскетбольного',  genPlural: 'колец баскетбольных' },
  { name: 'Механизм натяжения',     genSingular: 'механизма натяжения',    genPlural: 'механизмов натяжения' },
  { name: 'Стакан',                 genSingular: 'стакана',                genPlural: 'стаканов' },
  { name: 'Прут',                   genSingular: 'прута',                  genPlural: 'прутьев' },
  { name: 'Рейка',                  genSingular: 'рейки',                  genPlural: 'реек' },
  { name: 'Калитка',                genSingular: 'калитки',                genPlural: 'калиток' },
];

// ─── Новые позиции сортамента ─────────────────────────────────────────────────
// Поля: material (код passportMaterials), name (размер), incomplete (без стенки = true)
const NEW_SORTAMENT = [
  // Трубы стальные круглые
  { material: 'PIPE_STEEL',         name: '∅40×3,2',   incomplete: false },
  { material: 'PIPE_STEEL',         name: '∅25×2,8',   incomplete: false },
  { material: 'PIPE_STEEL',         name: '∅33,7×2,8', incomplete: false },
  // Труба нержавеющая
  { material: 'PIPE_STAINLESS',     name: '∅33,7×3',   incomplete: false },
  // Профильная труба — новые полные размеры
  { material: 'PIPE_STEEL_PROFILE', name: '40×20×2',   incomplete: false },
  { material: 'PIPE_STEEL_PROFILE', name: '60×40×2',   incomplete: false },
  // Профиль 80×80 — неполный (без стенки; 13 паспортов)
  { material: 'PIPE_STEEL_PROFILE', name: '80×80',      incomplete: true },
  // Двутавр / тавр — из текстов «тавр 100×200», «двутавр 100×200»
  { material: 'BEAM_STEEL',         name: '100×200',   incomplete: false },
  // Лист стальной 14 мм (опорные пятки)
  { material: 'SHEET_STEEL',        name: '14',         incomplete: false },
];

(async () => {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
  const cl = await MongoClient.connect(uri);
  try {
    const db = cl.db(process.env.MONGO_DB || 'datacore');
    const dv = db.collection('dict_values');
    const now = new Date();
    const base = { deletedAt: null, createdAt: now, updatedAt: now };

    // Текущие части (включая удалённые — не дублируем)
    const existingParts = await dv.find({ dict: 'passportParts' }).project({ name: 1, deletedAt: 1 }).toArray();
    const existNames = new Set(existingParts.map((d) => norm(d.name)));

    // Текущий сортамент
    const existingSortament = await dv.find({ dict: 'passportSortament' }).project({ name: 1, material: 1, deletedAt: 1 }).toArray();
    const existSortKeys = new Set(existingSortament.map((d) => norm(d.material) + '|' + norm(d.name)));

    const addParts = NEW_PARTS.filter((p) => !existNames.has(norm(p.name)));
    const addSort = NEW_SORTAMENT.filter((s) => !existSortKeys.has(norm(s.material) + '|' + norm(s.name)));

    console.log(`${apply ? '== ЗАПИСЬ ==' : '== ПЛАН (ничего не пишем) =='}`);

    console.log(`\nЧасти изделия — добавить ${addParts.length} (из ${NEW_PARTS.length} новых):`);
    for (const p of NEW_PARTS) console.log(`  ${addParts.includes(p) ? '+' : '= уже есть'} ${p.name}`);

    console.log(`\nСортамент — добавить ${addSort.length} (из ${NEW_SORTAMENT.length} новых):`);
    for (const s of NEW_SORTAMENT) console.log(`  ${addSort.includes(s) ? '+' : '= уже есть'} ${s.material} ${s.name}${s.incomplete ? ' (неполный)' : ''}`);

    console.log('\n⚠ Очистить вручную через админку (объединить → удалить):');
    console.log('  «наполнение» (мусор) → удалить');
    console.log('  «фланец» (строчная) и «Фланцы» → объединить в «Опорная пятка»');
    console.log('  «Рама» → объединить в «Несущая рама»');
    console.log('  «Ручка» + «Рукоять» (если есть) → одна «Ручка»');
    console.log('  Сортамент: «∅33.5х2.8» (точка) = «∅33,5×2,8» — объединить через passport-dicts-cleanup.js');
    console.log('  Сортамент: «40×80×2» и «80×40×2» — одно правило (больше×меньше); запустить passport-dicts-cleanup.js');

    if (apply) {
      let partsAdded = 0, sortAdded = 0;
      if (addParts.length) {
        const r = await dv.insertMany(addParts.map((p) => ({ dict: 'passportParts', name: p.name, genSingular: p.genSingular, genPlural: p.genPlural, ...base })));
        partsAdded = r.insertedCount;
      }
      if (addSort.length) {
        const r = await dv.insertMany(addSort.map((s) => ({ dict: 'passportSortament', name: s.name, material: s.material, incomplete: s.incomplete ?? false, ...base })));
        sortAdded = r.insertedCount;
      }
      console.log(`\nЗаписано: частей +${partsAdded}, сортамент +${sortAdded}`);
    } else {
      console.log('\nДля записи добавьте флаг --apply');
    }
  } finally {
    await cl.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
