/* C057-Э0 шаг 3: отчёт по весу позиций. ТОЛЬКО ОТЧЁТ — ничего не пишет (решает человек; порог не применяется, DECISIONS п. 16).
 *
 *   node scripts/c057-weight-report.js --from <папка выгрузки>      (или MONGO_URI/MONGO_DB — чтение)
 *
 * Как читается вес (stock/weight.ts, НО.0): `weightUnit: 'kg'` — значение в килограммах; без пометки — старые записи, в `weightKg` лежат ГРАММЫ.
 * Подозрительным вес считается, если: (а) у болтов/винтов/шурупов/шпилек вес в граммах выходит за 0,6–2,0 массы стального стержня (π/4·d²·L·7,85);
 * (б) у соседей одного типа и стандарта вес не растёт вместе с длиной (при том же диаметре) или с диаметром (гайки, шайбы);
 * (в) отдельно, не как подозрение: пометка «кг» стоит у одной позиции, а соседи без пометки — единицы в группе смешаны. Решение по каждой — за человеком. */
'use strict';
const C = require('./lib/c057-common');
const { groupOf, parseFastener } = require('./lib/c057-parse');

const rnd = (n) => Math.round(n * 100) / 100;
const fmt = (n) => String(rnd(n)).replace('.', ',');
const LONG = /^(болт|винт|шуруп|шпилька|резьбовая шпилька|саморез|анкерный)/i;

function gramsOf(m) { const v = Number(m.weightKg); if (!(v > 0)) return null; return m.weightUnit === 'kg' ? v * 1000 : v; }

function buildReport(materials) {
  const rows = materials.filter((m) => Number(m.weightKg) > 0).map((m) => {
    const g = groupOf(m.catName, m.name);
    const p = g === 'fastener' ? parseFastener(m.name) : null;
    const d = p?.dims.diameter, L = p?.dims.length;
    const grams = gramsOf(m);
    const marked = m.weightUnit === 'kg';
    const cyl = p && LONG.test(p.typeName) && d && L ? (Math.PI / 4) * d * d * L * 7.85e-3 : null;
    return { id: m.id, name: m.name, category: m.catName || '—', raw: Number(m.weightKg), marked, grams, likelyUnit: marked ? 'кг (есть пометка)' : 'граммы (старая запись без пометки)',
      type: p ? `${p.typeName}|${p.standardRef}` : '', d, L, cyl, ratio: cyl ? grams / cyl : null, flags: [] };
  });
  // (а) стержень
  for (const r of rows) if (r.ratio != null && (r.ratio < 0.6 || r.ratio > 2.0)) r.flags.push(`вес ${fmt(r.grams)} г при стержне ≈ ${fmt(r.cyl)} г (×${fmt(r.ratio)})`);
  // (б) рост с длиной / диаметром
  const byType = new Map();
  for (const r of rows) if (r.type) (byType.get(r.type) || byType.set(r.type, []).get(r.type)).push(r);
  for (const list of byType.values()) {
    const byD = new Map();
    for (const r of list) if (r.d != null) (byD.get(r.d) || byD.set(r.d, []).get(r.d)).push(r);
    for (const sub of byD.values()) {
      const withL = sub.filter((r) => r.L != null).sort((a, b) => a.L - b.L);
      for (let i = 1; i < withL.length; i++) if (withL[i].grams < withL[i - 1].grams) withL[i].flags.push(`легче более короткого (${fmt(withL[i - 1].grams)} г при ${withL[i - 1].L} мм)`);
    }
    if (list.every((r) => r.L == null)) {
      const sorted = [...list].sort((a, b) => a.d - b.d);
      for (let i = 1; i < sorted.length; i++) if (sorted[i].d > sorted[i - 1].d && sorted[i].grams < sorted[i - 1].grams) sorted[i].flags.push(`легче меньшего диаметра (${fmt(sorted[i - 1].grams)} г при M${sorted[i - 1].d})`);
    }
  }
  // (в) смешанные единицы — не подозрение, а то, что надо привести к одной (информация)
  for (const list of byType.values()) {
    const marked = list.filter((r) => r.marked), plain = list.filter((r) => !r.marked);
    if (marked.length && plain.length) for (const r of marked) r.mixed = `пометка «кг» среди ${plain.length} записей без пометки (граммы); значение по соседям правдоподобно`;
  }
  // похожие
  for (const r of rows) {
    const list = byType.get(r.type) || [];
    const near = list.filter((x) => x !== r && x.d === r.d).sort((a, b) => Math.abs((a.L || 0) - (r.L || 0)) - Math.abs((b.L || 0) - (r.L || 0))).slice(0, 2);
    const near2 = near.length ? near : list.filter((x) => x !== r).sort((a, b) => Math.abs(a.d - r.d) - Math.abs(b.d - r.d)).slice(0, 2);
    r.similar = near2.map((x) => `${x.name.replace(/^[^,]+,\s*/, '')} → ${fmt(x.grams)} г`).join('; ');
  }
  const noWeight = materials.filter((m) => !(Number(m.weightKg) > 0));
  const noWeightFastener = noWeight.filter((m) => groupOf(m.catName, m.name) === 'fastener');
  return { rows, noWeightFastener: noWeightFastener.map((m) => m.name), noWeightTotal: noWeight.length };
}

function render(rep, source, total) {
  const sus = rep.rows.filter((r) => r.flags.length), legacy = rep.rows.filter((r) => !r.marked), marked = rep.rows.filter((r) => r.marked);
  const L = ['# C057-Э0 · шаг 3 · вес позиций (только отчёт)', '', `Источник: ${source} · дата: ${C.today()} · позиций: ${total}`, '',
    `**Итог:** вес указан у ${rep.rows.length} позиций; без веса — ${rep.noWeightTotal} (из них метизов ${rep.noWeightFastener.length}). Старые записи без пометки (граммы в поле «кг») — **${legacy.length}**; с пометкой «кг» — **${marked.length}**; подозрительных — **${sus.length}**.`, '',
    'Как читать: в базе поле называется «вес, кг», но у старых записей без пометки там граммы (так писала синхронизация таблицы «Склад»). Приложение уже читает их как граммы. Для загрузки из PDM (там масса в **кг**) нужно, чтобы единица у всех была одна — кг с пометкой. Перевод делает отдельный скрипт `weight-grams-to-kg.js` после вашего «да»; этот отчёт ничего не меняет.', '',
    '## Подозрительные веса (решает человек)', ''];
  L.push(sus.length ? C.table(['Позиция', 'В базе', 'Вероятная единица', 'Вес, г', 'Что не так', 'Похожие'], sus.map((r) => [r.name, r.raw + (r.marked ? ' (кг)' : ''), r.likelyUnit, fmt(r.grams), r.flags.join('; '), r.similar])) : 'Нет: по проверке стержня (0,6–2,0 массы) и росту веса с длиной/диаметром выбросов не найдено.', '');
  const mixed = rep.rows.filter((r) => r.mixed);
  if (mixed.length) L.push('## Смешанные единицы (не подозрение, а то, что надо привести к одной)', '', C.table(['Позиция', 'В базе', 'Вес, г', 'Пояснение'], mixed.map((r) => [r.name, r.raw + ' кг', fmt(r.grams), r.mixed])), '');
  L.push('## Все позиции с весом', '', C.table(['Позиция', 'В базе', 'Вероятная единица', 'Вес, г'], rep.rows.map((r) => [r.name, r.raw, r.likelyUnit, fmt(r.grams)])), '');
  if (rep.noWeightFastener.length) L.push(`## Метизы без веса (${rep.noWeightFastener.length})`, '', rep.noWeightFastener.map((n) => `- ${n}`).join('\n'), '');
  return L.join('\n');
}

async function main() {
  const a = C.args();
  const d = await C.load(a);
  try {
    const rep = buildReport(d.materials);
    const f = C.writePlan(a, 'weight-report', { step: 'c057-weight-report', source: d.source, createdAt: new Date().toISOString(), rows: rep.rows.map(({ cyl, ratio, ...r }) => ({ ...r, cyl: cyl && rnd(cyl), ratio: ratio && rnd(ratio) })) }, render(rep, d.source, d.materials.length));
    const sus = rep.rows.filter((r) => r.flags.length).length;
    console.log(`Вес: указан у ${rep.rows.length}, без пометки (граммы) ${rep.rows.filter((r) => !r.marked).length}, с пометкой кг ${rep.rows.filter((r) => r.marked).length}, подозрительных ${sus}\nОтчёт: ${f.md}`);
  } finally { if (d.client) await d.client.close(); }
}

module.exports = { buildReport, render, gramsOf };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
