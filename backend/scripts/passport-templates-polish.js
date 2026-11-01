'use strict';
/**
 * Шлифовка текстов шаблонов паспорта в базе (коллекция passporttemplates; отчёт — docs/audit/PASSPORT-TEXTS-REVIEW.md).
 * Те же правки, что внесены в scripts/passport-texts.v2.json (ссылки на ГОСТ, обещания, которых нет в паспорте).
 * Шаблон не правится на месте: как и редактор «Тексты», скрипт создаёт новую версию (version + 1, isActive: true),
 * а прежнюю делает неактивной — видно, по какому тексту выдан старый паспорт. Ничего не удаляет.
 * Пункт меняется, только если в активной версии стоит точно «было»; иначе — пропуск с пометкой (правили руками).
 *
 *   MONGO_URI=... MONGO_DB=...  node scripts/passport-templates-polish.js [--apply] [--out файл.json]
 *   без --apply — план с diff «было → станет» (ничего не пишет); --out — выгрузка активных версий «до записи».
 * На прод — только координатор, после «да» пользователя по таблице из отчёта.
 */
const fs = require('fs');
const path = require('path');

// cat — категория текстов (ALL = шаблон ALL_V2); key — раздел; was → to (замена пункта) или after → to (новый пункт после)
const CHANGES = [
  { cat: 'ALL', key: 'general', was: 'Изготовитель вправе вносить в конструкцию изменения, не снижающие безопасность и потребительские свойства изделия; такие изменения могут быть не отражены в паспорте.',
    to: 'Изготовитель вправе вносить в конструкцию изменения, не снижающие безопасность и потребительские свойства изделия.',
    why: '«Изменения могут быть не отражены в паспорте» — паспорт перестаёт соответствовать изделию; повод для претензии проверяющего' },
  { cat: 'ALL', key: 'mounting', was: 'Вокруг изделия оставляют свободное пространство (зону безопасности); его размеры приведены в приложении к паспорту или в проекте площадки.',
    to: 'Вокруг изделия оставляют свободное пространство для безопасного пользования (зону безопасности); её размеры принимают по проекту площадки или по схеме, если она приложена к паспорту.',
    why: 'Схема зоны безопасности печатается только для детского игрового оборудования (решение 1): «приведены в приложении» — обещание, которого в паспорте нет' },
  { cat: 'ALL', key: 'mounting', was: 'Способ крепления изделия к основанию, требования к основанию и порядок сборки приведены в описании способа установки и на схемах, прилагаемых к паспорту.',
    to: 'Способ крепления изделия к основанию, требования к основанию и порядок сборки приведены в описании способа установки и на схемах, если они приложены к паспорту.',
    why: 'Схема фундамента при анкерном креплении не печатается (решение 2), инструкция по сборке — только у разборных изделий' },
  { cat: 'ALL', key: 'service', was: 'При ежедневном визуальном осмотре проверяют отсутствие поломок, острых кромок, выступающих крепёжных деталей и посторонних предметов.',
    to: 'При регулярном визуальном осмотре проверяют отсутствие поломок, острых кромок, выступающих крепёжных деталей и посторонних предметов.',
    why: 'Противоречие п. 1 раздела: периодичность устанавливает эксплуатант; «ежедневно» для скамьи или урны — невыполнимое обязательство' },
  { cat: 'ALL', key: 'acceptance', after: '— М. П.',
    to: 'Изделие упаковано в соответствии с технической документацией изготовителя:',
    why: 'ГОСТ Р 2.610-2019: в паспорте есть «Свидетельство об упаковывании»; у нас его не было' },
  { cat: 'ALL', key: 'acceptance', after: 'Изделие упаковано в соответствии с технической документацией изготовителя:',
    to: '— ответственный за упаковывание: ______________ / ______________________ (подпись / фамилия, инициалы).',
    why: 'Строка подписи к свидетельству об упаковывании' },
  { cat: 'TRN', key: 'moving', was: 'Открытые подшипниковые узлы смазывают в сроки, указанные в таблице обслуживания, а также после зимнего периода.',
    to: 'Открытые подшипниковые узлы, если они требуют смазки, смазывают при периодическом осмотре и после зимнего периода.',
    why: 'Ссылка на «таблицу обслуживания» со сроками — такой таблицы в паспорте нет' },
  { cat: 'DIO', key: 'use', was: 'Правила пользования отдельными элементами приведены в паспорте для каждого элемента.',
    to: 'Правила пользования отдельными элементами, если их установил изготовитель, приведены в описании элементов.',
    why: 'Обещание правил «для каждого элемента» не выполняется, если у элемента правил нет' },
  { cat: 'DIO', key: 'use', was: 'Покрытие в зоне приземления выбирают по {std:GOST_34615} с учётом высоты свободного падения, указанной в технических данных.',
    to: 'Ударопоглощающее покрытие в зоне приземления выбирают по {std:GOST_34614_1} с учётом высоты свободного падения, указанной в технических данных; критическую высоту падения покрытия подтверждают по {std:GOST_34615}.',
    why: 'Неточная ссылка: ГОСТ 34615-2019 — метод определения критической высоты падения, а требования к выбору покрытия — в ГОСТ 34614.1-2019' },
];

const catOf = (c) => (c === 'ALL' ? 'ALL_V2' : c);
const clip = (x, n = 260) => { const t = String(x == null ? '' : x); return t.length > n ? t.slice(0, n - 1) + '…' : t || '(пусто)'; };

/** Применяет правки к копии разделов. Возвращает { sections, items: [{...change, state}] }: ok | same | changed | missing. */
function applyToSections(sections, changes) {
  const out = JSON.parse(JSON.stringify(sections || []));
  const items = [];
  for (const c of changes) {
    const s = out.find((x) => x.key === c.key);
    if (!s) { items.push({ ...c, state: 'missing' }); continue; }
    const p = s.paragraphs;
    if (c.after != null) {
      const i = p.indexOf(c.after);
      if (p[i + 1] === c.to || p.includes(c.to)) items.push({ ...c, state: 'same' });
      else if (i < 0) items.push({ ...c, state: 'changed' });
      else { p.splice(i + 1, 0, c.to); items.push({ ...c, state: 'ok' }); }
    } else {
      const i = p.indexOf(c.was);
      if (i >= 0) { p[i] = c.to; items.push({ ...c, state: 'ok' }); }
      else items.push({ ...c, state: p.includes(c.to) ? 'same' : 'changed' });
    }
  }
  return { sections: out, items };
}

async function buildPlan(db, { changes = CHANGES } = {}) {
  const col = db.collection('passporttemplates');
  const plan = [];
  for (const cat of [...new Set(changes.map((c) => c.cat))]) {
    const active = await col.find({ category: catOf(cat), isActive: true }).sort({ version: -1 }).toArray();
    const doc = active[0];
    const mine = changes.filter((c) => c.cat === cat);
    if (!doc) { plan.push({ cat, doc: null, items: mine.map((c) => ({ ...c, state: 'missing' })), extraActive: 0 }); continue; }
    const r = applyToSections(doc.sections, mine);
    plan.push({ cat, doc, sections: r.sections, items: r.items, extraActive: active.length - 1 });
  }
  return plan;
}

async function applyPlan(db, plan, { now = new Date() } = {}) {
  const col = db.collection('passporttemplates');
  const res = { versions: 0, skipped: 0 };
  for (const p of plan) {
    if (!p.doc || !p.items.some((i) => i.state === 'ok')) { res.skipped++; continue; }
    const last = await col.find({ category: p.doc.category }).sort({ version: -1 }).limit(1).toArray();
    const version = (last[0]?.version ?? 0) + 1;
    // снять активность только с той версии, по которой строили план (и если её никто не сменил)
    const off = await col.updateOne({ _id: p.doc._id, isActive: true, updatedAt: p.doc.updatedAt }, { $set: { isActive: false, updatedAt: now } });
    if (!off.modifiedCount) { res.skipped++; continue; }
    await col.insertOne({ version, isActive: true, category: p.doc.category, sections: p.sections, tables: p.doc.tables || [], createdAt: now, updatedAt: now, __v: 0 });
    res.versions++;
  }
  return res;
}

const WHY = { same: 'уже стоит', changed: 'в базе другой текст пункта — пропуск, смотреть вручную', missing: 'нет активного шаблона или раздела' };

function printPlan(plan, log = console.log) {
  for (const p of plan) {
    const n = (s) => p.items.filter((i) => i.state === s).length;
    log(`\n=== ${catOf(p.cat)} ${p.doc ? 'v' + p.doc.version + ' → v' + (p.doc.version + 1) : '(нет активного)'} · к записи ${n('ok')}, уже стоит ${n('same')}, пропуск ${n('changed') + n('missing')}${p.extraActive ? ` · ⚠ активных версий ещё ${p.extraActive}` : ''}`);
    for (const i of p.items) {
      log(`[${i.key}]${i.state === 'ok' ? '' : '  ⚠ ' + WHY[i.state]}`);
      if (i.after != null) log(`  + после: ${clip(i.after)}`); else log(`  - ${clip(i.was)}`);
      log(`  + ${clip(i.to)}`);
      log(`  почему: ${i.why}`);
    }
  }
}

module.exports = { CHANGES, applyToSections, buildPlan, applyPlan, printPlan };

if (require.main === module) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); const outFile = i > 0 ? process.argv[i + 1] : null;
  const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const plan = await buildPlan(db);
    printPlan(plan);
    if (outFile) {
      fs.writeFileSync(outFile, JSON.stringify(plan.filter((p) => p.doc).map((p) => p.doc), null, 2));
      console.log(`\nВыгрузка активных версий «до записи» (откат: вернуть им isActive: true, новой — false): ${outFile}`);
    }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    const r = await applyPlan(db, plan);
    console.log(`\nГотово: новых версий ${r.versions}, пропущено категорий ${r.skipped}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
