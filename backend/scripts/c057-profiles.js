/* C057-Э0 шаг 5: сортаменты листов и труб. ТЗ: docs/crew/C057-pdm-import/TZ-E0-DATA.md, DECISIONS п. 2 (Л13, вариант A).
 *
 *   План по выгрузке:  node scripts/c057-profiles.js --from <папка выгрузки>
 *   План по базе:      MONGO_URI=… MONGO_DB=… node scripts/c057-profiles.js
 *   Записать:          MONGO_URI=… MONGO_DB=… node scripts/c057-profiles.js --apply [--out откат.json]
 *
 * Для каждой группы «сортамент + марка» среди листов («Листовой металл») и труб («Круглая труба», «Профильная труба») создаётся позиция-сортамент:
 * materialKind 'raw', isProfile true, scrapFactor 1, unit «м²» (лист) или «м» (труба), без формата, название = «сортамент, марка» (чистое, без
 * лишних слов — ключ сравнения должен совпасть со строкой PDM «Сортамент» + «Материал»), артикул «Сортамент: <название>» (как у загрузки из PDM).
 * Складские позиции группы получают profileId; isDefaultFormat — у одного формата: самого частого в категории (ничья — больше остаток, затем
 * не мытая, затем название). Обрезки (offcutOf) и «куски» в основной формат не выбираются; обрезок в сортамент не входит.
 * --apply идемпотентен: сортамент ищется по {isProfile, name}; ссылку и признак пишет только тем, у кого profileId ещё нет; повтор — 0 изменений.
 * Ничего не удаляет и не меняет у существующих позиций, кроме profileId / isDefaultFormat. */
'use strict';
const C = require('./lib/c057-common');
const { parseSheet } = require('./lib/c057-parse');

const SHEET_CAT = 'Листовой металл', PIPE_CATS = ['Круглая труба', 'Профильная труба'];
const dimOf = (m, t) => (m.dimensions || []).find((d) => d.type === t)?.value;
const NUM = '(\\d+(?:[.,]\\d+)?)';

/** Данные сортамента из позиции: ключ группы, название, единица, размеры, формат. null — позиция в сортамент не входит. */
function profileOf(m) {
  if (m.isProfile || m.offcutOf || /обрезок/i.test(m.name)) return null;
  if (m.catName === SHEET_CAT) {
    const p = parseSheet(m.name, m.catName);
    const assortment = m.assortment || p.assortment, grade = m.materialGrade || p.materialGrade;
    if (!assortment) return null;
    const w = dimOf(m, 'width') ?? p.dims.width, l = dimOf(m, 'length') ?? p.dims.length, t = dimOf(m, 'thickness') ?? p.dims.thickness;
    return { name: `${assortment}${grade ? `, ${grade}` : ''}`, unit: 'м²', typeName: 'Лист', assortment, grade, dims: t != null ? [{ type: 'thickness', value: t }] : [],
      format: w && l ? `${Math.min(w, l)}×${Math.max(w, l)} мм` : null, scrap: false };
  }
  if (PIPE_CATS.includes(m.catName)) {
    const assortment = m.assortment;
    if (!assortment) return null;
    const grade = m.materialGrade || '';
    const dims = [];
    let mm = new RegExp(`^Труба\\s*[Øø⌀]\\s*${NUM}\\s*[×x]\\s*${NUM}`, 'i').exec(assortment);
    if (mm) dims.push({ type: 'diameter', value: Number(mm[1].replace(',', '.')) }, { type: 'thickness', value: Number(mm[2].replace(',', '.')) });
    else if ((mm = new RegExp(`^Труба\\s*${NUM}\\s*[×x]\\s*${NUM}\\s*[×x]\\s*${NUM}`, 'i').exec(assortment))) dims.push({ type: 'thickness', value: Number(mm[3].replace(',', '.')) });
    else if ((mm = new RegExp(`^Труба\\s*${NUM}\\s*[×x]\\s*${NUM}$`).exec(assortment)) && Number(mm[2].replace(',', '.')) < 5) dims.push({ type: 'thickness', value: Number(mm[2].replace(',', '.')) });
    const l = dimOf(m, 'length');
    const scraps = /кус(ки|ок)/i.test(m.name);
    return { name: `${assortment}${grade ? `, ${grade.toLowerCase()}` : ''}`, unit: 'м', typeName: 'Труба', assortment, grade, dims,
      format: scraps ? 'куски' : l ? `${l / 1000} м${m.washed === true ? ', мытая' : m.washed === false ? ', не мытая' : ''}` : 'без длины', lengthOnly: l ? `${l / 1000} м` : null, scrap: scraps, washed: m.washed === true };
  }
  return null;
}

function buildPlan(materials) {
  const existingProfiles = new Map(materials.filter((m) => m.isProfile).map((m) => [m.name, m]));
  const byName = new Map(materials.map((m) => [m.name, m]));
  const groups = new Map(), problems = [], skippedLinked = [];
  for (const m of materials) {
    const p = profileOf(m);
    if (!p) continue;
    if (m.profileId) { skippedLinked.push(m.id); continue; }
    const g = groups.get(p.name) || groups.set(p.name, { ...p, category: m.catName, categoryKey: m.categoryKey, members: [] }).get(p.name);
    g.members.push({ m, p });
  }
  // частота формата в категории (для «самый частый»)
  const freq = new Map();
  for (const g of groups.values()) for (const { m, p } of g.members) { const f = p.lengthOnly || p.format; if (f) { const k = `${m.catName}|${f}`; freq.set(k, (freq.get(k) || 0) + 1); } }
  const profiles = [];
  for (const g of groups.values()) {
    const clash = byName.get(g.name);
    const existing = existingProfiles.get(g.name);
    if (clash && !existing) { problems.push({ name: g.name, why: 'позиция с таким названием уже есть и это не сортамент' }); continue; }
    const hasDefault = existing ? materials.some((x) => x.profileId && String(x.profileId) === existing.id && x.isDefaultFormat) : false;
    const ranked = [...g.members].sort((a, b) => {
      const fa = a.p.scrap ? -1 : freq.get(`${a.m.catName}|${a.p.lengthOnly || a.p.format}`) || 0, fb = b.p.scrap ? -1 : freq.get(`${b.m.catName}|${b.p.lengthOnly || b.p.format}`) || 0;
      return fb - fa || (b.m.stockQty || 0) - (a.m.stockQty || 0) || Number(a.p.washed) - Number(b.p.washed) || a.m.name.localeCompare(b.m.name, 'ru');
    });
    const top = ranked[0], tie = ranked.length > 1 && !hasDefault && !top.p.scrap && ranked[1]
      && (freq.get(`${top.m.catName}|${top.p.lengthOnly || top.p.format}`) || 0) === (freq.get(`${ranked[1].m.catName}|${ranked[1].p.lengthOnly || ranked[1].p.format}`) || 0)
      && (top.m.stockQty || 0) === (ranked[1].m.stockQty || 0) && (top.p.lengthOnly || top.p.format) !== (ranked[1].p.lengthOnly || ranked[1].p.format);
    profiles.push({
      name: g.name, article: `Сортамент: ${g.name}`, unit: g.unit, typeName: g.typeName, assortment: g.assortment, materialGrade: g.grade || null, category: g.category, categoryId: g.categoryKey,
      dimensions: g.dims.map((d) => ({ ...d, isImmutable: false })), existingId: existing ? existing.id : null, tieNote: tie ? 'основной формат выбран по алфавиту: форматы равны по частоте и остатку' : null,
      formats: ranked.map(({ m, p }, i) => ({ id: m.id, name: m.name, format: p.format, stockQty: m.stockQty || 0, isDefault: !hasDefault && i === 0 && !p.scrap })),
    });
  }
  profiles.sort((a, b) => a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name, 'ru', { numeric: true }));
  return { profiles, problems, alreadyLinked: skippedLinked.length };
}

function render(plan, source, total) {
  const sheets = plan.profiles.filter((p) => p.unit === 'м²'), pipes = plan.profiles.filter((p) => p.unit === 'м');
  const nFormats = (l) => l.reduce((n, p) => n + p.formats.length, 0);
  const single = plan.profiles.filter((p) => p.formats.length === 1).length;
  const L = ['# C057-Э0 · шаг 5 · сортаменты листов и труб', '', `Источник: ${source} · дата: ${C.today()} · позиций: ${total}`, '',
    `**Итог:** создать сортаментов — **${plan.profiles.filter((p) => !p.existingId).length}** (листов ${sheets.length}, труб ${pipes.length}); связать форматов — **${nFormats(plan.profiles)}** (листов ${nFormats(sheets)}, труб ${nFormats(pipes)}); с одним форматом — ${single}; уже связано раньше — ${plan.alreadyLinked}; проблем — ${plan.problems.length}.`, '',
    'Сортамент — позиция без формата (единица м² или м): детали из PDM ссылаются на неё, склад и «что купить» берут формат и цену из связанных складских позиций. Складские позиции не меняются, кроме двух полей: `profileId` и `isDefaultFormat` (у основного формата).', ''];
  if (plan.problems.length) L.push('## Проблемы', '', C.table(['Название сортамента', 'Почему пропущен'], plan.problems.map((p) => [p.name, p.why])), '');
  const part = (title, list) => {
    L.push(`## ${title} (${list.length})`, '', C.table(['Сортамент', 'Ед.', 'Форматы (основной — ★)', 'Примечание'], list.map((p) => [p.name, p.unit, p.formats.map((f) => `${f.isDefault ? '★ ' : ''}${f.format || '—'}`).join('; '), [p.tieNote, p.existingId ? 'сортамент уже есть' : ''].filter(Boolean).join('; ')])), '');
  };
  part('Листы', sheets);
  part('Трубы', pipes);
  const odd = plan.profiles.flatMap((p) => p.formats.filter((f) => /куски|без длины/.test(f.format || '')).map((f) => [p.name, f.name, f.format]));
  if (odd.length) L.push('## Особые форматы (куски, без длины)', '', C.table(['Сортамент', 'Позиция склада', 'Формат'], odd), '');
  L.push('## Спорное — решает пользователь', '',
    '- Обрезок листа (`offcutOf`) в сортамент не входит и остаётся отдельной позицией.',
    '- Мытая и не мытая труба — разные складские позиции одного сортамента; признак мытья остаётся у позиции (`washed`), в сортамент не идёт.',
    '- Позиции «Труба профильная нерж. 40×20» и «40×1,5»: размер в названии неоднозначен (в позиции толщина записана как 20) — толщина сортамента не заполняется, проверьте глазами.', '');
  return L.join('\n');
}

async function applyPlan(db, plan, { ObjectId }) {
  const col = db.collection('materials');
  const created = [], linked = [];
  for (const p of plan.profiles) {
    let pid;
    const found = await col.findOne({ isProfile: true, name: p.name }, { projection: { _id: 1 } });
    if (found) pid = found._id;
    else {
      const now = new Date();
      pid = new ObjectId();
      const doc = { _id: pid, name: p.name, article: p.article, unit: p.unit, materialKind: 'raw', isProfile: true, scrapFactor: 1, typeName: p.typeName, assortment: p.assortment,
        dimensions: p.dimensions, colors: [], photoIds: [], composition: [], pricePerUnit: 0, stockQty: 0, isSystem: false, deletedAt: null, source: 'c057-profile', createdAt: now, updatedAt: now };
      if (p.materialGrade) doc.materialGrade = p.materialGrade;
      if (p.categoryId) doc.categoryId = new ObjectId(p.categoryId);
      await col.insertOne(doc);
      created.push(String(pid));
    }
    for (const f of p.formats) {
      const set = { profileId: pid };
      if (f.isDefault) set.isDefaultFormat = true;
      const r = await col.updateOne({ _id: new ObjectId(f.id), profileId: { $exists: false } }, { $set: set });
      if (r.modifiedCount) linked.push({ _id: f.id, profileId: String(pid), isDefaultFormat: !!f.isDefault });
    }
  }
  return { created, linked };
}

async function main() {
  const a = C.args();
  const d = await C.load(a);
  try {
    const plan = buildPlan(d.materials);
    const f = C.writePlan(a, 'profiles-plan', { step: 'c057-profiles', source: d.source, createdAt: new Date().toISOString(), ...plan }, render(plan, d.source, d.materials.length));
    const sheets = plan.profiles.filter((p) => p.unit === 'м²'), pipes = plan.profiles.filter((p) => p.unit === 'м');
    const nf = (l) => l.reduce((n, p) => n + p.formats.length, 0);
    console.log(`Сортаменты: листов ${sheets.length} (форматов ${nf(sheets)}), труб ${pipes.length} (форматов ${nf(pipes)}), проблем ${plan.problems.length}, уже связано ${plan.alreadyLinked}\nПлан: ${f.md}`);
    if (a.apply) {
      const { ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), __dirname] })).mongo;
      const r = await applyPlan(d.db, plan, { ObjectId });
      console.log(`ЗАПИСАНО в ${d.db.databaseName}: сортаментов создано ${r.created.length}, форматов связано ${r.linked.length}. Откат (удалить созданные мягко: deletedAt; у связанных убрать profileId/isDefaultFormat): ${C.writeRollback(a, 'c057-profiles', r)}`);
    } else console.log('Только план, ничего не записано. Записать: --apply (MONGO_URI + MONGO_DB).');
  } finally { if (d.client) await d.client.close(); }
}

module.exports = { profileOf, buildPlan, render, applyPlan };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
