/* Артикулы позиций склада из заявок (TASKS АР.4). ТОЛЬКО ОТЧЁТ (dry-run): ничего не пишет в базу.
 * Для каждой позиции, на которую есть заявка с артикулом (по связи materialId, иначе по тому же наименованию):
 *   «взять» — у позиции автоартикул СКЛ-… / пусто, артикул свободен (СКЛ-… останется внутренним кодом);
 *   «дубль» — этот артикул уже у другой позиции (артикул уникален: решить, одна ли это позиция);
 *   «конфликт» — у позиции свой другой артикул; «несколько» — в заявках разные артикулы.
 * Применение — только после «да» пользователя и свежего бэкапа, отдельным шагом (с --apply скрипт откажется работать).
 *   MONGO_URI=… [MONGO_DB=…] node scripts/articles-from-requests.js */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const AUTO = /^СКЛ-\d{4}-\d+$/; // как backend/src/modules/stock/article.ts
const isAuto = (a) => !String(a ?? '').trim() || AUTO.test(String(a).trim());
const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

(async () => {
  if (process.argv.includes('--apply')) { console.error('Только отчёт. Применение — после «да» пользователя и бэкапа.'); process.exit(2); }
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const mats = await db.collection('materials').find({ deletedAt: null }, { projection: { name: 1, article: 1, sku: 1 } }).toArray();
  const byId = new Map(mats.map((m) => [String(m._id), m])), byName = new Map(mats.map((m) => [norm(m.name), m]));
  const owner = new Map(mats.filter((m) => !isAuto(m.article)).map((m) => [norm(m.article), m]));
  const found = new Map(); // materialId → Map(article → [№ заявок])
  for await (const r of db.collection('supplyrequests').find({ deletedAt: null, article: { $nin: [null, ''] } }, { projection: { article: 1, materialId: 1, title: 1, num: 1 } })) {
    const m = (r.materialId && byId.get(String(r.materialId))) || byName.get(norm(r.title));
    if (!m) continue;
    const a = String(r.article).trim();
    const k = String(m._id); if (!found.has(k)) found.set(k, new Map());
    const nums = found.get(k).get(a) || []; nums.push(r.num ?? '—'); found.get(k).set(a, nums);
  }
  const rows = [];
  for (const [k, arts] of found) {
    const m = byId.get(k); const list = [...arts.keys()];
    const a = list[0];
    let action;
    if (list.length > 1) action = 'несколько артикулов в заявках — решить вручную';
    else if (norm(m.article) === norm(a)) continue;
    else if (!isAuto(m.article)) action = 'конфликт: у позиции свой другой';
    else if (owner.has(norm(a)) && String(owner.get(norm(a))._id) !== k) action = `дубль: «${a}» уже у «${owner.get(norm(a)).name}»`;
    else action = 'взять';
    rows.push({ name: m.name, now: m.article, from: list.map((x) => `${x} (заявки №${arts.get(x).join(', ')})`).join('; '), action });
  }
  const n = (t) => rows.filter((r) => r.action.startsWith(t)).length;
  console.log(`Позиций с артикулом в заявках: ${found.size}; к переносу: ${n('взять')}; дубли: ${n('дубль')}; конфликты: ${n('конфликт')}; несколько: ${n('несколько')}`);
  console.log('');
  console.log('Позиция | артикул сейчас | артикул из заявок | предложение');
  for (const r of rows.sort((x, y) => x.action.localeCompare(y.action, 'ru'))) console.log(`${r.name} | ${r.now || '—'} | ${r.from} | ${r.action}`);
  console.log('');
  console.log('Ничего не изменено (dry-run). Применение: артикул из заявки → в позицию, прежний СКЛ-… → внутренний код (internalArticle).');
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
