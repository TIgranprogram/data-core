/* C028 (паспорт «воронкой», R5): загрузка текстов в справочник «Тексты паспорта» (dict_values, dict 'passportPhrases').
 * Источники: docs/crew/C028-passport-funnel/texts-drafts.json (черновики R2) и facets-seed.json → newPurposePhrases.
 *
 *   Черновик → корень { name: title, section, slot, categories } + один лист «Текст» с facetValueIds или groupIds.
 *   slot — следующий свободный пункт раздела шаблона категории (texts-tree) +1 на каждый черновик того же раздела.
 *   Предложения с «[уточнить]» из текста вырезаются (список — docs/crew/C028-passport-funnel/texts-numbers.md).
 *   Назначение без ссылки (нет признака/группы в базе) и дубли (section+name+categories) — пропуски с причиной.
 *   Повторный запуск — 0 новых. Лог — tools/logs/c028-texts-load-<время>.log.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/c028-texts-load.js [--drafts файл.json] [--seed файл.json]
 *   Записать: … --apply [--out backup.json]   (createdIds — для открата: удалить из dict_values)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => s(v).toLowerCase().replace(/ё/g, 'е');
const CREW = path.join(__dirname, '..', '..', '..', 'docs', 'crew', 'C028-passport-funnel');
const DEFAULT_DRAFTS = path.join(CREW, 'texts-drafts.json');
const DEFAULT_SEED = path.join(CREW, 'facets-seed.json');

/** Вырезать предложения с «[уточнить]»: возвращает { paragraphs, removed: [{ paragraph, sentence }] } (пустые абзацы убираются). */
function stripClarify(paragraphs) {
  const removed = [];
  const out = [];
  for (const raw of paragraphs || []) {
    const sentences = s(raw).split(/(?<=[.!?])\s+/).filter(Boolean);
    const kept = [];
    for (const sent of sentences) {
      if (sent.includes('[уточнить]')) removed.push({ paragraph: s(raw), sentence: sent });
      else kept.push(sent);
    }
    if (kept.length) out.push(kept.join(' '));
  }
  return { paragraphs: out, removed };
}

/** Число пунктов раздела шаблона у категории (сначала «свои» тексты категории, иначе «Для всех»). */
function slotBase(textsTree, category, section) {
  // пункты раздела идут подряд: общие («Для всех») и свои категории; новый текст — после большего из двух (не заменяет существующий)
  const cat = textsTree[category];
  if (!cat) return 0;
  const count = (t) => ((t && t.sections) || []).filter((x) => x.key === section).reduce((n, x) => Math.max(n, (x.paragraphs || []).length), 0);
  return Math.max(count(cat.all), count(cat.own));
}

/** Разрешить группу: «Качели (раздел «Оборудование для детских игровых площадок»)» → группа «Качели» этого раздела. */
function findGroup(groups, sections, spec) {
  const sn = new Map(sections.map((x) => [String(x._id), s(x.name)]));
  const m = /^(.*?)\s*\(раздел\s*«(.+?)»\)\s*$/.exec(s(spec));
  const name = m ? s(m[1]) : s(spec);
  const secName = m ? s(m[2]) : null;
  const hits = groups.filter((g) => s(g.name) === name);
  const exact = secName ? hits.filter((g) => sn.get(String(g.parentId)) === secName) : hits;
  const list = exact.length ? exact : hits;
  if (list.length === 1) return { id: String(list[0]._id), name };
  return null; // нет или неоднозначно
}

/**
 * Чистая функция плана. have — {
 *   phrases: записей passportPhrases (корни: parentId пусто; листья),
 *   facetValues: [{ _id, code }] (dict 'productFacetValues'),
 *   groups: записей productGroups, sections: записей productSections,
 *   textsTree: texts-tree.json по категориям }
 */
function buildPlan(drafts, seed, have) {
  const phrases = have.phrases || [];
  const purposeRoot = phrases.find((p) => !p.parentId && s(p.section) === 'purpose');
  const phraseNames = new Set(phrases.filter((p) => p.parentId).map((p) => key(p.name)));
  const facetId = new Map((have.facetValues || []).map((v) => [s(v.code), String(v._id)]));
  const rootKeys = new Set(phrases.filter((p) => !p.parentId).map((p) => `${s(p.section)}|${key(p.name)}|${s(p.categories)}`));
  const plan = { roots: [], leaves: [], purposes: [], skip: [], cut: [], keepPurposes: 0 };

  // 1. Назначения из newPurposePhrases → листья раздела purpose
  for (const np of seed.newPurposePhrases || []) {
    if (phraseNames.has(key(np.name))) { plan.keepPurposes++; continue; }
    if (!purposeRoot) { plan.skip.push(`назначение «${np.name}»: нет корня раздела purpose в справочнике`); continue; }
    plan.purposes.push({ name: s(np.name), categories: s(np.categories), text: s(np.text), parentId: String(purposeRoot._id) });
  }

  // 2. Черновики → корень + лист
  const slotNext = new Map(); // category|section → следующий slot
  const draftsByKey = new Map(); // ключ дедупа, чтобы повторный запуск плана сам себя не дублировал
  for (const d of drafts) {
    // вырезанные «[уточнить]» собираем по всем черновикам, включая пропущенные: директору нужен полный список цифр
    const { paragraphs, removed } = stripClarify(d.paragraphs);
    for (const r of removed) plan.cut.push({ category: d.category, title: s(d.title), sentence: r.sentence });
    const k = `${s(d.section)}|${key(d.title)}|${s(d.category)}`;
    if (rootKeys.has(k) || draftsByKey.has(k)) { plan.skip.push(`черновик «${d.title}» (${d.category}/${d.section}): уже есть`); continue; }
    let link = null;
    if (d.facetValue) {
      const id = facetId.get(s(d.facetValue));
      if (!id) { plan.skip.push(`черновик «${d.title}» (${d.category}/${d.section}): нет признака ${d.facetValue} в базе`); continue; }
      link = { facetValueIds: [id] };
    } else if (d.group) {
      // неоднозначное имя группы («Качели» в двух разделах) разрешаем по карте групп категории в seed
      const base = (spec) => s((/^(.*?)\s*\(раздел/.exec(spec) || [, spec])[1]);
      const richer = (seed.groupCategory?.[s(d.category)] || []).find((x) => base(x) === base(d.group));
      const g = findGroup(have.groups || [], have.sections || [], richer || d.group);
      if (!g) { plan.skip.push(`черновик «${d.title}» (${d.category}/${d.section}): не нашлась группа «${d.group}»`); continue; }
      link = { groupIds: [g.id] };
    } else { plan.skip.push(`черновик «${d.title}» (${d.category}/${d.section}): нет ни facetValue, ни group`); continue; }

    if (!paragraphs.length) { plan.skip.push(`черновик «${d.title}» (${d.category}/${d.section}): после вырезания «[уточнить]» текст пуст`); continue; }

    const sk = `${s(d.category)}|${s(d.section)}`;
    const slot = slotNext.get(sk) ?? slotBase(have.textsTree || {}, s(d.category), s(d.section)) + 1;
    slotNext.set(sk, slot + 1);
    draftsByKey.set(k, true);
    const root = { name: s(d.title), section: s(d.section), slot, categories: s(d.category), allCategories: false };
    plan.roots.push(root);
    plan.leaves.push({ name: 'Текст', section: s(d.section), categories: s(d.category), allCategories: false, order: 1, required: false, isDefault: false, installTypeId: null, slot: '', text: paragraphs.join('\n'), ...link });
  }
  return plan;
}

function numbersMd(plan, meta = {}) {
  const L = ['# C028 R5 — вырезанные предложения с «[уточнить]»', '',
    `Черновики: ${meta.drafts ?? '—'} · корней/листьев создать: ${plan.roots.length}/${plan.leaves.length} · назначений: ${plan.purposes.length} (ещё есть: ${plan.keepPurposes}) · пропусков: ${plan.skip.length} · вырезано предложений: ${plan.cut.length}`, ''];
  if (plan.cut.length) {
    L.push('| Категория | Черновик | Предложение с цифрой |', '|--|--|--|');
    for (const c of plan.cut) L.push(`| ${c.category} | ${c.title} | ${c.sentence} |`);
  } else L.push('Предложений с «[уточнить]» не было.');
  if (plan.skip.length) { L.push('', '## Пропуски', ''); for (const x of plan.skip) L.push('- ' + x); }
  return L.join('\n') + '\n';
}

async function applyPlan(db, plan, ObjectId) {
  const now = new Date(); const created = []; const col = db.collection('dict_values');
  const oid = (x) => (x ? new ObjectId(x) : null);
  for (let i = 0; i < plan.roots.length; i++) {
    const r = plan.roots[i]; const l = plan.leaves[i];
    const root = await col.insertOne({ dict: 'passportPhrases', name: r.name, section: r.section, slot: r.slot, categories: r.categories, allCategories: r.allCategories, parentId: null, deletedAt: null, createdAt: now, updatedAt: now });
    created.push(String(root.insertedId));
    const leaf = await col.insertOne({ dict: 'passportPhrases', name: l.name, section: l.section, categories: l.categories, allCategories: l.allCategories, order: l.order, required: l.required, isDefault: l.isDefault, installTypeId: null, slot: l.slot, text: l.text, ...(l.facetValueIds ? { facetValueIds: l.facetValueIds.map(oid) } : {}), ...(l.groupIds ? { groupIds: l.groupIds.map(oid) } : {}), parentId: root.insertedId, deletedAt: null, createdAt: now, updatedAt: now });
    created.push(String(leaf.insertedId));
  }
  for (const p of plan.purposes) {
    const r = await col.insertOne({ dict: 'passportPhrases', name: p.name, section: 'purpose', parentId: oid(p.parentId), categories: p.categories, allCategories: false, order: 99, required: false, isDefault: false, installTypeId: null, slot: '', text: p.text, deletedAt: null, createdAt: now, updatedAt: now });
    created.push(String(r.insertedId));
  }
  return created;
}

function printPlan(plan, log = console.log) {
  log(`Черновики: корней ${plan.roots.length}, листьев ${plan.leaves.length} · назначений ${plan.purposes.length} (уже есть ${plan.keepPurposes}) · пропусков ${plan.skip.length} · вырезано «[уточнить]» ${plan.cut.length}`);
  for (const r of plan.roots) log(`  + корень ${r.categories}/${r.section} slot ${r.slot} «${r.name}»`);
  for (const p of plan.purposes) log(`  + назначение «${p.name}» (${p.categories})`);
  for (const x of plan.skip) log('  ! ' + x);
}

module.exports = { buildPlan, stripClarify, findGroup, slotBase, numbersMd, applyPlan, printPlan };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const drafts = JSON.parse(fs.readFileSync(arg('--drafts') || DEFAULT_DRAFTS, 'utf8'));
  const seed = JSON.parse(fs.readFileSync(arg('--seed') || DEFAULT_SEED, 'utf8'));
  let outFile = arg('--out');
  if (apply && !outFile) outFile = path.join(os.tmpdir(), 'c028-texts-load-' + Date.now() + '.json');
  const lines = []; const log = (t = '') => { lines.push(t); console.log(t); };
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..', '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const rows = await db.collection('dict_values').find({ dict: { $in: ['passportPhrases', 'productFacetValues'] }, deletedAt: null }).toArray();
    const cats = await db.collection('categories').find({ type: 'product', deletedAt: null }).toArray();
    // число пунктов раздела — из текстов v2 в коде (один источник: backend/scripts/passport-texts.v2.json; шаблон «Для всех» в базе — для PDF v1)
    const v2 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'passport-texts.v2.json'), 'utf8'));
    const textsTree = {};
    for (const cat of Object.keys(v2)) if (cat !== 'ALL') textsTree[cat] = { all: { sections: (v2.ALL && v2.ALL.sections) || [] }, own: { sections: v2[cat].sections || [] } };
    const have = {
      phrases: rows.filter((r) => r.dict === 'passportPhrases'),
      facetValues: rows.filter((r) => r.dict === 'productFacetValues'),
      // группы и разделы изделий живут в categories (type product), не в dict_values
      groups: cats.filter((c) => c.parentId),
      sections: cats.filter((c) => !c.parentId),
      textsTree,
    };
    const plan = buildPlan(drafts, seed, have);
    printPlan(plan, log);
    const md = path.join(CREW, 'texts-numbers.md');
    fs.writeFileSync(md, numbersMd(plan, { drafts: drafts.length }));
    log(`Вырезанные предложения: ${md}`);
    if (apply) {
      const ids = await applyPlan(db, plan, ObjectId);
      fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), createdIds: ids, plan }, null, 2));
      log(`\nГотово: создано ${ids.length}. Выгрузка для отката: ${outFile}`);
    } else log('\nНичего не записано. Записать: --apply');
    const dir = path.join(__dirname, '..', '..', '..', 'tools', 'logs');
    const name = path.join(fs.existsSync(dir) ? dir : os.tmpdir(), `c028-texts-load-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`);
    fs.writeFileSync(name, lines.join('\n') + '\n'); console.log(`Лог: ${name}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
