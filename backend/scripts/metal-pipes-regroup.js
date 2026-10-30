#!/usr/bin/env node
/**
 * Разбивка труб после импорта (СМ.5): позиция «сечение + мойка» → позиции «сечение + мойка + длина», как столбцы таблицы учёта.
 *   node scripts/metal-pipes-regroup.js <local|prod>                         - план, ничего не пишет
 *   node scripts/metal-pipes-regroup.js <local|prod> --apply --out откат.json - запись
 * Только через deploy/synology/api.sh. Старая позиция переименовывается в первую длину (история и id сохраняются), её остаток
 * уточняется пересчётом; остальные длины — новые позиции с приходом. Остаток не совпал с таблицей (уже были движения) — стоп, запись не начинается.
 * Повторный запуск ничего не делает: старых названий уже нет.
 */
const fs = require('fs');
const path = require('path');
const { parsePipes, api, all, DIR, AS_OF } = require('./import-metal-stock.js');

const [env, ...flags] = process.argv.slice(2);
if (!['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply --out откат.json]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const OUT = flags[flags.indexOf('--out') + 1];
if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const CLIENT_UID = 'metal-regroup-2026-10-30';

/** Что сделать с позициями: группы «старая → новые», расхождения остатков. Чистая функция — для проверки. */
function regroup(rows, items) {
  const byName = new Map(items.map((m) => [m.name, m]));
  const groups = new Map();
  for (const r of rows.filter((x) => x.qty > 0)) groups.set(r.oldName, [...(groups.get(r.oldName) || []), r]);
  const todo = [], bad = [];
  let done = 0;
  for (const [oldName, list] of groups) {
    const old = byName.get(oldName);
    if (!old) { if (list.every((r) => byName.has(r.name))) done++; else bad.push(`${oldName}: нет позиции`); continue; }
    const sum = Math.round(list.reduce((s, r) => s + r.qty, 0) * 1000) / 1000;
    if (old.quantity !== sum) bad.push(`${oldName}: на складе ${old.quantity} м, в таблице ${sum} м`);
    else if (old.reservedQty) bad.push(`${oldName}: есть бронь ${old.reservedQty} м`);
    todo.push({ old, list });
  }
  return { todo, bad, done };
}

async function main() {
  const { rows } = parsePipes(fs.readFileSync(flags[flags.indexOf('--pipes') + 1] && flags.includes('--pipes') ? flags[flags.indexOf('--pipes') + 1] : path.join(DIR, 'Учет трубы - Лист1.csv'), 'utf8'));
  const { todo, bad, done } = regroup(rows, await all('/api/stock/items'));
  console.log(`Труб к разбивке: ${todo.length}, уже разбито: ${done}, позиций станет: ${todo.reduce((s, g) => s + g.list.length, 0)}`);
  for (const g of todo) console.log(`  ${g.old.name} (${g.old.quantity} м)\n${g.list.map((r) => `    → ${r.name} — ${r.qty} м (${r.note})`).join('\n')}`);
  if (bad.length) { console.log('\nСТОП, запись не начата:'); for (const b of bad) console.log('  ' + b); process.exitCode = 1; return; }
  if (!APPLY) { console.log('\nНичего не записано (план). Записать: --apply --out откат.json'); return; }

  const log = { renamed: [], created: [], batches: [] };
  const save = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2));
  const count = [], incoming = [];
  for (const { old, list } of todo) {
    const [first, ...rest] = list;
    const body = (r) => ({ dims: r.dims, washed: r.washed ?? null, notes: `Таблица учёта на ${AS_OF}: ${r.note}` });
    await api('PATCH', `/api/stock/items/${old.id}`, { name: first.name, ...body(first) });
    log.renamed.push({ id: old.id, from: old.name, to: first.name, qtyBefore: old.quantity }); save();
    if (first.qty !== old.quantity) count.push({ materialId: old.id, qty: first.qty, expected: old.quantity, note: first.note });
    for (const r of rest) {
      const item = await api('POST', '/api/stock/items', { name: r.name, fullName: r.fullName, unit: r.unit, categoryName: r.cat, assortment: r.assortment, materialGrade: r.materialGrade, ...body(r) });
      log.created.push(item.id); save();
      incoming.push({ materialId: item.id, qty: r.qty, note: r.note });
    }
  }
  const note = `Разбивка трубы по длине, таблица учёта на ${AS_OF}`;
  if (count.length) { const b = await api('POST', '/api/stock/batch', { type: 'count', lines: count, note, clientUid: `${CLIENT_UID}-count` }); log.batches.push(b.batchId); save(); }
  if (incoming.length) { const b = await api('POST', '/api/stock/batch', { type: 'in', lines: incoming, note, clientUid: `${CLIENT_UID}-in` }); log.batches.push(b.batchId); save(); }
  console.log(`\nГотово: переименовано ${log.renamed.length}, новых ${log.created.length}. Список: ${OUT}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { regroup };
