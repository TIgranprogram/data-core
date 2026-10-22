/* П-10 (БЗ-6 Э9.6): перенос подобранных текстов старых паспортов в справочники «Паспорта» — по решению пользователя
 * 2026-10-22 («да» на docs/PASSPORTS-TEXTS-SELECTION.md: 1.1–1.4 и 2.1–2.10; 1.5 и материалы 3.1 — не переносим).
 * Только добавляет: первую строку «Текста монтажа» у способов установки (если её ещё нет), новый способ FENCE_POSTS,
 * новые функциональные элементы (по коду, существующие не трогает). Запускать после seed-passport-dicts.js.
 *
 *   План (ничего не меняет):  MONGO_URI=… [MONGO_DB=…] node scripts/passport-texts-transfer.js
 *   Записать:                 … --apply
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const L = (...a) => a.join('\n');
// 1.1–1.3: первая строка текста монтажа (формулировка из паспортов, ё исправлена)
const INTRO = {
  EMBEDDED: 'Изделие устанавливается на открытых спортивных площадках и дворовых территориях методом бетонирования закладных деталей.',
  CONCRETE_POSTS: 'Изделие устанавливается на подготовленной ровной поверхности методом бетонирования опорных стоек в грунт.',
  ANCHORS: 'Изделие устанавливается в местах общественного пользования с креплением анкерными болтами к твёрдому основанию.',
};
// 1.4: новый способ установки
const INSTALL_NEW = [{
  code: 'FENCE_POSTS', name: 'Ограждение на опорных стойках',
  montage: L('Изделие устанавливается по периметру спортивных площадок с фиксацией к опорным стойкам.', 'Разметить линию ограждения и места стоек по схеме', 'Забетонировать опорные стойки, выставив их по уровню и шагу секций', 'После набора прочности бетона закрепить секции к стойкам штатным крепежом'),
  baseRequirements: L('Грунт без пучения, с отведением воды', 'Шаг стоек — по ширине секций'),
  requiredImages: L('dimensions', 'holes'),
}];
// 2.1–2.10: новые функциональные элементы (назначение — из старых паспортов)
const ELEMENTS_NEW = [
  { code: 'BASKETBALL_STAND', name: 'Баскетбольная стойка', categories: 'WRK, TRN', inDescription: 'стойка с баскетбольным щитом и кольцом', purpose: 'Предназначено для игры в баскетбол.' },
  { code: 'VOLLEYBALL_POSTS', name: 'Волейбольные стойки', categories: 'WRK', inDescription: 'стойки для натяжения волейбольной сетки', purpose: 'Предназначено для игры в волейбол.' },
  { code: 'MINI_FOOTBALL_GOAL', name: 'Ворота для мини-футбола', categories: 'WRK', inDescription: 'ворота для мини-футбола', purpose: 'Предназначено для игры в мини-футбол.' },
  { code: 'FENCE', name: 'Ограждение площадки', categories: 'MAF', inDescription: 'секции ограждения на опорных стойках', purpose: 'Предназначено для ограждения территории спортивных и игровых площадок.' },
  { code: 'LITTER_BIN', name: 'Урна', categories: 'MAF', inDescription: 'урна для мусора', purpose: 'Предназначено для сбора мелкого мусора в общественных зонах.' },
  { code: 'PERGOLA', name: 'Навес / пергола', categories: 'MAF', inDescription: 'навес на опорах', purpose: 'Предназначено для создания тени, зонирования пространства и организации зон отдыха.' },
  { code: 'LEG_TRAINER', name: 'Тренажёр для мышц ног и ягодиц', categories: 'TRN', inDescription: 'тренажёр для мышц ног и ягодиц', purpose: 'Предназначено для тренировки мышц ног и ягодиц.' },
  { code: 'CARDIO_TRAINER', name: 'Кардиотренажёр', categories: 'TRN', inDescription: 'кардиотренажёр с подвижными педалями', purpose: 'Предназначено для кардиотренировок и укрепления мышц ног.' },
  { code: 'CHEST_BACK_TRAINER', name: 'Тренажёр для мышц груди и спины', categories: 'TRN', inDescription: 'тренажёр для мышц груди и спины', purpose: 'Предназначено для тренировки мышц груди и спины.' },
  { code: 'TWISTER', name: 'Твистер', categories: 'TRN', inDescription: 'вращающаяся платформа-твистер', purpose: 'Предназначено для тренировки мышц бёдер и талии.' },
];

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  const c = db.collection('dict_values');
  const now = new Date();
  console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
  for (const [code, intro] of Object.entries(INTRO)) {
    const d = await c.findOne({ dict: 'passportInstall', code, deletedAt: null });
    if (!d) { console.log(`  ${code}: нет в справочнике — сначала seed-passport-dicts.js`); continue; }
    const cur = String(d.montage || '');
    if (cur.split('\n')[0].trim() === intro) { console.log(`  ${code}: строка уже есть`); continue; }
    console.log(`  ${code}: добавить первую строку текста монтажа`);
    if (apply) await c.updateOne({ _id: d._id }, { $set: { montage: cur ? `${intro}\n${cur}` : intro, updatedAt: now } });
  }
  for (const [dict, rows] of [['passportInstall', INSTALL_NEW], ['passportElements', ELEMENTS_NEW]]) {
    const have = new Set((await c.find({ dict, deletedAt: null }, { projection: { code: 1 } }).toArray()).map((d) => d.code));
    const add = rows.filter((r) => !have.has(r.code));
    console.log(`  ${dict}: добавить ${add.length}${add.length ? ' — ' + add.map((r) => r.code).join(', ') : ''}`);
    if (apply && add.length) await c.insertMany(add.map((r) => ({ dict, ...r, deletedAt: null, createdAt: now, updatedAt: now })));
  }
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
