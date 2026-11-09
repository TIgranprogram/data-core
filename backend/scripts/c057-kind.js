/* C057-Э0 шаг 1: вид позиции (materialKind) по категории. ТЗ: docs/crew/C057-pdm-import/TZ-E0-DATA.md, DECISIONS п. 16.
 *
 *   План по выгрузке:  node scripts/c057-kind.js --from <папка выгрузки>
 *   План по базе:      MONGO_URI=… MONGO_DB=… node scripts/c057-kind.js
 *   Записать:          MONGO_URI=… MONGO_DB=… node scripts/c057-kind.js --apply [--out откат.json]
 *
 * Правила: «Метизы» → fastener, «Покупные изделия» → purchased, «Оборудование» и «Услуги» → other, остальное сырьё
 * (листы, трубы, стекло, дерево, расходники…) → raw; без категории — по названию (болт/гайка/шайба… → fastener), иначе не трогаем.
 * Позиция, у которой уже стоит вид: тот же — пропуск; raw в «Оборудовании» (ИБП) → other; любой другой — в отчёт «конфликт», не меняем.
 * СНАЧАЛА проверка: позиция станет raw и стоит прямо в составе изделия (products.composition, lineType 'material') — изделие не сохранится
 * (composition-line.service.ts: «Raw materials may only be added to modules») → в отчёт, не размечаем.
 * --apply идемпотентен: пишет только позициям, у которых вид ещё прежний; удалений нет. */
'use strict';
const C = require('./lib/c057-common');
const { groupOf } = require('./lib/c057-parse');

const BY_CATEGORY = { 'Метизы': 'fastener', 'Покупные изделия': 'purchased', 'Оборудование': 'other', 'Услуги': 'other' };

function targetKind(m) {
  if (m.catName) return { to: BY_CATEGORY[m.catName] || 'raw', why: BY_CATEGORY[m.catName] ? `категория «${m.catName}»` : `сырьё: категория «${m.catName}»` };
  if (groupOf('', m.name) === 'fastener') return { to: 'fastener', why: 'без категории; по названию — метиз' };
  return { to: null, why: 'без категории, по названию не определить' };
}

function buildPlan(materials, products) {
  // позиции в составе изделий (прямо)
  const inProduct = new Map();
  for (const p of products) for (const l of p.composition || []) if (l.lineType === 'material') {
    const k = String(l.refId); (inProduct.get(k) || inProduct.set(k, []).get(k)).push(`${p.name}${p.sku ? ` (${p.sku})` : ''}`);
  }
  const items = [], blocked = [], same = [], conflicts = [], undecided = [];
  for (const m of materials) {
    const t = targetKind(m);
    if (!t.to) { undecided.push({ id: m.id, name: m.name, why: t.why }); continue; }
    const from = m.materialKind || null;
    let to = t.to, why = t.why;
    if (from === to) { same.push(m.id); continue; }
    if (from === 'raw' && m.catName === 'Оборудование') { to = 'other'; why = 'сырьё в «Оборудовании» (не материал для изделий)'; }
    else if (from) { conflicts.push({ id: m.id, name: m.name, category: m.catName, from, wanted: t.to }); continue; }
    if (to === 'raw' && inProduct.has(m.id)) { blocked.push({ id: m.id, name: m.name, category: m.catName, products: inProduct.get(m.id) }); continue; }
    items.push({ id: m.id, name: m.name, category: m.catName || '—', from, to, why });
  }
  return { items, blocked, conflicts, undecided, alreadyOk: same.length };
}

function render(plan, source, total) {
  const cnt = {};
  for (const i of plan.items) cnt[`${i.category}→${i.to}`] = (cnt[`${i.category}→${i.to}`] || 0) + 1;
  const rows = Object.entries(cnt).sort().map(([k, n]) => [k.split('→')[0], k.split('→')[1], n]);
  const L = [`# C057-Э0 · шаг 1 · вид позиции по категории`, '', `Источник: ${source} · дата: ${C.today()} · позиций: ${total}`, '',
    `**Итог:** поставить вид — ${plan.items.length}; уже стоит — ${plan.alreadyOk}; заблокировано составом изделий — ${plan.blocked.length}; конфликтов — ${plan.conflicts.length}; не определить — ${plan.undecided.length}.`, '',
    '## Что будет записано', '', C.table(['Категория', 'Вид', 'Позиций'], rows), '',
    '## Проверка «сырьё в составе изделия» (делается первой)', '',
    plan.blocked.length ? C.table(['Позиция', 'Категория', 'Изделия'], plan.blocked.map((b) => [b.name, b.category, b.products.join('; ')])) : 'Нет ни одной: ни одна позиция, которая станет сырьём (raw), не стоит прямо в составе изделия. Блокировок нет.', '',
    '## Спорное — решает пользователь', '',
    `- «Расходники» (бита, диски, краска, фрезы…) — по правилу «прочее сырьё» получают raw (${plan.items.filter((i) => i.category === 'Расходники').length} шт). Это не материал изделий; если нужен вид «прочее» (other) — скажите, поменяем одно правило в скрипте.`,
    '- ИБП APC (сейчас raw, категория «Оборудование») → other — по ТЗ.', ''];
  const odd = plan.items.filter((i) => i.category === '—' || i.from);
  if (odd.length) L.push('## Особые', '', C.table(['Позиция', 'Категория', 'Было', 'Станет', 'Почему'], odd.map((i) => [i.name, i.category, i.from || '—', i.to, i.why])), '');
  if (plan.conflicts.length) L.push('## Конфликты (вид уже стоит и отличается — не трогаем)', '', C.table(['Позиция', 'Категория', 'Сейчас', 'По правилу'], plan.conflicts.map((c) => [c.name, c.category, c.from, c.wanted])), '');
  if (plan.undecided.length) L.push('## Не определить', '', C.table(['Позиция', 'Почему'], plan.undecided.map((u) => [u.name, u.why])), '');
  return L.join('\n');
}

async function applyPlan(db, plan, { ObjectId }) {
  const before = [];
  let changed = 0;
  for (const i of plan.items) {
    const r = await db.collection('materials').updateOne({ _id: new ObjectId(i.id), materialKind: i.from ?? null }, { $set: { materialKind: i.to } });
    if (r.modifiedCount) { changed++; before.push({ _id: i.id, materialKind: i.from }); }
  }
  return { changed, before };
}

async function main() {
  const a = C.args();
  const d = await C.load(a, { products: true });
  try {
    if (!d.products.length) console.log('ВНИМАНИЕ: изделий для проверки состава нет (нет products.json?) — проверка блокировок не выполнена.');
    const plan = buildPlan(d.materials, d.products);
    const f = C.writePlan(a, 'kind-plan', { step: 'c057-kind', source: d.source, createdAt: new Date().toISOString(), ...plan }, render(plan, d.source, d.materials.length));
    console.log(`Вид: записать ${plan.items.length}, уже ок ${plan.alreadyOk}, заблокировано ${plan.blocked.length}, конфликтов ${plan.conflicts.length}, не определить ${plan.undecided.length}\nПлан: ${f.md}`);
    if (a.apply) {
      const { ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), __dirname] })).mongo;
      const r = await applyPlan(d.db, plan, { ObjectId });
      console.log(`ЗАПИСАНО в ${d.db.databaseName}: ${r.changed}. Откат: ${C.writeRollback(a, 'c057-kind', r.before)}`);
    } else console.log('Только план, ничего не записано. Записать: --apply (MONGO_URI + MONGO_DB).');
  } finally { if (d.client) await d.client.close(); }
}

module.exports = { targetKind, buildPlan, render, applyPlan };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
