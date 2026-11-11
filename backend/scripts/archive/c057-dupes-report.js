/* C057-Э0 шаг 4: отчёт дублей номенклатуры по ключу сравнения. ТОЛЬКО ОТЧЁТ — ничего не пишет. Объединение дублей — отдельный шаг
 * (ссылки stockmovements, reservations, supplyrequests общие с CRM kppdf — DECISIONS п. 16).
 *
 *   node scripts/c057-dupes-report.js --from <папка выгрузки>      (или MONGO_URI/MONGO_DB — чтение)
 *
 * Ключ — правило common/catalog/match-key.ts (JS-копия scripts/lib/c057-match.js). Считается дважды: «до» — по полям позиции как есть,
 * «после» — как если бы применили шаги 1–2 (вид по категории и разбор названий). Группа с одинаковым ключом делится на:
 *   • форматы сортамента — листы и трубы: один сортамент, разные форматы (ключ листа без формата, Л13) — не дубль, это работа шага 5;
 *   • разные числа — в названиях разные числа (цвет RAL, размер, количество в упаковке): ключ их не различает — не дубль;
 *   • вероятный дубль — всё совпало: решает человек.
 * Отдельно — совпадения названий после приведения (регистр, пробелы, ё/е, латиница/кириллица, знаки). */
'use strict';
const C = require('./lib/c057-common');
const { matchKey } = require('./lib/c057-match');
const { groupOf, parseName, fillEmpty } = require('./lib/c057-parse');
const { targetKind } = require('./c057-kind');

const LAT = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };
const foldName = (s) => [...String(s).toLowerCase().replace(/ё/g, 'е')].map((ch) => LAT[ch] || ch).join('').replace(/[^a-zа-я0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const numsOf = (s) => (String(s).replace(/(\d),(\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/g) || []).sort().join(',');

function inputOf(m, after) {
  const g = groupOf(m.catName, m.name);
  let typeName = m.typeName, standardRef = m.standardRef, materialGrade = m.materialGrade, assortment = m.assortment, dimensions = m.dimensions || [];
  let kind = m.materialKind || null;
  if (after) {
    const p = parseName(m.name, g, m.catName), { set, addDims } = fillEmpty(m, p);
    typeName = set.typeName || typeName; standardRef = set.standardRef || standardRef; materialGrade = set.materialGrade || materialGrade; assortment = set.assortment || assortment;
    dimensions = [...dimensions, ...addDims];
    kind = kind || targetKind(m).to;
  }
  return { kind, typeName, standardRef, materialGrade, assortment, dimensions, name: m.name };
}

function groups(materials, after) {
  const map = new Map();
  for (const m of materials) {
    const key = matchKey(inputOf(m, after));
    if (!key) continue;
    (map.get(key) || map.set(key, []).get(key)).push(m);
  }
  return [...map.entries()].filter(([, l]) => l.length > 1).map(([key, list]) => ({ key, list }));
}

function classify(g) {
  const gr = g.list.map((m) => groupOf(m.catName, m.name));
  if (gr.every((x) => x === 'sheet' || x === 'pipe')) return 'format';
  if (new Set(g.list.map((m) => numsOf(m.name))).size > 1) return 'numbers';
  return 'dupe';
}

function buildReport(all) {
  const materials = all.filter((m) => !m.isProfile); // сортамент и его форматы имеют один ключ по замыслу (Л13) — не дубли
  const before = groups(materials, false), after = groups(materials, true);
  const withClass = after.map((g) => ({ ...g, cls: classify(g) }));
  const names = new Map();
  for (const m of materials) { const k = foldName(m.name); (names.get(k) || names.set(k, []).get(k)).push(m); }
  const nameGroups = [...names.entries()].filter(([, l]) => l.length > 1).map(([key, list]) => ({ key, list }));
  const extra = (gs) => gs.reduce((n, g) => n + g.list.length - 1, 0);
  return { before, after: withClass, nameGroups, stat: {
    total: materials.length,
    beforeGroups: before.length, beforeExtra: extra(before), afterGroups: after.length, afterExtra: extra(after),
    format: withClass.filter((g) => g.cls === 'format').length, numbers: withClass.filter((g) => g.cls === 'numbers').length, dupe: withClass.filter((g) => g.cls === 'dupe').length,
    dupeExtra: extra(withClass.filter((g) => g.cls === 'dupe')), nameGroups: nameGroups.length, nameExtra: extra(nameGroups),
    noKey: materials.filter((m) => !matchKey(inputOf(m, true))).length,
  } };
}

const row = (m) => `${m.name} · ${m.article || '—'} · остаток ${m.stockQty ?? 0} ${m.unit || ''}`;

function render(rep, source) {
  const s = rep.stat;
  const L = ['# C057-Э0 · шаг 4 · дубли номенклатуры по ключу сравнения (только отчёт)', '', `Источник: ${source} · дата: ${C.today()} · позиций: ${s.total}`, '',
    '## Итог', '', C.table(['Показатель', 'Групп', 'Лишних позиций'], [
      ['Одинаковый ключ — до разбора названий (как сейчас)', s.beforeGroups, s.beforeExtra],
      ['Одинаковый ключ — после шагов 1–2', s.afterGroups, s.afterExtra],
      ['из них форматы сортамента (листы, трубы) — не дубли', s.format, '—'],
      ['из них разные числа в названии (цвет, размер, упаковка) — не дубли', s.numbers, '—'],
      ['из них **вероятные дубли**', s.dupe, s.dupeExtra],
      ['Одинаковое название после приведения (регистр, ё/е, пробелы, латиница/кириллица)', s.nameGroups, s.nameExtra],
    ]), '', `Позиций, для которых ключ не собрать (нет типа): ${s.noKey}. Они по характеристикам не сопоставляются — только по коду PDM.`, ''];
  const show = (title, cls, note) => {
    const gs = rep.after.filter((g) => g.cls === cls);
    L.push(`## ${title} (${gs.length})`, '', note, '');
    if (!gs.length) { L.push('Нет.', ''); return; }
    for (const g of gs) L.push(`- \`${g.key}\``, ...g.list.map((m) => `  - ${row(m)}`));
    L.push('');
  };
  show('Вероятные дубли — решает человек', 'dupe', 'Ключ и числа в названиях совпали. Что оставить — выбирает человек; ссылки (движения склада, резервы, заявки) переносит отдельный шаг, удаление — только мягкое.');
  show('Одинаковый ключ, но числа в названии разные — не дубли', 'numbers', 'Ключ не различает цвет RAL, количество в упаковке и подобное. Для сопоставления с PDM по характеристикам такие группы дают «кандидатов несколько» — человек выберет при загрузке.');
  L.push(`## Форматы сортамента (${s.format} групп)`, '', 'Листы и трубы одного сортамента в разных форматах (длина 6/12 м, мытая/не мытая, 1250×2500 / 1500×3000). Не дубли: из них шаг 5 делает сортаменты.', '');
  const fm = rep.after.filter((g) => g.cls === 'format');
  L.push(C.table(['Ключ', 'Позиций', 'Примеры'], fm.slice(0, 15).map((g) => [g.key, g.list.length, g.list.slice(0, 3).map((m) => m.name).join(' / ')])), fm.length > 15 ? `\n… и ещё ${fm.length - 15} групп (полный список — в json).` : '', '');
  L.push(`## Одинаковые названия (${s.nameGroups})`, '', rep.nameGroups.length ? rep.nameGroups.flatMap((g) => [`- «${g.key}»`, ...g.list.map((m) => `  - ${row(m)}`)]).join('\n') : 'Нет.', '');
  return L.join('\n');
}

async function main() {
  const a = C.args();
  const d = await C.load(a);
  try {
    const rep = buildReport(d.materials);
    const slim = (gs) => gs.map((g) => ({ key: g.key, cls: g.cls, items: g.list.map((m) => ({ id: m.id, name: m.name, article: m.article, stockQty: m.stockQty })) }));
    const f = C.writePlan(a, 'dupes-report', { step: 'c057-dupes-report', source: d.source, createdAt: new Date().toISOString(), stat: rep.stat, before: slim(rep.before), after: slim(rep.after), nameGroups: slim(rep.nameGroups) }, render(rep, d.source));
    const s = rep.stat;
    console.log(`Дубли: ключ до — ${s.beforeGroups} групп (${s.beforeExtra} лишних), после шагов 1–2 — ${s.afterGroups} (${s.afterExtra}); из них форматы ${s.format}, разные числа ${s.numbers}, вероятные дубли ${s.dupe} (${s.dupeExtra}); одинаковые названия ${s.nameGroups}; без ключа ${s.noKey}\nОтчёт: ${f.md}`);
  } finally { if (d.client) await d.client.close(); }
}

module.exports = { buildReport, render, classify, inputOf };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
