/* Справочник «Паспорта → Категории паспортов» (БЗ-6 Э2a, docs/PASSPORTS-V2.md §3.2): начальные записи в dict_values
 * (dict: passportCategories). Только добавляет недостающие (по коду), существующие не трогает. НА ПРОДЕ — только после «да» пользователя.
 *
 *   План (ничего не меняет):  MONGO_URI=… [MONGO_DB=…] node scripts/seed-passport-categories.js
 *   Записать:                 … --apply
 *
 * Соответствие с категориями каталога и сроки службы — «принято по умолчанию» (TASKS БЗ-6), на проверку пользователю. */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

/** Обязательные поля по категориям (Э9) — по строке ключ поля паспорта; как V2_REQUIRED_FIELDS в passport-rules.ts. */
const REQUIRED = {
  DIO: 'ageFrom\nageTo\nmaxUsers\nfallHeight\nsiteLength\nsiteWidth\nserviceLifeYears',
  DSP: 'ageFrom\nmaxUsers\nsiteLength\nsiteWidth\nserviceLifeYears',
  TRN: 'heightMin\nweightMax\nmaxUsers\nsiteLength\nsiteWidth\nserviceLifeYears',
  WRK: 'maxUsers\nsiteLength\nsiteWidth\nserviceLifeYears',
  MAF: 'serviceLifeYears',
};

const ROWS = [
  { code: 'ALL', name: 'Для всех', catalogNames: '', standards: 'GOST_R_2_610', serviceLifeYears: '', warrantyMonths: '12', requiredImages: '', extraSections: 'Гарантия, хранение, перевозка, утилизация, журналы' },
  { code: 'DIO', name: 'Детское игровое оборудование', catalogNames: 'Детский игровой комплекс, Качели, Карусель', standards: 'TR_EAEU_042, GOST_34614_1, GOST_34615, GOST_R_52301', serviceLifeYears: '10', warrantyMonths: '12',
    requiredImages: 'overview\ndimensions\nsafety_zone\nfoundation\nholes\nassembly (если разборное)', extraSections: 'Идентификационные сведения (при наличии сертификата), ограничения, элементы, правила пользования, ТО по периодам, ремонт, монтаж, свидетельство о приёмке' },
  { code: 'DSP', name: 'Детское спортивное оборудование', catalogNames: '', standards: 'GOST_R_55677, GOST_R_55678, GOST_R_55679', serviceLifeYears: '10', warrantyMonths: '12',
    requiredImages: 'overview\ndimensions\nsafety_zone\nfoundation', extraSections: 'Ограничения (возраст 7+), элементы, правила пользования, ТО' },
  { code: 'TRN', name: 'Уличный тренажёр', catalogNames: 'Уличный тренажёр', standards: 'GOST_R_57538', serviceLifeYears: '10', warrantyMonths: '12',
    requiredImages: 'overview\ndimensions\nsafety_zone\nfoundation', extraSections: 'Ограничения (рост пользователя), правила пользования и упражнения, ТО подвижных узлов' },
  { code: 'WRK', name: 'Воркаут и спортивное оборудование', catalogNames: 'Воркаут, Спортивное оборудование', standards: 'GOST_R_55678, GOST_R_55677', serviceLifeYears: '10', warrantyMonths: '12',
    requiredImages: 'overview\ndimensions\nsafety_zone\nfoundation', extraSections: 'Элементы, правила пользования, ТО' },
  { code: 'MAF', name: 'Благоустройство', catalogNames: 'Благоустройство, МАФ', // МАФ — прежнее название в каталоге (решение 2026-10-23: МАФ = благоустройство)
    standards: 'GOST_R_2_610', serviceLifeYears: '5', warrantyMonths: '12',
    requiredImages: 'overview\ndimensions', extraSections: 'Короткий: описание, монтаж, уход, гарантия' },
];

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  const c = db.collection('dict_values');
  const have = new Set((await c.find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1 } }).toArray()).map((d) => d.code));
  // Э9: обязательные поля — дописать существующим записям, где поле пустое (заполненное пользователем не трогаем)
  const fill = (await c.find({ dict: 'passportCategories', deletedAt: null, $or: [{ requiredFields: null }, { requiredFields: '' }, { requiredFields: { $exists: false } }] }, { projection: { code: 1 } }).toArray()).filter((d) => REQUIRED[d.code]);
  console.log(`Обязательные поля: дописать ${fill.length}${fill.length ? ': ' + fill.map((d) => d.code).join(', ') : ''}`);
  if (process.argv.includes('--apply')) for (const d of fill) await c.updateOne({ _id: d._id }, { $set: { requiredFields: REQUIRED[d.code], updatedAt: new Date() } });
  const add = ROWS.filter((r) => !have.has(r.code));
  console.log(`База ${db.databaseName}: категорий есть ${have.size}, добавить ${add.length}${add.length ? ': ' + add.map((r) => r.code).join(', ') : ''}`);
  if (process.argv.includes('--apply') && add.length) {
    const now = new Date();
    const r = await c.insertMany(add.map((x) => ({ dict: 'passportCategories', ...x, requiredFields: REQUIRED[x.code] || '', deletedAt: null, createdAt: now, updatedAt: now })));
    console.log(`Добавлено: ${r.insertedCount}`);
  } else if (add.length) console.log('Ничего не записано (план). Записать: --apply');
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
