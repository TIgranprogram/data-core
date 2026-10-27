#!/usr/bin/env node
/**
 * Каталог сайта = Excel «Каталог оборудования СпортИН-ЮГ» (лист «Перечень изделий 2026»; выгрузка — catalog-excel.json).
 *   node scripts/catalog-from-excel.js <local|prod>                            - план, ничего не пишет
 *   node scripts/catalog-from-excel.js <local|prod> --apply --out откат.json   - запись
 * Только через API: POST/PATCH /api/dicts/productSections|productGroups (создать раздел/группу с groupNo, перенести группу в раздел),
 * PATCH /api/showcase/:id {type, group} (изделие; артикул не трогаем). Ничего не удаляется: пустые старые разделы/группы - пометка в плане.
 * Порядок записи: 1) разделы 2) группы (создать / перенести в раздел) 3) изделия. Группы создаются ДО переноса изделий:
 * showcase сам создал бы группу без groupNo.
 * Истина: артикул есть в Excel -> раздел/группа оттуда; иначе правила GROUP_RULES/SECTION_RULES по старому названию; не нашли - спорное (остаётся).
 * 4) Новые изделия: нет артикула (skuKey без пробелов, с корзиной) и нет того же названия в группе -> POST /api/showcase (draft, без цены);
 *    в корзине тот же артикул -> restore + type/group; то же название при другом артикуле - только «спорные». Порядок: разделы, группы, переезд, новые.
 *    Откат новых: log.created (id) - в корзину; log.restored (id) - обратно в корзину.
 * Откат: изделия - PATCH showcase {type: old.type, group: old.group}; перенесённые группы - PATCH dicts/productGroups/<id> {name, parentId: old};
 * созданные разделы/группы - вручную в корзину (пустые).
 */
const fs = require('fs');
const path = require('path');

const [env, ...flags] = process.argv.slice(2);
if (!['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply --out откат.json]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const NOCREATE = flags.includes('--no-create');
const OUT = flags[flags.indexOf('--out') + 1];
if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';
const EXCEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-excel.json'), 'utf8'));

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const skuKey = (s) => norm(s).replace(/\s/g, ''); // «11_10» ≠ «1110»: подчёркивание/дефис/точка значимы (иначе качели совпадали с баскетбольной стойкой)
const SPORT = 'Спортивное оборудование', KIDS = 'Оборудование для детских игровых площадок', TERR = 'Оборудование для благоустройства территории';

const XGROUPS = new Map();
EXCEL.forEach((r) => { const k = norm(r.type) + '|' + norm(r.group); if (!XGROUPS.has(k)) XGROUPS.set(k, { type: r.type, group: r.group, groupNo: r.groupNo, n: 0 }); XGROUPS.get(k).n++; });
const XSECTIONS = [...new Set(EXCEL.map((r) => r.type))];
const XBYSKU = new Map(EXCEL.map((r) => [skuKey(r.sku), r]));
const xg = (type, group) => XGROUPS.get(norm(type) + '|' + norm(group));

// старое название на сайте -> [раздел, группа] из Excel. Сначала по группе, потом по разделу.
const GROUP_RULES = [
  [/^скам/, TERR, 'Скамьи'], [/^урн/, TERR, 'Урны'], [/^стол/, TERR, 'Столы'], [/навес|беседк|пергол/, TERR, 'Навесы'],
  [/огражд/, TERR, 'Ограждения'], [/велопарков/, TERR, 'Велопарковки'], [/информац|стенд|указател/, TERR, 'Информационные стенды и указатели'],
  [/трибун|амфитеатр/, TERR, 'Трибуны'], [/невошедш|благоустр/, TERR, 'Благоустройство (оборудование невошедшее в другие группы)'],
  [/тренажер/, SPORT, 'Тренажеры'], [/воркаут/, SPORT, 'Воркаут'], [/спорт\S* оборуд/, SPORT, 'Спорт оборудование'],
  [/карусел/, KIDS, 'Карусели'], [/балансир/, KIDS, 'Качалка-балансир'], [/пружин/, KIDS, 'Качалка на пружине'], [/качел/, KIDS, 'Качели'],
  [/игров\S* комплекс/, KIDS, 'Детские игровые комплексы'], [/детск\S* игров\S* оборуд|детское игровое/, KIDS, 'Детское игровое оборудование'],
];
const SECTION_RULES = [
  [/воркаут/, SPORT, 'Воркаут'], [/тренажер/, SPORT, 'Тренажеры'], [/спорт/, SPORT, 'Спорт оборудование'],
  [/качел/, KIDS, 'Качели'], [/игров\S* комплекс/, KIDS, 'Детские игровые комплексы'], [/детск/, KIDS, 'Детское игровое оборудование'],
  [/благоустр/, TERR, 'Благоустройство (оборудование невошедшее в другие группы)'],
];
// без однозначного соответствия - только в «спорные»
const NO_MATCH = /мебель|вывеск|упаковк/;

function target(p) {
  const x = XBYSKU.get(skuKey(p.sku));
  if (x) return { type: x.type, group: x.group, how: 'Excel' };
  const g = norm(p.group), t = norm(p.type);
  if (NO_MATCH.test(t) || NO_MATCH.test(g)) return null;
  for (const [re, sec, grp] of GROUP_RULES) if (g && re.test(g)) return { type: sec, group: grp, how: 'правило' };
  for (const [re, sec, grp] of SECTION_RULES) if (re.test(t)) return { type: sec, group: grp, how: 'правило' };
  return null;
}

function creds() {
  const d = path.join(__dirname, '../../deploy/synology');
  const get = (k, f) => { try { const m = fs.readFileSync(path.join(d, f), 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].replace(/["\r]/g, '') : ''; } catch { return ''; } };
  return { username: get('ACCESS_USER', 'access.env') || 'admin', password: get('ACCESS_PASSWORD', 'access.env') || get('ADMIN_PASSWORD', 'config.env') };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = '';
async function login() {
  const c = creds();
  if (!c.password) throw new Error('нет пароля (config.env / access.env)');
  const j = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }).then((r) => r.json());
  token = j.access || j.tokens?.access;
  if (!token) throw new Error('вход не удался');
}
async function api(method, p, body) {
  for (let i = 0; ; i++) {
    await sleep(700); // лимит 100/мин
    const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 && i < 5) { await sleep(15000); continue; }
    if (r.status === 401 && i < 2) { await sleep(13000); await login(); continue; } // перевход только на 401 (лимит входа 20/час)
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${typeof j === 'object' ? j.message : txt.slice(0, 200)}`);
    return j;
  }
}

(async () => {
  console.log(`1) EXCEL: разделов ${XSECTIONS.length}, групп ${XGROUPS.size}, изделий ${EXCEL.length}`);
  XSECTIONS.forEach((s) => { console.log('  ' + s); [...XGROUPS.values()].filter((g) => g.type === s).forEach((g) => console.log(`    №${g.groupNo} ${g.group} (${g.n})`)); });

  await login();
  const sections = (await api('GET', '/api/dicts/productSections')).items;
  const groups = (await api('GET', '/api/dicts/productGroups')).items;
  const items = []; for (let page = 1; ; page++) { const r = await api('GET', `/api/showcase?limit=500&page=${page}`); items.push(...r.items); if (items.length >= r.total || !r.items.length) break; }
  const secById = new Map(sections.map((s) => [String(s.id), s]));
  const cnt = (gid) => items.filter((p) => p.groupId === String(gid)).length;
  console.log(`\n2) САЙТ сейчас (изделий ${items.length}):`);
  sections.forEach((s) => { const gs = groups.filter((g) => String(g.parentId) === String(s.id)); console.log(`  ${s.name}  [групп ${gs.length}]`); gs.forEach((g) => console.log(`    №${g.groupNo || '—'} ${g.name} (${cnt(g.id)})`)); });

  // 3) что создать / перенести
  const secPlan = [], grpPlan = [], disputed = [];
  const secOf = new Map();
  for (const name of XSECTIONS) { const f = sections.find((s) => norm(s.name) === norm(name)); secOf.set(name, f ? String(f.id) : null); if (!f) secPlan.push({ name }); }
  for (const x of XGROUPS.values()) {
    const sid = secOf.get(x.type);
    const same = groups.filter((g) => norm(g.name) === norm(x.group));
    const inSec = sid && same.find((g) => String(g.parentId) === sid);
    if (inSec) { grpPlan.push({ act: inSec.groupNo === x.groupNo ? 'ok' : 'warn', x, g: inSec, note: `номер на сайте ${inSec.groupNo || '—'}, в Excel ${x.groupNo} (менять нельзя)` }); continue; }
    const taken = groups.find((g) => g.groupNo === x.groupNo && norm(g.name) !== norm(x.group));
    const cand = same.slice().sort((a, b) => (b.groupNo === x.groupNo) - (a.groupNo === x.groupNo) || cnt(b.id) - cnt(a.id))[0];
    if (cand && (!cand.groupNo || cand.groupNo === x.groupNo)) { grpPlan.push({ act: 'move', x, g: cand, note: `из «${secById.get(String(cand.parentId))?.name}»` }); continue; }
    if (taken) { disputed.push({ group: x.group, text: `группа «${x.group}» №${x.groupNo}: номер занят группой «${taken.name}» (${secById.get(String(taken.parentId))?.name}) - решает пользователь` }); continue; }
    grpPlan.push({ act: 'create', x, note: cand ? `(на сайте «${cand.name}» с номером ${cand.groupNo} - не совпал)` : '' });
  }
  console.log('\n3) СООТВЕТСТВИЕ сайт -> Excel:');
  secPlan.forEach((s) => console.log(`  раздел «${s.name}»: СОЗДАТЬ`));
  grpPlan.forEach((q) => console.log(`  ${q.x.type} / ${q.x.group} №${q.x.groupNo}: ${q.act === 'ok' ? 'есть' : q.act === 'warn' ? 'есть, ⚠ ' + q.note : q.act === 'move' ? 'ПЕРЕНЕСТИ ' + q.note : 'СОЗДАТЬ ' + q.note}`));
  disputed.forEach((d) => console.log('  ⚠ ' + d.text));

  // 4) изделия
  const skip = new Set(disputed.map((d) => d.group));
  const moves = [], stay = [], same = [];
  for (const p of items) {
    const t = target(p);
    if (!t || skip.has(t.group) || !xg(t.type, t.group)) { stay.push(p); continue; }
    if (norm(p.type) === norm(t.type) && norm(p.group) === norm(t.group)) { same.push(p); continue; }
    moves.push({ p, t });
  }
  console.log(`\n4) ИЗДЕЛИЯ: уже на месте ${same.length}, переедут ${moves.length}, спорные (остаются) ${stay.length}. Артикул не меняется.`);
  const agg = {}; moves.forEach(({ p, t }) => { const k = `${p.type || '—'} / ${p.group || '—'} -> ${t.type} / ${t.group}  [${t.how}]`; agg[k] = (agg[k] || 0) + 1; });
  Object.entries(agg).sort().forEach(([k, n]) => console.log(`  ${n} | ${k}`));
  console.log('СПОРНЫЕ - решает пользователь (раздел / группа: изделий):');
  const sa = {}; stay.forEach((p) => { const k = `${p.type || '—'} / ${p.group || '—'}`; (sa[k] = sa[k] || []).push(p.sku); });
  Object.entries(sa).sort().forEach(([k, v]) => console.log(`  ${k}: ${v.length} (${v.slice(0, 3).join(', ')}${v.length > 3 ? '…' : ''})`));

  // 5) новые изделия: есть в Excel, нет на сайте (ни по артикулу, ни по названию в той же группе); корзина - восстановить
  const trash = []; for (let page = 1; ; page++) { const r = await api('GET', `/api/showcase?limit=500&page=${page}&deleted=1`); trash.push(...r.items); if (trash.length >= r.total || !r.items.length) break; }
  const LOOK = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };
  const sk = (s) => norm(s).replace(/[×*]/g, 'х').replace(/[abcehkmoptxy]/g, (c) => LOOK[c]).replace(/\s/g, '');
  const nn = (s) => norm(s).replace(/[«»"“”„'`]/g, '').replace(/\s+/g, ' ').trim();
  const liveSku = new Set(items.map((p) => sk(p.sku))), trashBySku = new Map(trash.map((p) => [sk(p.sku), p]));
  const xSkus = new Set(EXCEL.map((r) => sk(r.sku)));
  const words = (s) => new Set(nn(s).replace(/[^a-zа-я0-9\s]/g, ' ').split(' ').filter((w) => w.length >= 4));
  const jac = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; a.forEach((w) => b.has(w) && i++); return i / (a.size + b.size - i); };
  // кандидаты на сопоставление: изделия сайта, чей артикул не из Excel (иначе они уже совпали по артикулу)
  const pool = items.filter((p) => !xSkus.has(sk(p.sku))).map((p) => ({ p, w: words(p.name) }));
  const rest = EXCEL.filter((r) => !liveSku.has(sk(r.sku)) && !trashBySku.has(sk(r.sku)));
  const restores = EXCEL.filter((r) => !liveSku.has(sk(r.sku)) && trashBySku.has(sk(r.sku))).map((r) => ({ r, p: trashBySku.get(sk(r.sku)) }));
  const pairs = [];
  for (const r of rest) { const rw = words(r.name); for (const c of pool) {
    const eq = nn(r.name) === nn(c.p.name);
    const sc = eq ? 1 : jac(rw, c.w) + (norm(c.p.type) === norm(r.type) ? 0.05 : 0);
    if (sc >= 0.5) pairs.push({ r, p: c.p, sc: Math.min(sc, 1) });
  } }
  pairs.sort((x, y) => y.sc - x.sc);
  const usedR = new Set(), usedP = new Set(), sameP = [], disp = [], creates = [];
  for (const q of pairs) if (q.sc >= 0.85 && !usedR.has(q.r) && !usedP.has(q.p.id)) { usedR.add(q.r); usedP.add(q.p.id); sameP.push(q); }
  for (const r of rest) {
    if (usedR.has(r)) continue;
    const best = pairs.find((q) => q.r === r); // лучший кандидат, даже если уже занят другой строкой
    if (best) disp.push(best); else creates.push(r);
  }
  const NOTE = '⚠ Проверить (каталог 28.10): ';
  const noteFor = (q, isSame) => isSame
    ? `${NOTE}в Excel это «${q.r.name}» с артикулом ${q.r.sku}. Рекомендуем: сменить артикул на ${q.r.sku}.`
    : `${NOTE}похоже на «${q.r.name}» (${q.r.sku}) из Excel. Если это одно изделие - сменить артикул; если разные - завести ${q.r.sku} отдельно.`;
  const notes = new Map(); // id -> {p, lines}
  const addNote = (p, line) => { if (!notes.has(p.id)) notes.set(p.id, { p, lines: [] }); const n = notes.get(p.id); if (!n.lines.includes(line) && !String(p.notes || '').includes(line)) n.lines.push(line); };
  sameP.forEach((q) => addNote(q.p, noteFor(q, true)));
  disp.forEach((q) => addNote(q.p, noteFor(q, false)));
  const mv5 = sameP.filter((q) => norm(q.p.type) !== norm(q.r.type) || norm(q.p.group) !== norm(q.r.group));
  console.log(`
5) НОВЫЕ ИЗДЕЛИЯ (артикулы не меняем, дублей не создаём): то же изделие ${sameP.length} (переедут ${mv5.length}), спорные ${disp.length}, создать ${NOCREATE ? 0 : creates.length}${NOCREATE ? ' (--no-create)' : ''}, из корзины ${restores.length}`);
  console.log('ТО ЖЕ ИЗДЕЛИЕ (≥0.85): сайт -> Excel');
  sameP.forEach((q) => console.log(`  ${q.p.sku} «${q.p.name}» = ${q.r.sku} «${q.r.name}» (${q.sc.toFixed(2)}) -> ${q.r.type} / ${q.r.group}`));
  console.log('СПОРНЫЕ (0.5-0.85 или изделие уже занято другой строкой) - не создаём, решает пользователь:');
  disp.forEach((q) => console.log(`  Excel ${q.r.sku} «${q.r.name}» ~ сайт ${q.p.sku} «${q.p.name}» (${q.sc.toFixed(2)})`));
  console.log('СОЗДАТЬ (<0.5, похожих нет): ' + creates.length);
  creates.slice(0, 10).forEach((r) => console.log(`  + ${r.sku} | ${r.name} | ${r.type} / ${r.group}`));
  restores.slice(0, 10).forEach(({ r }) => console.log(`  ↺ из корзины ${r.sku} | ${r.name}`));
  console.log(`ПОМЕТКИ в notes: ${[...notes.values()].filter((n) => n.lines.length).length} изделий`);

  // пустеющие - только пометка
  const moveIds = new Set(moves.map((m) => m.p.id));
  const keepG = new Set(grpPlan.filter((q) => q.g).map((q) => String(q.g.id)));
  const empty = groups.filter((g) => !keepG.has(String(g.id)) && !items.some((p) => p.groupId === String(g.id) && !moveIds.has(p.id)));
  console.log('\nПосле переноса пустые - можно убрать после проверки (не удаляется):');
  console.log('  группы: ' + (empty.map((g) => `${g.name} [${secById.get(String(g.parentId))?.name}]`).join('; ') || '—'));
  console.log('  разделы вне Excel: ' + (sections.filter((s) => !XSECTIONS.some((x) => norm(x) === norm(s.name))).map((s) => s.name).join('; ') || '—') + ' (если там остались спорные изделия - после решения)');
  if (!APPLY) return console.log('\nплан - ничего не записано; запись: --apply --out откат.json');

  const log = { sections: [], groups: [], products: [] };
  const sid = new Map([...secOf].filter(([, v]) => v));
  try {
    for (const s of secPlan) { const r = await api('POST', '/api/dicts/productSections', { name: s.name }); sid.set(s.name, String(r.id)); log.sections.push({ id: r.id, name: s.name }); }
    for (const q of grpPlan) {
      if (q.act === 'create') { const r = await api('POST', '/api/dicts/productGroups', { name: q.x.group, groupNo: q.x.groupNo, parentId: sid.get(q.x.type) }); log.groups.push({ act: 'create', id: r.id, name: q.x.group }); }
      if (q.act === 'move') { await api('PATCH', `/api/dicts/productGroups/${q.g.id}`, { name: q.g.name, parentId: sid.get(q.x.type) }); log.groups.push({ act: 'move', id: q.g.id, name: q.g.name, oldParentId: q.g.parentId }); }
    }
    for (const { p, t } of moves) { await api('PATCH', `/api/showcase/${p.id}`, { type: t.type, group: t.group }); log.products.push({ id: p.id, sku: p.sku, old: { type: p.type, group: p.group }, now: { type: t.type, group: t.group } }); }
    log.created = []; log.restored = []; log.notes = []; log.moved5 = [];
    for (const q of mv5) { await api('PATCH', `/api/showcase/${q.p.id}`, { type: q.r.type, group: q.r.group }); log.moved5.push({ id: q.p.id, old: { type: q.p.type, group: q.p.group } }); }
    for (const { p, lines } of notes.values()) { if (!lines.length) continue; await api('PATCH', `/api/showcase/${p.id}`, { notes: [...lines, ...(p.notes ? [p.notes] : [])].join('\n') }); log.notes.push({ id: p.id, oldNotes: p.notes || '' }); }
    if (!NOCREATE) {
      for (const { r, p } of restores) { await api('POST', `/api/showcase/${p.id}/restore`); await api('PATCH', `/api/showcase/${p.id}`, { type: r.type, group: r.group }); log.restored.push({ id: p.id, sku: r.sku }); }
      for (const r of creates) { const c = await api('POST', '/api/showcase', { name: r.name, sku: r.sku, type: r.type, group: r.group, status: 'draft' }); log.created.push({ id: c.id, sku: r.sku }); }
    }
  } finally { fs.writeFileSync(OUT, JSON.stringify(log, null, 1)); }
  console.log(`готово: разделов ${log.sections.length}, групп ${log.groups.length}, изделий ${log.products.length}; откат - ${OUT}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
