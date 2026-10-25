/* ПВ (docs/roles/tz/PASSPORT-FUNNEL.md): справочник «Готовые тексты паспорта» (dict_values, dict passportPhrases) → дерево
 * «Тексты паспорта» (раздел → варианты). Схему не меняет — только добавляет поля записям.
 *
 * Что делает:
 *   1. Создаёт корни разделов («Назначение», «Установка») — записи без текста с parentId = null.
 *   2. Каждый старый эталон (есть текст, нет parentId) становится листом под корнем своего раздела:
 *      parentId = корень, allCategories = true, если категории не заданы, order — по порядку создания, funnelV = 1.
 *      Текст и категории не меняются. Названия «Бетонирование опорных стоек» и т. п. остаются как были.
 *   3. Лист раздела «Установка», название которого совпало со «Способом установки» (passportInstall), получает installTypeId
 *      (выбор варианта сам ставит способ установки паспорта).
 *   4. «Способ установки» с непустым «Текстом монтажа», для которого листа нет (ни по installTypeId, ни по тексту),
 *      даёт новый лист под «Установкой» (installTypeId, категории способа; пусто — для всех).
 *   Старые и выданные паспорта не трогает (у них снимок текста); тексты старых паспортов не переносит.
 *   Повторный запуск безопасен: записи с funnelV / parentId пропускаются, корни ищутся до создания.
 *
 *   Запускать ПОСЛЕ scripts/passport-dicts-cleanup.js (дубли уже слиты).
 *   План (ничего не пишет):  MONGO_URI=… [MONGO_DB=…] node scripts/passport-funnel-migrate.js [--out backup.json]
 *   Записать:                … --apply --out backup.json   (НА ПРОДЕ — только координатор; --out обязателен: выгрузка
 *                             passportPhrases и passportInstall до записи — для отката)
 *   Откат: вернуть из выгрузки поля parentId/allCategories/order/funnelV/installTypeId (или удалить записи с funnelV = 1,
 *   созданные скриптом: в выгрузке нет их _id — они помечены createdBy: 'passport-funnel-migrate').
 */
const path = require('path');
const fs = require('fs');

const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v) => s(v).toLowerCase().replace(/ё/g, 'е').replace(/[«»"'„“”]/g, '').replace(/[\s.,;:!]+$/, '');
const lines = (v) => String(v ?? '').split(/\r?\n/).map(s).filter(Boolean);
// ПВ 2026-10-25: варианты «Установки» → способ установки по смыслу (названия в справочниках разные)
const INSTALL_BY_NAME = { 'бетонирование опорных стоек': 'CONCRETE_POSTS', 'закладные детали': 'EMBEDDED', 'анкерное крепление': 'ANCHORS', 'свободная установка': 'FREESTANDING', 'ограждение на опорных стойках': 'FENCE_POSTS' };
const NEW_FROM_INSTALL = process.argv.includes('--new-from-install');
const SECTIONS = { purpose: { name: 'Назначение', order: 10 }, installation: { name: 'Установка', order: 20 } };
const NOTE = 'passport-funnel-migrate';

/** Чистая функция: что сделать. phrases/installs — живые записи (deletedAt: null), поля как в базе. */
function buildPlan(phrases, installs, { newFromInstall = NEW_FROM_INSTALL } = {}) {
  const plan = { roots: [], leaves: [], newLeaves: [], skipped: 0 };
  const isRoot = (d) => !d.parentId && !s(d.text);
  const rootOf = {}; // section → существующий корень
  for (const d of phrases) if (isRoot(d) && SECTIONS[d.section] && !rootOf[d.section]) rootOf[d.section] = d;
  const legacy = phrases.filter((d) => !d.parentId && s(d.text) && !d.funnelV);
  plan.skipped = phrases.filter((d) => (d.parentId || d.funnelV) && s(d.text)).length;
  const ensureRoot = (section) => {
    if (rootOf[section] || plan.roots.some((r) => r.section === section)) return;
    plan.roots.push({ section, name: SECTIONS[section].name, order: SECTIONS[section].order });
  };
  legacy.sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const ord = {};
  for (const d of legacy) {
    const section = SECTIONS[d.section] ? d.section : 'purpose';
    ensureRoot(section);
    ord[section] = (ord[section] ?? 0) + 1;
    const byCode = INSTALL_BY_NAME[norm(d.name)];
    const inst = section === 'installation' ? installs.find((i) => (byCode && String(i.code ?? '').toUpperCase() === byCode) || norm(i.name) === norm(d.name) || (s(i.montage) && norm(lines(i.montage).join(' ')) === norm(d.text))) : null;
    plan.leaves.push({ id: String(d._id), name: s(d.name), section, order: ord[section], allCategories: !s(d.categories), installTypeId: inst ? String(inst._id) : null });
  }
  // способ установки с текстом монтажа, которого нет среди листьев раздела «Установка»
  const instLeaves = [...phrases.filter((d) => d.section === 'installation' && s(d.text) && (d.parentId || d.funnelV)), ...plan.leaves.filter((l) => l.section === 'installation').map((l) => phrases.find((d) => String(d._id) === l.id))];
  // п. 4 — только с --new-from-install: текст монтажа — это шаги раздела «Монтаж», а не вариант «Установки»;
  // без флага новые листья не создаются (иначе «Бетонирование опор» рядом с «Бетонированием опорных стоек» — дубль)
  for (const i of newFromInstall ? installs : []) {
    const montage = lines(i.montage).join('\n');
    if (!montage) continue;
    const linked = plan.leaves.some((l) => l.installTypeId === String(i._id)) || instLeaves.some((d) => String(d.installTypeId ?? '') === String(i._id) || norm(d.text) === norm(montage));
    if (linked) continue;
    ensureRoot('installation');
    ord.installation = (ord.installation ?? 0) + 1;
    plan.newLeaves.push({ name: s(i.name), section: 'installation', text: montage, categories: s(i.categories), allCategories: !s(i.categories), order: ord.installation, installTypeId: String(i._id) });
  }
  return plan;
}

async function applyPlan(db, plan, { ObjectId }) {
  const dv = db.collection('dict_values');
  const now = new Date();
  const out = { roots: 0, leaves: 0, newLeaves: 0 };
  const rootId = {};
  for (const d of await dv.find({ dict: 'passportPhrases', deletedAt: null, parentId: null }).toArray()) if (!s(d.text) && SECTIONS[d.section] && !rootId[d.section]) rootId[d.section] = d._id;
  for (const r of plan.roots) {
    if (rootId[r.section]) continue;
    const ins = await dv.insertOne({ dict: 'passportPhrases', name: r.name, section: r.section, parentId: null, text: null, categories: null, allCategories: null, order: r.order, required: null, isDefault: null, slot: 1, installTypeId: null,
      funnelV: 1, createdBy: NOTE, deletedAt: null, createdAt: now, updatedAt: now });
    rootId[r.section] = ins.insertedId; out.roots++;
  }
  for (const l of plan.leaves) {
    const set = { parentId: rootId[l.section], allCategories: l.allCategories ? true : null, order: l.order, funnelV: 1, updatedAt: now, ...(l.installTypeId ? { installTypeId: new ObjectId(l.installTypeId) } : {}) };
    out.leaves += (await dv.updateOne({ _id: new ObjectId(l.id), deletedAt: null, parentId: null, funnelV: { $exists: false } }, { $set: set })).modifiedCount;
  }
  for (const l of plan.newLeaves) {
    await dv.insertOne({ dict: 'passportPhrases', name: l.name, section: l.section, parentId: rootId.installation, text: l.text, categories: l.categories || null, allCategories: l.allCategories ? true : null, order: l.order, required: null, isDefault: null,
      slot: null, installTypeId: new ObjectId(l.installTypeId), funnelV: 1, createdBy: NOTE, deletedAt: null, createdAt: now, updatedAt: now });
    out.newLeaves++;
  }
  return out;
}

function printPlan(plan, log = console.log) {
  log(`Корней создать: ${plan.roots.length} · старых текстов → в дерево: ${plan.leaves.length} · новых листьев из «Способов установки»: ${plan.newLeaves.length} · уже в дереве: ${plan.skipped}`);
  for (const r of plan.roots) log(`  + раздел «${r.name}» (${r.section})`);
  for (const l of plan.leaves) log(`  ${l.section}: «${l.name}»${l.allCategories ? ' · для всех' : ''}${l.installTypeId ? ' · способ установки привязан' : ''}`);
  for (const l of plan.newLeaves) log(`  + установка: «${l.name}» из текста монтажа${l.allCategories ? ' · для всех' : ' · ' + l.categories}`);
}

module.exports = { buildPlan, applyPlan, printPlan };

if (require.main === module) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); const outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) throw new Error('Для --apply укажите --out файл.json — выгрузка для отката');
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const dv = db.collection('dict_values');
    const [phrases, installs] = await Promise.all([dv.find({ dict: 'passportPhrases', deletedAt: null }).toArray(), dv.find({ dict: 'passportInstall', deletedAt: null }).toArray()]);
    const plan = buildPlan(phrases, installs);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), passportPhrases: phrases, passportInstall: installs, plan }, null, 2)); console.log(`\nВыгрузка (для отката) и план: ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply --out файл.json'); return; }
    const r = await applyPlan(db, plan, { ObjectId });
    console.log(`\nГотово: корней ${r.roots}, текстов переведено ${r.leaves}, новых листьев ${r.newLeaves}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
