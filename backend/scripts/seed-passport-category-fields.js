/* ПК (2026-10-23): справочник «Категории паспортов» — какие поля «Ограничений и техданных» бывают у категории,
 * подсказки к ним (только про эту категорию) и значения по умолчанию. Заполняет ТОЛЬКО пустые поля, своё не трогает.
 * Решения по умолчанию (на проверку пользователю): возраст и высота падения — только у детских (DIO, DSP); у тренажёров
 * и воркаута — рост, вес, пользователи, площадка; у благоустройства — пользователи (места), площадка, срок службы.
 *
 *   План:      MONGO_URI=… [MONGO_DB=…] node scripts/seed-passport-category-fields.js
 *   Записать:  … --apply
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
const L = (...a) => a.join('\n');

const FIELDS = {
  TRN: {
    allowedFields: L('heightMin', 'heightMax', 'weightMax', 'maxUsers', 'siteLength', 'siteWidth', 'serviceLifeYears'),
    fieldHints: L('heightMin — с какого роста можно заниматься; обычно от 1400 мм', 'weightMax — обычно до 120–150 кг', 'maxUsers — сколько человек занимаются одновременно',
      'siteLength — площадка вместе с зоной безопасности', 'serviceLifeYears — обычно 10 лет'),
    fieldDefaults: L('heightMin — 1400', 'weightMax — 120'),
  },
  WRK: {
    allowedFields: L('heightMin', 'heightMax', 'weightMax', 'maxUsers', 'siteLength', 'siteWidth', 'serviceLifeYears'),
    fieldHints: L('maxUsers — сколько человек занимаются одновременно', 'weightMax — допустимый вес занимающегося', 'siteLength — площадка вместе с зоной безопасности', 'serviceLifeYears — обычно 10 лет'),
    fieldDefaults: '',
  },
  BLG: {
    allowedFields: L('maxUsers', 'siteLength', 'siteWidth', 'serviceLifeYears'),
    fieldHints: L('maxUsers — для скамьи, беседки, стола — число мест', 'siteLength — место под изделие вместе с проходами', 'serviceLifeYears — обычно 5 лет'),
    fieldDefaults: '',
  },
  DIO: {
    allowedFields: L('ageFrom', 'ageTo', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears'),
    fieldHints: L('ageFrom — обычно от 3 лет', 'fallHeight — по проекту изделия', 'siteLength — площадка с зоной приземления', 'serviceLifeYears — обычно 10 лет'),
    fieldDefaults: L('ageFrom — 3'),
  },
  DSP: {
    allowedFields: L('ageFrom', 'ageTo', 'heightMin', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears'),
    fieldHints: L('ageFrom — обычно от 7 лет', 'siteLength — площадка вместе с зоной безопасности', 'serviceLifeYears — обычно 10 лет'),
    fieldDefaults: L('ageFrom — 7'),
  },
};

(async () => {
  const apply = process.argv.includes('--apply');
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const coll = db.collection('dict_values');
  let n = 0;
  for (const [code, f] of Object.entries(FIELDS)) {
    const d = await coll.findOne({ dict: 'passportCategories', code, deletedAt: null });
    if (!d) { console.log(`${code}: категории нет — пропуск`); continue; }
    const set = Object.fromEntries(Object.entries(f).filter(([k, v]) => v && !String(d[k] || '').trim()));
    console.log(`${code}: ${Object.keys(set).length ? 'заполнить ' + Object.keys(set).join(', ') : 'уже заполнено — не трогаем'}`);
    if (apply && Object.keys(set).length) { await coll.updateOne({ _id: d._id }, { $set: { ...set, updatedAt: new Date() } }); n++; }
  }
  console.log(apply ? `Записано категорий: ${n}` : 'Ничего не записано (план). Записать: --apply');
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
