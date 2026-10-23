/* Справочники из данных (SPR-1, SPR-2): «Сортамент / сечение» (metalAssortments) и «Марки стали» (steelGrades) — из materials;
 * «Формы оплаты» (paymentForms) — из incomes.paymentForm; «Цвета» (colors) — из incomes.color и supplyrequests.color.
 * Берёт уникальные непустые значения (без учёта регистра и пробелов, ё = е; из вариантов написания — самое частое),
 * добавляет в справочник недостающие. Существующие записи и сами данные не трогает.
 * Хранилище: dict_values; «Цвета» — color_references (общая с CRM, добавляются только новые записи).
 * НА ПРОДЕ — запускает координатор.
 *
 *   План (ничего не меняет):  MONGO_URI=… [MONGO_DB=…] node scripts/seed-metal-dicts.js
 *   Записать:                 … --apply
 *   Только часть справочников: … --only=paymentForms
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

// справочник → откуда брать значения: [коллекция, поле]
const DICTS = [
  ['metalAssortments', [['materials', 'assortment']]],
  ['steelGrades', [['materials', 'materialGrade']]],
  ['paymentForms', [['incomes', 'paymentForm']]],
  // цвета — только типовые: в заказах/заявках «цвет» — длинные описания покраски, в справочник их не кладём (решение пользователя 2026-10-23, СП-3)
  ['colors', []],
];
// типовые значения (решение пользователя 2026-10-23, СП-2/СП-3); уже имеющиеся (без учёта регистра/пробелов/ё) не добавляются
const DEFAULTS = {
  paymentForms: ['б/р', 'б/р 30%', 'б/р 50%', 'нал'],
  steelGrades: ['Ст3сп', 'Ст3пс', '09Г2С', 'Ст20', 'Ст45', '40Х', '65Г', 'AISI 201', 'AISI 304', 'AISI 316', 'AISI 430', '12Х18Н10Т'],
  metalAssortments: [
    ...['20×20×2', '25×25×2', '30×30×2', '40×20×2', '40×40×2', '50×25×2', '50×50×3', '60×30×2', '60×40×2', '60×60×3', '80×40×3', '80×80×3', '100×100×4'].map((x) => 'Труба ' + x),
    ...['Ø20×2', 'Ø25×2,8', 'Ø32×3,2', 'Ø42×3', 'Ø57×3,5', 'Ø76×3,5'].map((x) => 'Труба ' + x),
    ...['1', '1,5', '2', '3', '4', '5', '6', '8', '10'].map((x) => `Лист ${x} мм`),
    'Уголок 25×25×4', 'Уголок 40×40×4', 'Уголок 50×50×5', 'Швеллер 10', 'Швеллер 12', 'Полоса 40×4', 'Круг 10', 'Круг 12', 'Круг 16', 'Арматура А500С 10', 'Арматура А500С 12',
  ],
  colors: [
    'RAL 9005 чёрный', 'RAL 9003 белый', 'RAL 9016 белый', 'RAL 7016 антрацит', 'RAL 7024 графит', 'RAL 7035 светло-серый', 'RAL 5005 синий', 'RAL 5010 синий',
    'RAL 6005 зелёный мох', 'RAL 6018 жёлто-зелёный', 'RAL 6029 зелёный', 'RAL 3020 красный', 'RAL 3014 розовый', 'RAL 2004 оранжевый', 'RAL 1021 жёлтый', 'RAL 1023 жёлтый', 'RAL 8017 шоколадный',
    'Белый', 'Чёрный', 'Серый', 'Красный', 'Синий', 'Зелёный', 'Жёлтый', 'Оранжевый', 'Коричневый', 'Оцинковка (без покраски)',
  ],
};
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
// ключ сравнения: регистр и ё не различаем, повторные пробелы схлопнуты
const key = (v) => clean(v).toLowerCase().replace(/ё/g, 'е');
// как translit в dicts.defs.ts: кириллица → латиница, чтобы slug был читаемым
const translit = (t) => t.toLowerCase().replace(/[а-яё]/g, (c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' })[c] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  const apply = process.argv.includes('--apply');
  console.log(`База ${db.databaseName}${apply ? '' : ' (план)'}`);
  // --only=paymentForms,steelGrades — только эти справочники (цвета в данных — длинные описания покраски, их в «Цвета» не класть)
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  for (const [dict, sources] of DICTS) {
    if (only.length && !only.includes(dict)) continue;
    const groups = new Map(); // ключ → { total, best, bestN }
    // обычные значения справочника (как PAYMENT_FORMS в dicts.defs.ts): без них непустой справочник «потеряет» их в списке заказа
    for (const name of DEFAULTS[dict] || []) groups.set(key(name), { total: 0, best: name, bestN: 0 });
    for (const [coll, field] of sources) {
      // написание → сколько записей
      const rows = await db.collection(coll).aggregate([
        { $match: { deletedAt: null, [field]: { $type: 'string', $nin: ['', null] } } },
        { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      ]).toArray();
      for (const r of rows) {
        const name = clean(r._id); if (!name) continue;
        const k = key(name), g = groups.get(k) || { total: 0, best: name, bestN: 0 };
        g.total += r.n;
        if (r.n > g.bestN) { g.best = name; g.bestN = r.n; }
        groups.set(k, g);
      }
    }
    const isColors = dict === 'colors';
    const c = db.collection(isColors ? 'color_references' : 'dict_values');
    const have = new Set((await c.find(isColors ? { deletedAt: null } : { dict, deletedAt: null }, { projection: { name: 1 } }).toArray()).map((d) => key(d.name)));
    const add = [...groups.entries()].filter(([k]) => !have.has(k)).map(([, g]) => g).sort((a, b) => b.total - a.total || a.best.localeCompare(b.best, 'ru'));
    console.log(`\n${dict} (${sources.map(([k, f]) => `${k}.${f}`).join(', ')}): в данных ${groups.size}, в справочнике ${have.size}, добавить ${add.length}`);
    for (const g of add.slice(0, 200)) console.log(`  ${g.best}  (${g.total})`);
    if (add.length > 200) console.log(`  … и ещё ${add.length - 200}`);
    if (apply && add.length) {
      const now = new Date();
      const docs = add.map((g, i) => isColors
        ? { name: g.best, slug: `${translit(g.best) || 'color'}-${Date.now().toString(36)}${i}`, isActive: true, isSystem: false, deletedAt: null, createdAt: now, updatedAt: now }
        : { dict, name: g.best, deletedAt: null, createdAt: now, updatedAt: now });
      const r = await c.insertMany(docs);
      console.log(`Добавлено: ${r.insertedCount}`);
    }
  }
  if (!apply) console.log('\nНичего не записано (план). Записать: --apply');
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
