#!/usr/bin/env node
/**
 * C107 (2026-11-13): виды изделий для смешанных групп и оставшихся однородных. Владелец: «заводи сразу как нужно».
 * Вид = тип паспорта + функциональные элементы + вариант «Назначения» — по смыслу справочников (элемент и назначение одного типа),
 * а не по названиям изделий. Изделиям смешанных групп («Тренажеры», «Воркаут», «Спорт оборудование», сборная «Благоустройство»)
 * вид НЕ ставится (было бы угадывание по названию) — его выбирает менеджер в анкете; список там — виды своего типа паспорта.
 * Вид по умолчанию получают только группы, однородные по смыслу (GROUP_KIND). Элементы и назначение ищутся по названию в
 * справочниках; не нашлось — вид без них (в плане видно). Идемпотентен: вид с тем же названием и типом не дублируется,
 * группа с видом не трогается.
 *
 *   MONGO_URI=… MONGO_DB=… node backend/scripts/c107-kinds-mixed.js [--apply]
 *   На проде: bash remote-access/run-script.sh c107-kinds-mixed [--apply]  (--apply сам делает бэкап)
 */
const path = require('path');

/** [название вида, тип паспорта, элементы, вариант назначения] */
const KINDS = [
  ['Кардиотренажёр', 'TRN', ['Кардиотренажёр'], 'Кардио'],
  ['Тренажёр для ног', 'TRN', ['Тренажёр для мышц ног и ягодиц'], 'Ноги'],
  ['Тренажёр для груди, плеч и рук', 'TRN', ['Тренажёр для мышц груди и спины'], 'Грудь, плечи, руки'],
  ['Тренажёр для спины', 'TRN', ['Тренажёр для мышц груди и спины'], 'Спина'],
  ['Тренажёр для пресса', 'TRN', ['Тренажёр с подвижными узлами'], 'Пресс'],
  ['Твистер', 'TRN', ['Твистер'], 'Разминка суставов'],
  ['Комплексный тренажёр', 'TRN', ['Тренажёр с подвижными узлами'], 'Комплексный'],
  ['Турник', 'WRK', ['Турник'], 'Турник, рукоход'],
  ['Брусья', 'WRK', ['Брусья'], 'Брусья'],
  ['Турник и брусья', 'WRK', ['Турник', 'Брусья'], 'Комплекс с собственным весом'],
  ['Рукоход', 'WRK', ['Рукоход'], 'Турник, рукоход'],
  ['Шведская стенка', 'WRK', ['Шведская стенка'], 'Шведская стенка'],
  ['Скамья для пресса', 'WRK', ['Скамья для пресса'], 'Гимнастика, пресс'],
  ['Комплекс воркаут', 'WRK', ['Турник', 'Брусья', 'Рукоход'], 'Комплекс с собственным весом'],
  ['Баскетбольная стойка', 'WRK', ['Баскетбольная стойка'], 'Баскетбол'],
  ['Волейбольные стойки', 'WRK', ['Волейбольные стойки'], 'Волейбол'],
  ['Ворота для мини-футбола', 'WRK', ['Ворота для мини-футбола'], 'Футбол'],
  ['Комплекс ГТО', 'WRK', [], 'Испытания ГТО'],
  ['Полоса препятствий', 'WRK', [], 'Полоса препятствий'],
  ['Кольца, канат, скалодром', 'WRK', [], 'Кольца, канат, скалодром'],
  ['Вазон, цветочница', 'BLG', ['Вазон / цветочница'], 'Озеленение'],
  ['Приствольная решётка', 'BLG', ['Приствольная решётка'], 'Озеленение'],
  ['Экотропа', 'BLG', ['Экотропа'], 'Прочее благоустройство'],
  ['Стол уличный', 'BLG', ['Стол уличный'], 'Отдых'],
  ['Качели городские', 'BLG', [], 'Отдых'],
  ['Геопластика', 'BLG', [], 'Прочее благоустройство'],
  ['Качалка-балансир', 'DIO', ['Балансир'], 'Игровое'],
  ['Качалка на пружине', 'DIO', [], 'Игровое'],
  ['Игровой комплекс', 'DIO', [], 'Игровое'],
];
/** Группы, однородные по смыслу: [название группы, вид]. */
const GROUP_KIND = [
  ['Столы', 'Стол уличный'],
  ['Качели городские', 'Качели городские'],
  ['Геопластика', 'Геопластика'],
  ['Качалка-балансир', 'Качалка-балансир'],
  ['Качалка на пружине', 'Качалка на пружине'],
  ['Детские игровые комплексы', 'Игровой комплекс'],
];

const norm = (v) => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const catsOf = (d) => String(d.categories ?? '').split(/[,;\s]+/).filter(Boolean);

/** Чистая функция плана. */
function buildPlan({ elements, phrases, kinds, groups, sections }) {
  const root = phrases.find((p) => p.section === 'purpose' && !p.parentId && !String(p.text ?? '').trim());
  const leaves = root ? phrases.filter((p) => String(p.parentId) === String(root._id)) : [];
  const fits = (d, code) => d.allCategories === true || d.allCategories === 'true' || catsOf(d).includes(code);
  const out = [];
  for (const [name, code, elNames, purpose] of KINDS) {
    const have = kinds.find((k) => norm(k.name) === norm(name) && String(k.passportCategory ?? '') === code);
    const els = elNames.map((n) => elements.find((e) => norm(e.name) === norm(n)));
    const leaf = leaves.find((l) => norm(l.name) === norm(purpose) && fits(l, code));
    out.push({ name, code, kindId: have ? String(have._id) : null, elementIds: els.filter(Boolean).map((e) => String(e._id)),
      missingEls: elNames.filter((n, i) => !els[i]), purposeLeafId: leaf ? String(leaf._id) : null, purpose, state: have ? 'есть' : 'создать' });
  }
  const secById = new Map(sections.map((s) => [String(s._id), s]));
  const groupPlan = GROUP_KIND.map(([gName, kName]) => {
    const gs = groups.filter((g) => norm(g.name) === norm(gName));
    return gs.map((g) => {
      const code = String(g.passportCategory || secById.get(String(g.parentId))?.passportCategory || '');
      const k = out.find((x) => norm(x.name) === norm(kName));
      const why = g.passportKindId ? 'у группы вид уже есть' : !k ? 'нет вида' : k.code !== code ? `тип группы ${code || '—'} ≠ тип вида ${k.code}` : '';
      return { group: String(g.name), groupId: String(g._id), kind: kName, state: why ? 'пропуск: ' + why : 'поставить' };
    });
  }).flat();
  return { kinds: out, groups: groupPlan };
}
module.exports = { buildPlan, KINDS, GROUP_KIND };

if (!module.parent && !process.env.JEST_WORKER_ID) (async () => {
  const apply = process.argv.includes('--apply');
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    const dv = db.collection('dict_values');
    const [elements, phrases, kinds, cats] = await Promise.all([
      dv.find({ dict: 'passportElements', deletedAt: null }).toArray(),
      dv.find({ dict: 'passportPhrases', deletedAt: null }).toArray(),
      dv.find({ dict: 'passportKinds', deletedAt: null }).toArray(),
      db.collection('categories').find({ type: 'product', deletedAt: null }).toArray(),
    ]);
    const plan = buildPlan({ elements, phrases, kinds, groups: cats.filter((c) => c.parentId), sections: cats.filter((c) => !c.parentId) });
    console.log('База ' + db.databaseName + ' — ' + (apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'));
    console.log('вид | тип | элементы | назначение | действие');
    for (const k of plan.kinds) console.log(`  ${k.name} | ${k.code} | ${k.elementIds.length}${k.missingEls.length ? ' (нет: ' + k.missingEls.join(', ') + ')' : ''} | ${k.purposeLeafId ? k.purpose : 'НЕТ «' + k.purpose + '»'} | ${k.state}`);
    console.log('группа → вид | действие');
    for (const g of plan.groups) console.log(`  ${g.group} → ${g.kind} | ${g.state}`);
    if (!apply) { console.log('ПЛАН. Запись — только с --apply.'); return; }
    const made = [], groupsSet = [];
    for (const k of plan.kinds) {
      if (k.kindId) continue;
      const doc = { dict: 'passportKinds', name: k.name, passportCategory: k.code, elementIds: k.elementIds.map((i) => new ObjectId(i)),
        purposeLeafId: k.purposeLeafId ? new ObjectId(k.purposeLeafId) : null, notes: 'C107: по смыслу справочников', deletedAt: null, createdAt: new Date(), updatedAt: new Date() };
      k.kindId = String((await dv.insertOne(doc)).insertedId);
      made.push(k.kindId);
    }
    for (const g of plan.groups) {
      if (g.state !== 'поставить') continue;
      const k = plan.kinds.find((x) => norm(x.name) === norm(g.kind));
      const r = await db.collection('categories').updateOne({ _id: new ObjectId(g.groupId), passportKindId: null }, { $set: { passportKindId: new ObjectId(k.kindId) } });
      if (r.modifiedCount) groupsSet.push(g.groupId);
    }
    console.log('ОТКАТ: убрать виды ' + made.join(',') + '; снять passportKindId у групп ' + groupsSet.join(','));
    console.log('записано: видов создано ' + made.length + ', групп обновлено ' + groupsSet.length);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
