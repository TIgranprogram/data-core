#!/usr/bin/env node
/**
 * C100: «Виды изделий» для однородных групп. Для каждой группы из списка (Урны, Скамьи, Навесы, Велопарковки, Информационные стенды
 * и указатели, Ограждения, Качели, Карусели, Трибуны) создаётся вид с названием группы и группе ставится `passportKindId`.
 * Вид берёт у группы: категорию паспорта (группа → раздел) и самые частые у её изделий элементы и назначение (если у изделий они есть;
 * иначе вид получает только название и категорию). ИЗДЕЛИЯ НЕ ТРОГАЕМ: их собственные значения остаются главнее вида.
 * Идемпотентен: группа с уже заданным видом пропускается; вид с тем же названием и категорией используется повторно, дубли не плодятся.
 * Две группы с одним названием, но разным содержимым получают виды «Название (Раздел)».
 *
 *   MONGO_URI=… MONGO_DB=… node backend/scripts/c100-kinds.js [--apply]
 *   На проде (запускает пользователь): bash remote-access/run-script.sh c100-kinds [--apply]  (--apply сам делает бэкап)
 */
const path = require('path');

/** Названия групп (без регистра и «ё»), которым заводится вид. */
const GROUPS = ['урны', 'скамьи', 'навесы', 'велопарковки', 'информационные стенды и указатели', 'ограждения', 'качели', 'карусели', 'трибуны'];
const MAX_ELEMENTS = 3;

const norm = (v) => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const str = (v) => String(v ?? '');

/** Самое частое значение (ключ → число); при равенстве — меньший ключ, чтобы план был одинаковым при каждом запуске. */
function top(counts) {
  let best = null;
  for (const [k, n] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (!best || n > best[1]) best = [k, n];
  return best ? best[0] : null;
}

/**
 * Чистая функция плана. groups — группы изделий (categories с родителем), sections — разделы, products — живые изделия,
 * phrases — passportPhrases (для проверки листа назначения), kinds — уже существующие виды.
 * Возвращает строки плана по группам из списка.
 */
function buildPlan({ groups, sections, products, phrases, kinds }) {
  const secById = new Map(sections.map((s) => [str(s._id), s]));
  const root = phrases.find((p) => p.section === 'purpose' && !p.parentId && !p.text);
  const leafIds = new Set(phrases.filter((p) => root && str(p.parentId) === str(root._id)).map((p) => str(p._id)));
  const rows = groups.filter((g) => GROUPS.includes(norm(g.name))).map((g) => {
    const sec = secById.get(str(g.parentId));
    const mine = products.filter((p) => str(p.categoryId) === str(g._id));
    const els = new Map(), leaves = new Map();
    for (const p of mine) {
      const pd = p.passportDefaults || {};
      const ids = [...new Set((pd.elements || []).map(str))].sort();
      if (ids.length && ids.length <= MAX_ELEMENTS) els.set(ids.join(','), (els.get(ids.join(',')) || 0) + 1);
      const leaf = root && pd.textChoices ? str(pd.textChoices[str(root._id)]) : '';
      if (leaf && leafIds.has(leaf)) leaves.set(leaf, (leaves.get(leaf) || 0) + 1);
    }
    return {
      groupId: str(g._id), group: g.name, section: sec ? sec.name : '', has: g.passportKindId ? str(g.passportKindId) : '',
      category: str(g.passportCategory || (sec && sec.passportCategory) || ''),
      elementIds: (top(els) || '').split(',').filter(Boolean), purposeLeafId: top(leaves) || '', products: mine.length,
    };
  });
  // имя вида: название группы; одинаковое название при разном содержимом — с разделом
  const sig = (r) => [r.category, r.elementIds.join(','), r.purposeLeafId].join('|');
  const byName = new Map();
  for (const r of rows) byName.set(norm(r.group), [...(byName.get(norm(r.group)) || []), r]);
  for (const r of rows) {
    const same = byName.get(norm(r.group));
    r.kindName = same.some((x) => sig(x) !== sig(r)) && r.section ? `${r.group} (${r.section})` : r.group;
    const found = kinds.find((k) => norm(k.name) === norm(r.kindName) && str(k.passportCategory || '') === r.category);
    r.state = r.has ? 'skip' : found ? 'reuse' : 'create';
    r.kindId = r.has || (found ? str(found._id) : '');
  }
  return rows;
}

async function load() {
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  const db = client.db(process.env.MONGO_DB || 'datacore');
  const cats = await db.collection('categories').find({ type: 'product', deletedAt: null }).project({ name: 1, parentId: 1, passportCategory: 1, passportKindId: 1 }).toArray();
  return {
    db, client, ObjectId,
    data: {
      groups: cats.filter((c) => c.parentId), sections: cats.filter((c) => !c.parentId),
      products: await db.collection('products').find({ deletedAt: null }).project({ categoryId: 1, passportDefaults: 1 }).toArray(),
      phrases: await db.collection('dict_values').find({ dict: 'passportPhrases', deletedAt: null }).project({ section: 1, parentId: 1, text: 1 }).toArray(),
      kinds: await db.collection('dict_values').find({ dict: 'passportKinds', deletedAt: null }).project({ name: 1, passportCategory: 1 }).toArray(),
    },
  };
}

module.exports = { buildPlan, GROUPS };

if (!module.parent && !process.env.JEST_WORKER_ID) (async () => {
  const apply = process.argv.includes('--apply');
  const L = await load();
  try {
    const plan = buildPlan(L.data);
    console.log(`База ${L.db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    console.log('группа (раздел) | вид | категория | элементов | назначение | изделий | действие');
    const word = { create: 'создать вид и поставить группе', reuse: 'поставить группе существующий вид', skip: 'у группы вид уже есть — пропуск' };
    for (const r of plan) console.log(`  ${r.group} (${r.section}) | ${r.kindName} | ${r.category || '—'} | ${r.elementIds.length} | ${r.purposeLeafId ? 'да' : '—'} | ${r.products} | ${word[r.state]}`);
    const missing = GROUPS.filter((g) => !plan.some((r) => norm(r.group) === g));
    if (missing.length) console.log('Групп с такими названиями нет: ' + missing.join(', '));
    const todo = plan.filter((r) => r.state !== 'skip');
    console.log(`\nгрупп в списке ${plan.length}: к записи ${todo.length}, пропуск ${plan.length - todo.length}`);
    if (!apply) { console.log('ПЛАН. Запись — только с --apply.'); return; }
    const { ObjectId } = L;
    const kinds = L.db.collection('dict_values'), cats = L.db.collection('categories');
    const created = [], rollback = [], madeNow = new Map();
    for (const r of todo) {
      const key = norm(r.kindName) + '|' + r.category;
      let kindId = r.kindId ? new ObjectId(r.kindId) : madeNow.get(key) || null; // две группы с одним названием делят один вид
      if (!kindId) {
        const doc = {
          dict: 'passportKinds', name: r.kindName, passportCategory: r.category || null, elementIds: r.elementIds.map((i) => new ObjectId(i)),
          purposeLeafId: r.purposeLeafId ? new ObjectId(r.purposeLeafId) : null, notes: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
        };
        kindId = (await kinds.insertOne(doc)).insertedId;
        madeNow.set(key, kindId);
        created.push(String(kindId));
      }
      // пишем, только если у группы вида всё ещё нет (пока шёл разбор, мог появиться)
      const res = await cats.updateOne({ _id: new ObjectId(r.groupId), passportKindId: null }, { $set: { passportKindId: kindId } });
      if (res.modifiedCount) rollback.push(r.groupId);
    }
    console.log('ОТКАТ (сохранить): снять passportKindId у групп ' + rollback.join(', ') + '; убрать созданные виды ' + created.join(', '));
    console.log(`записано: видов создано ${created.length}, групп обновлено ${rollback.length}`);
  } finally { await L.client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
