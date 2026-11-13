#!/usr/bin/env node
/**
 * C112 А2: изделия, у которых `products.passportDefaults.textChoices.<rootId>` указывает на удалённый вариант текста паспорта
 * (`dict_values`, dict `passportPhrases`, deletedAt != null). План «было → станет»: действующий лист того же корня с тем же
 * названием и разделом, подходящий категории изделия (`fitsCat`, как в passport-gaps.ts). Неоднозначные и без аналога — список
 * «выбрать вручную». Пишет только вложенное поле `passportDefaults.textChoices.<rootId>` и только если там всё ещё старый id
 * (повтор ничего не меняет). Отчёт — tools/logs/c112-a2-<время>.txt и .json. Решение владельца нужно до --apply.
 *
 *   MONGO_URI=… MONGO_DB=… node backend/scripts/c112-a2-gone-choices.js [--apply]
 *   На проде (по слову владельца): bash remote-access/run-script.sh c112-a2-gone-choices [--apply]  (--apply сам делает бэкап)
 *   Прямой Mongo (не API): 503 READ_ONLY здесь не бывает, общего помощника повтора в scripts/ нет.
 */
const fs = require('fs');
const path = require('path');

const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v) => s(v).toLowerCase().replace(/ё/g, 'е');
const catsOf = (d) => s(d.categories).split(/[,;\s]+/).filter(Boolean);
/** Как в passport-gaps.ts: «для всех» или категория в списке. Код категории неизвестен — не фильтруем. */
const fitsCat = (d, code) => !code || d.allCategories === true || d.allCategories === 'true' || catsOf(d).includes(code);

/**
 * Чистая функция. nodes — все узлы passportPhrases (живые и удалённые), products — изделия,
 * codeOf(product) → код категории паспорта или '' (неизвестен).
 * Возвращает { plan: [{id,sku,name,root,from,fromName,to,toName}], manual: [{id,sku,name,root,from,fromName,why,options}] }.
 */
function buildPlan(nodes, products, codeOf = (p) => s(p.passportDefaults && p.passportDefaults.passportCategory)) {
  const byId = new Map(nodes.map((n) => [String(n._id), n]));
  const alive = nodes.filter((n) => !n.deletedAt);
  const hasKids = new Set(alive.filter((n) => n.parentId).map((n) => String(n.parentId)));
  const rootOf = (n) => { let cur = n, i = 0; while (cur && cur.parentId && i++ < 8) cur = byId.get(String(cur.parentId)); return cur ? String(cur._id) : ''; };
  const leavesByRoot = new Map();
  for (const n of alive) {
    if (!n.parentId || hasKids.has(String(n._id))) continue;
    const r = rootOf(n);
    if (!leavesByRoot.has(r)) leavesByRoot.set(r, []);
    leavesByRoot.get(r).push(n);
  }
  const plan = [], manual = [];
  for (const p of products) {
    const tc = (p.passportDefaults && p.passportDefaults.textChoices) || {};
    for (const [root, from] of Object.entries(tc)) {
      if (!from) continue;
      const old = byId.get(String(from));
      if (old && !old.deletedAt) continue; // вариант жив
      const head = { id: String(p._id), sku: s(p.sku), name: s(p.name), root, from: String(from), fromName: old ? s(old.name) : '' };
      if (!old) { manual.push({ ...head, why: 'вариант стёрт совсем, названия нет', options: [] }); continue; }
      const code = codeOf(p);
      const cand = (leavesByRoot.get(root) || []).filter((l) => norm(l.name) === norm(old.name) && s(l.section) === s(old.section) && fitsCat(l, code));
      if (cand.length === 1) plan.push({ ...head, to: String(cand[0]._id), toName: s(cand[0].name) });
      else manual.push({ ...head, why: cand.length ? 'несколько подходящих' : 'нет действующего аналога' + (code ? ' для категории ' + code : ''), options: cand.map((l) => ({ id: String(l._id), name: s(l.name) })) });
    }
  }
  return { plan, manual };
}

module.exports = { buildPlan, fitsCat };

if (!module.parent && !process.env.JEST_WORKER_ID) (async () => {
  const apply = process.argv.includes('--apply');
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    const nodes = await db.collection('dict_values').find({ dict: 'passportPhrases' }, { projection: { name: 1, section: 1, parentId: 1, categories: 1, allCategories: 1, deletedAt: 1 } }).toArray();
    const products = await db.collection('products').find({ deletedAt: null, passportDefaults: { $exists: true } }, { projection: { sku: 1, name: 1, passportDefaults: 1, categoryId: 1 } }).toArray();
    // категория: своя → вида (kindId изделия или passportKindId группы); дальше по группам не идём — неизвестная не фильтрует
    const kinds = new Map((await db.collection('dict_values').find({ dict: 'passportKinds', deletedAt: null }, { projection: { passportCategory: 1 } }).toArray()).map((k) => [String(k._id), s(k.passportCategory)]));
    const cats = new Map((await db.collection('categories').find({ deletedAt: null }, { projection: { passportKindId: 1 } }).toArray()).map((c) => [String(c._id), c.passportKindId ? String(c.passportKindId) : '']));
    const codeOf = (p) => {
      const pd = p.passportDefaults || {};
      return s(pd.passportCategory) || kinds.get(String(pd.kindId || '')) || kinds.get(cats.get(String(p.categoryId || '')) || '') || '';
    };
    const { plan, manual } = buildPlan(nodes, products, codeOf);
    const lines = ['База ' + db.databaseName + ' — ' + (apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'),
      'заменить на действующий: ' + plan.length + '; выбрать вручную: ' + manual.length, '',
      ...plan.map((r) => `  ${r.sku} | ${r.name.slice(0, 50)} | «${r.fromName}» → «${r.toName}»`), '', 'ВЫБРАТЬ ВРУЧНУЮ:',
      ...manual.map((r) => `  ${r.sku} | ${r.name.slice(0, 50)} | «${r.fromName || r.from}» — ${r.why}${r.options.length ? ': ' + r.options.map((o) => o.name).join(' / ') : ''}`)];
    const dir = path.join(__dirname, '..', '..', 'tools', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    fs.writeFileSync(path.join(dir, `c112-a2-${stamp}.txt`), lines.join('\n'));
    fs.writeFileSync(path.join(dir, `c112-a2-${stamp}.json`), JSON.stringify({ apply, plan, manual }, null, 1));
    console.log(lines.slice(0, 30).join('\n') + (lines.length > 30 ? `\n… полный список: tools/logs/c112-a2-${stamp}.txt` : ''));
    if (!apply) { console.log('ПЛАН. Запись — только с --apply.'); return; }
    let n = 0;
    for (const r of plan) {
      const key = 'passportDefaults.textChoices.' + r.root;
      n += (await db.collection('products').updateOne({ _id: new ObjectId(r.id), [key]: r.from }, { $set: { [key]: r.to, updatedAt: new Date() } })).modifiedCount;
    }
    console.log('ОТКАТ: вернуть «было» из tools/logs/c112-a2-' + stamp + '.json (plan[].from) по полям passportDefaults.textChoices.<root>');
    console.log('изменено изделий: ' + n + ' из ' + plan.length);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
