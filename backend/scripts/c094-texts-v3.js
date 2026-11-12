#!/usr/bin/env node
/**
 * C094: тексты паспортов подходят к изделию — условия применимости (`when`) у пунктов (docs/crew/C094-passport-text-fit/PLAN.md §3).
 * Новая версия «Для всех» (ALL_V2 v3) и версий категорий BLG / WRK / DIO. Меняются ТОЛЬКО условия: тексты пунктов остаются
 * такими, какие стоят в активной версии на сервере (правки владельца не теряются). Выданные паспорта читают свой снимок — не меняются.
 * Пункт находится по разделу + коду (ids; нет ids — p1, p2 … по порядку) и должен содержать «метку» (кусок текста): иначе его правили — пропуск.
 * Уже стоит другое условие — пропуск (правили руками). Прежняя версия остаётся неактивной (откат: вернуть ей isActive, новой снять).
 *
 *   MONGO_URI=… MONGO_DB=… node backend/scripts/c094-texts-v3.js [--apply]
 *   На проде: bash deploy/synology/c094-texts.sh [--apply]  (через remote-access/run-script.sh)
 * Без --apply — только план. Запись требует, чтобы у видов изделия уже стояли признаки (c094-traits.js), иначе пункты выпадут у всех.
 */
const path = require('path');

// [шаблон, раздел, код пункта, метка в тексте, условие]. Метки — по тексту прода 2026-11-12.
const RULES = [
  ['ALL_V2', 'mounting', 'p2', 'корней деревьев', '!atTree'],
  ['ALL_V2', 'mounting', 'p3', 'зону безопасности', 'users'],
  ['ALL_V2', 'mounting', 'p7', 'SP_70', 'concrete'],
  ['ALL_V2', 'mounting', 'p8', 'вертикальность стоек', 'concrete|bolts'],
  ['ALL_V2', 'mounting', 'p9', 'концы анкеров', 'anchors'],
  ['ALL_V2', 'service', 'p7', 'затяжку резьбовых', 'bolts|welds'],
  ['ALL_V2', 'repair', 'p3', 'Снимать ограждения', 'guards'],
  ['ALL_V2', 'repair', 'p4', 'от ржавчины', 'metal'],
  ['ALL_V2', 'storage', 'p6', 'металлические поверхности без покрытия', 'metal'],
  ['ALL_V2', 'storage', 'p7', 'гниение древесины', 'metal|wood'],
  ['ALL_V2', 'disposal', 'p5', 'металлолом', 'metal'],
  ['ALL_V2', 'disposal', 'p6', 'Сжигать', 'wood'],
  ['ALL_V2', 'warranty', 'p12', 'подвижных частей', 'moving'],
  ['BLG', 'care', 'p3', 'Ёмкости для мусора', 'bin'],
  ['WRK', 'use', 'p2', 'собственным весом', 'bars'],
  ['WRK', 'use', 'p3', 'Подвешивать', 'bars'],
  ['WRK', 'use', 'p4', 'перекладин', 'bars'],
  ['WRK', 'use', 'p6', 'махов', 'bars'],
  ['WRK', 'use', 'p7', 'Спрыгивают', 'bars'],
  ['WRK', 'checks', 'p1', 'проворачиваются', 'bars'],
  ['WRK', 'checks', 'p3', 'хвата', 'bars'],
  ['DIO', 'use', 'p9', 'Зона приземления', 'landing'],
  ['DIO', 'use', 'p10', 'зоне приземления', 'landing'],
  ['DIO', 'inspections', 'p2', 'зоны приземления', 'landing'],
];
// Только эти условия «лечатся» поверх уже стоящего: прежнее условие — известная ошибка кода (storage p7 стоял как wood).
const REPLACE = { 'ALL_V2/storage/p7': ['wood'] };

const clip = (x, n = 90) => { const t = String(x ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const idsOf = (s) => s.paragraphs.map((_, i) => String((Array.isArray(s.ids) && s.ids.length === s.paragraphs.length ? s.ids[i] : '') || `p${i + 1}`));

/** Применяет правила к копии разделов. Возвращает { sections, items[{rule, state, was?}] }: ok | same | hand | text | missing. */
function applyRules(sections, rules) {
  const out = JSON.parse(JSON.stringify(sections || []));
  const items = [];
  const touched = new Set();
  for (const [cat, key, pid, mark, when] of rules) {
    const s = out.find((x) => x.key === key);
    const i = s ? idsOf(s).indexOf(pid) : -1;
    if (i < 0) { items.push({ cat, key, pid, when, state: 'missing' }); continue; }
    if (!String(s.paragraphs[i]).toLowerCase().includes(mark.toLowerCase())) { items.push({ cat, key, pid, when, state: 'text', text: s.paragraphs[i] }); continue; }
    if (!Array.isArray(s.when) || s.when.length !== s.paragraphs.length) s.when = s.paragraphs.map(() => null);
    const was = String(s.when[i] ?? '').trim();
    const fixes = REPLACE[`${cat}/${key}/${pid}`] || [];
    if (was === when) { items.push({ cat, key, pid, when, was, state: 'same', text: s.paragraphs[i] }); continue; }
    if (was && !fixes.includes(was)) { items.push({ cat, key, pid, when, was, state: 'hand', text: s.paragraphs[i] }); continue; }
    s.when[i] = when; touched.add(key);
    items.push({ cat, key, pid, when, was, state: 'ok', text: s.paragraphs[i] });
  }
  for (const s of out) {
    if (!touched.has(s.key)) continue;
    if (!Array.isArray(s.ids) || s.ids.length !== s.paragraphs.length) s.ids = idsOf(s); // коды как были по порядку — явными
  }
  return { sections: out, items };
}

const WHY = { same: 'уже стоит', hand: 'в базе другое условие — пропуск (правили руками)', text: 'текст пункта другой — пропуск (правили руками)', missing: 'нет такого раздела или пункта' };

async function buildPlan(db, rules = RULES) {
  const col = db.collection('passporttemplates');
  const plan = [];
  for (const cat of [...new Set(rules.map((r) => r[0]))]) {
    const doc = (await col.find({ category: cat, isActive: true }).sort({ version: -1 }).limit(1).toArray())[0];
    const mine = rules.filter((r) => r[0] === cat);
    if (!doc) { plan.push({ cat, doc: null, items: mine.map((r) => ({ cat, key: r[1], pid: r[2], when: r[4], state: 'missing' })) }); continue; }
    plan.push({ cat, doc, ...applyRules(doc.sections, mine) });
  }
  return plan;
}

/** Условия считаются верными, только если у видов изделия уже стоят признаки (иначе у изделий с видом пункты выпадут). */
async function traitsReady(db) {
  const rows = await db.collection('dict_values').find({ dict: 'passportElements', deletedAt: null }).project({ traits: 1 }).toArray();
  const has = (c) => rows.some((r) => new RegExp(`(^|[\\s,;])${c}($|[\\s,;])`).test(String(r.traits || '')));
  return ['guards', 'bin', 'bars', 'landing'].filter((c) => !has(c));
}

async function applyPlan(db, plan, now = new Date()) {
  const col = db.collection('passporttemplates');
  const res = { versions: 0, skipped: 0 };
  for (const p of plan) {
    if (!p.doc || !p.items.some((i) => i.state === 'ok')) { res.skipped++; continue; }
    const last = (await col.find({ category: p.doc.category }).sort({ version: -1 }).limit(1).toArray())[0];
    // ARCH C094 п.1: новая версия сначала неактивна; затем снять активность со старой (если её никто не сменил) и включить новую.
    // Сбой между шагами — старая версия возвращается активной, категория не остаётся без текста.
    const { _id, ...rest } = p.doc;
    const ins = await col.insertOne({ ...rest, version: (last ? last.version : 0) + 1, isActive: false, sections: p.sections, createdAt: now, updatedAt: now });
    const off = await col.updateOne({ _id: p.doc._id, isActive: true, version: p.doc.version }, { $set: { isActive: false, updatedAt: now } });
    if (!off.modifiedCount) { await col.deleteOne({ _id: ins.insertedId, isActive: false }); res.skipped++; continue; }
    try {
      await col.updateOne({ _id: ins.insertedId }, { $set: { isActive: true } });
    } catch (e) {
      await col.updateOne({ _id: p.doc._id }, { $set: { isActive: true } });
      throw e;
    }
    res.versions++;
  }
  return res;
}

function printPlan(plan, log = console.log) {
  for (const p of plan) {
    const n = (s) => p.items.filter((i) => i.state === s).length;
    log(`\n=== ${p.cat} ${p.doc ? 'v' + p.doc.version + ' → v' + (p.doc.version + 1) : '(нет активной версии)'} · к записи ${n('ok')}, уже стоит ${n('same')}, пропуск ${n('hand') + n('text') + n('missing')}`);
    for (const i of p.items) log(`${i.state === 'ok' ? '  +' : '  ·'} ${i.key}.${i.pid}  ${i.was ? i.was + ' → ' : ''}${i.when}  «${clip(i.text)}»${i.state === 'ok' ? '' : '  ⚠ ' + WHY[i.state]}`);
  }
}

module.exports = { RULES, applyRules, buildPlan, applyPlan, traitsReady, printPlan };

if (!module.parent && !process.env.JEST_WORKER_ID) (async () => {
  const apply = process.argv.includes('--apply');
  const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  try {
    const db = client.db(process.env.MONGO_DB || 'datacore');
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const plan = await buildPlan(db);
    printPlan(plan);
    const todo = plan.reduce((a, p) => a + p.items.filter((i) => i.state === 'ok').length, 0);
    console.log(`\nвсего к записи ${todo} условий; тексты пунктов не меняются; выданные паспорта не меняются.`);
    const lack = await traitsReady(db);
    if (lack.length) console.log(`⚠ у видов изделия нет признаков: ${lack.join(', ')} — сначала c094-traits`);
    // ARCH C094 п.5: выданный паспорт без снимка текста при печати соберёт текст по новой версии — тогда не пишем.
    const bare = await db.collection('productpassports').find({ status: 'issued', deletedAt: null, $or: [{ 'textSnapshot.sections': { $exists: false } }, { 'textSnapshot.sections': { $size: 0 } }] }).project({ number: 1 }).toArray();
    console.log(`выданных паспортов без снимка текста: ${bare.length}${bare.length ? ' — № ' + bare.slice(0, 20).map((x) => x.number).join(', ') : ''}`);
    if (!apply) { console.log('ПЛАН. Запись — только с --apply.'); return; }
    if (bare.length) throw new Error('стоп: есть выданные паспорта без снимка текста — их печать изменится; сначала снимок');
    if (lack.length) throw new Error('стоп: сначала запишите признаки видов (c094-traits), иначе пункты выпадут у изделий с видом');
    const r = await applyPlan(db, plan);
    console.log(`записано: новых версий ${r.versions}, пропущено шаблонов ${r.skipped}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
