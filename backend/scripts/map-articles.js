/* C027 — заявки → подстатьи расходов (supplyrequests.articleId). Скрипт самодостаточный: правила — ниже в файле,
 * подстатьи — из коллекции expensearticles (сид бэкенда). Запуск на проде — кнопками пульта (remote-access/run-script.sh, через stdin):
 *   «План скрипта» map-articles         — только план на экран, ничего не пишет
 *   «Записать скрипт» map-articles      — копия базы (run-script) → запись только «высокой» уверенности
 * Локально: MONGO_URI=… [MONGO_DB=…] node scripts/map-articles.js [--apply] [--min=средняя|высокая] [--out файл.json]
 * --apply: выгрузка {_id, articleId} для отката (--out, иначе /tmp); пишет только заявкам без articleId
 *   (filter {_id:{$in}, articleId:{$exists:false}}); categoryIds подстатей — только добавление. Ничего не удаляется и не перезаписывается.
 * Порядок правил: ручные (manual) → карта категорий → без статьи. */
const path = require('path');
const fs = require('fs');
const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
/** Правила сопоставления (цель — путь «Статья / Подстатья» из справочника «Статьи расходов»). */
const RULES = {
 "_comment": "Правила C027: порядок — manual (по порядку) → categories → без статьи. Цель «Статья / Подстатья» — как в docs/crew/C027-money-by-articles/articles-seed.json. words — подстроки в нижнем регистре (ё=е); проверяются по полю: title — название заявки, category — название категории, supplier — название поставщика.",
 "manual": [
  {
   "title": [
    "перчатк"
   ],
   "to": "Рабочая одежда / Перчатки трикотажные"
  },
  {
   "title": [
    "краги"
   ],
   "to": "Рабочая одежда / Краги спилковые"
  },
  {
   "title": [
    "маска сварщ"
   ],
   "to": "Рабочая одежда / Маска сварщика"
  },
  {
   "title": [
    "нарукавник"
   ],
   "to": "Рабочая одежда / Нарукавники брезентовые"
  },
  {
   "title": [
    "фартук"
   ],
   "to": "Рабочая одежда / Фартук брезентовый"
  },
  {
   "title": [
    "спецодежд",
    "спецобув",
    "пескоструйщик",
    "ботинки",
    "костюм рабочий"
   ],
   "to": "Рабочая одежда / Спецодежда и обувь"
  },
  {
   "title": [
    "подшипник"
   ],
   "to": "Расходные материалы / Подшипники"
  },
  {
   "title": [
    "болт",
    "гайк",
    "шайб",
    "винт ",
    "саморез",
    "метиз",
    "шпильк",
    "скоба",
    "шакле",
    "цепь",
    "заклеп",
    "заклёп"
   ],
   "to": "Расходные материалы / Болты, гайки, шайбы и др. метизы"
  },
  {
   "title": [
    "диск отрез",
    "круг отрез",
    "круг зачист",
    "круг шлиф",
    "лепестков",
    "фреза",
    "щетка",
    "щётка"
   ],
   "to": "Расходные материалы / Круги, диски, фрезы, щётки"
  },
  {
   "title": [
    "заглушк",
    "зацеп"
   ],
   "to": "Расходные материалы / Пластиковые заглушки, зацепы и др."
  },
  {
   "title": [
    "нерж"
   ],
   "to": "Расходные материалы / Металл - нержавейка"
  },
  {
   "title": [
    "алюмин"
   ],
   "to": "Расходные материалы / Металл - алюминий"
  },
  {
   "title": [
    "труба профильная",
    "труба проф",
    "профильная труба",
    "арматур",
    "швеллер",
    "уголок",
    "полоса стальн",
    "лист стальн",
    "круг стальн"
   ],
   "to": "Расходные материалы / Металл - сталь"
  },
  {
   "title": [
    "фанер",
    "доска",
    "брус",
    "осб"
   ],
   "to": "Расходные материалы / Лесоматериалы и фанера",
   "confidence": "средняя"
  },
  {
   "title": [
    "порошков"
   ],
   "to": "Расходные материалы / Порошковое покрытие"
  },
  {
   "title": [
    "эмаль",
    "краска",
    "грунтовк"
   ],
   "to": "Расходные материалы / Эмаль Краски Грунтовки",
   "confidence": "средняя"
  },
  {
   "title": [
    "проволока омедн",
    "проволока сварочн"
   ],
   "to": "Расходные материалы / Проволока омедненная"
  },
  {
   "title": [
    "углекислот",
    "баллон"
   ],
   "to": "Расходные материалы / Углекислота и аренда балонов"
  },
  {
   "title": [
    "электрод",
    "сопло для резак"
   ],
   "to": "Расходные материалы / Сопло для резака+электроды+фильтры"
  },
  {
   "title": [
    "сотовый поликарбонат"
   ],
   "to": "Расходные материалы / Сотовый поликарбонат"
  },
  {
   "title": [
    "монолитный поликарбонат"
   ],
   "to": "Расходные материалы / Монолитный поликарбонат"
  },
  {
   "title": [
    "профнастил",
    "профлист"
   ],
   "to": "Расходные материалы / Лист профилированный (профнастил)"
  },
  {
   "title": [
    "композит",
    "акп"
   ],
   "to": "Расходные материалы / Композит (АКП)",
   "confidence": "средняя"
  },
  {
   "title": [
    "оракал"
   ],
   "to": "Расходные материалы / Оракал для инвентаря"
  },
  {
   "title": [
    "кабель",
    "розетк",
    "автомат выключ",
    "провод "
   ],
   "to": "Расходные материалы / Электрика и комплектующие",
   "confidence": "средняя"
  },
  {
   "title": [
    "сетка заградит",
    "сетка спортив",
    "сетка волейб",
    "сетка футбол"
   ],
   "to": "Расходные материалы / Сетки заградительные и спортивные"
  },
  {
   "title": [
    "ветошь"
   ],
   "to": "Расходные материалы / Ветошь и др. ткани для чистки"
  },
  {
   "title": [
    "канат"
   ],
   "to": "Расходные материалы / Канат х/б для воркаут"
  },
  {
   "title": [
    "рулетка"
   ],
   "to": "Инструменты / Рулетка измерительная"
  },
  {
   "title": [
    "плоскогубц",
    "бокорез"
   ],
   "to": "Инструменты / Плоскогубцы, бокорезы и др."
  },
  {
   "title": [
    "ключ гаечный",
    "отвертк",
    "отвёртк",
    "нож "
   ],
   "to": "Инструменты / Гаечные ключи, отвёртки, ножи"
  },
  {
   "title": [
    "молоток",
    "гвоздодер",
    "лопата"
   ],
   "to": "Инструменты / Молоток, гвоздодёр, лопата и др."
  },
  {
   "title": [
    "шуруповерт",
    "дрель",
    "лобзик",
    "электроинструмент"
   ],
   "to": "Инструменты / Электроинструменты",
   "confidence": "средняя"
  },
  {
   "title": [
    "болгарк",
    "ушм"
   ],
   "to": "Оборудование / Болгарки и комплектующие"
  },
  {
   "title": [
    "сварочный аппарат",
    "сварочный полуавтомат"
   ],
   "to": "Оборудование / Сварочный аппарат"
  },
  {
   "title": [
    "компрессор"
   ],
   "to": "Оборудование / Винтовой компрессор VSD 500L IronMac",
   "confidence": "средняя"
  },
  {
   "title": [
    "трава искусств"
   ],
   "to": "Материалы для площадки / Трава искусственная"
  },
  {
   "title": [
    "шовная лента"
   ],
   "to": "Материалы для площадки / Шовная лента и др."
  },
  {
   "title": [
    "клей полиуретан"
   ],
   "to": "Материалы для площадки / Клей полиуретановый"
  },
  {
   "title": [
    "крошка резин",
    "крошка epdm"
   ],
   "to": "Материалы для площадки / Крошка резиновая 2-4 мм",
   "confidence": "средняя"
  },
  {
   "title": [
    "бетон"
   ],
   "to": "Материалы для площадки / Бетон М"
  },
  {
   "title": [
    "асфальт"
   ],
   "to": "Материалы для площадки / Асфальтобетон мелкозернистый",
   "confidence": "средняя"
  },
  {
   "title": [
    "бордюр",
    "бортов"
   ],
   "to": "Материалы для площадки / Камень бортовой (бордюры)"
  },
  {
   "title": [
    "щебень"
   ],
   "to": "Материалы для площадки / Щебень фракции 5-20 мм",
   "confidence": "средняя"
  },
  {
   "title": [
    "гпс",
    "гравийно"
   ],
   "to": "Материалы для площадки / Гравийно-песчаная смесь (ГПС)"
  },
  {
   "title": [
    "песок"
   ],
   "to": "Материалы для площадки / Песок кварцевый"
  },
  {
   "title": [
    "цемент"
   ],
   "to": "Материалы для площадки / Цемент М 200-400"
  },
  {
   "title": [
    "геотекстил"
   ],
   "to": "Материалы для площадки / Геотекстиль нетканый"
  },
  {
   "title": [
    "краска разметоч"
   ],
   "to": "Материалы для площадки / Краска разметочная"
  },
  {
   "title": [
    "доставка тк",
    "транспортная компани"
   ],
   "to": "Транспортировка товаров / Доставка через ТК"
  },
  {
   "title": [
    "доставка",
    "перевозк",
    "грузоперевоз"
   ],
   "to": "Транспортировка товаров / Доставка наёмным а/м",
   "confidence": "средняя"
  },
  {
   "title": [
    "автокран"
   ],
   "to": "Аренда спецтехники / Аренда автокрана",
   "confidence": "средняя"
  },
  {
   "title": [
    "манипулятор"
   ],
   "to": "Аренда спецтехники / Аренда манипулятора",
   "confidence": "средняя"
  },
  {
   "title": [
    "экскаватор",
    "погрузчик"
   ],
   "to": "Аренда спецтехники / Аренда экскаватора и погрузчика",
   "confidence": "средняя"
  },
  {
   "title": [
    "аренда спецтехник"
   ],
   "to": "Аренда спецтехники / Аренда прочей техники",
   "confidence": "средняя"
  },
  {
   "title": [
    "сиденье"
   ],
   "to": "Расходные материалы / Сиденья пластиковые для трибун",
   "confidence": "средняя"
  }
 ],
 "categories": {
  "Профильная труба": "Расходные материалы / Металл - сталь",
  "Металлы": "Расходные материалы / Металл - сталь",
  "Метизы": "Расходные материалы / Болты, гайки, шайбы и др. метизы",
  "Дерево": "Расходные материалы / Лесоматериалы и фанера"
 },
 "categoriesConfidence": "средняя"
};
const RANK = { 'нет': 0, 'средняя': 1, 'высокая': 2 };

/** Чистая функция: заявка → { to, rule, conf }. ctx: { categoryName, supplierName } */
function classify(req, ctx) {
  const f = { title: norm(req.title), category: norm(ctx.categoryName), supplier: norm(ctx.supplierName) };
  for (const r of RULES.manual) {
    for (const field of ['title', 'category', 'supplier']) {
      const w = (r[field] || []).find((x) => f[field].includes(norm(x)));
      if (w) return { to: r.to, rule: `${field}: «${w}»`, conf: r.confidence || 'высокая' };
    }
  }
  const cm = Object.entries(RULES.categories || {}).find(([k]) => norm(k) === f.category && f.category);
  if (cm) return { to: cm[1], rule: `категория «${cm[0]}»`, conf: RULES.categoriesConfidence || 'средняя' };
  return { to: null, rule: '', conf: 'нет' };
}

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : undefined; };
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const stamp = () => new Date().toISOString().slice(0, 10);

async function buildPlan(db) {
  const [cats, orgs, reqs] = await Promise.all([
    db.collection('categories').find({}, { projection: { name: 1 } }).toArray(),
    db.collection('organizations').find({}, { projection: { name: 1 } }).toArray(),
    db.collection('supplyrequests').find({ deletedAt: null, articleId: { $exists: false } },
      { projection: { title: 1, categoryId: 1, supplierId: 1, lineTotal: 1, priceHint: 1, qty: 1, requestNo: 1, number: 1, num: 1, status: 1 } }).toArray(),
  ]);
  const catName = new Map(cats.map((c) => [String(c._id), c.name]));
  const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));
  const rows = reqs.map((r) => {
    const categoryName = r.categoryId ? catName.get(String(r.categoryId)) || '' : '';
    const supplierName = r.supplierId ? orgName.get(String(r.supplierId)) || '' : '';
    const amount = r.priceHint != null ? Number(r.priceHint) : (r.lineTotal ?? null); // priceHint — сумма за всю позицию (как в «Деньгах»)
    const m = classify(r, { categoryName, supplierName });
    return { id: String(r._id), no: r.requestNo ?? r.number ?? r.num ?? '', title: r.title || '', categoryName, supplierName, amount, ...m };
  });
  // предложение categoryIds: категория → подстатья (только из правил категорий и совпадений в данных)
  const catSug = new Map(); // path → Set(categoryName)
  for (const [cn, to] of Object.entries(RULES.categories || {})) {
    if (cats.some((c) => norm(c.name) === norm(cn))) (catSug.get(to) || catSug.set(to, new Set()).get(to)).add(cn);
  }
  const subs = await db.collection('expensearticles').find({ deletedAt: null, parentId: { $ne: null } }, { projection: { name: 1, parentId: 1 } }).toArray();
  const parents = new Map((await db.collection('expensearticles').find({ deletedAt: null, parentId: null }, { projection: { name: 1 } }).toArray()).map((a) => [String(a._id), a.name]));
  const known = new Set(subs.map((x) => `${parents.get(String(x.parentId))} / ${x.name}`));
  const badTargets = [...new Set([...RULES.manual.map((r) => r.to), ...Object.values(RULES.categories || {})])].filter((t) => !known.has(t));
  return { rows, catSug, badTargets, total: reqs.length };
}

function renderPlan(p) {
  const by = (c) => p.rows.filter((r) => r.conf === c).length;
  const sum = (arr) => arr.reduce((s, r) => s + (r.amount || 0), 0);
  const unm = p.rows.filter((r) => !r.to);
  const top = new Map();
  for (const r of unm) { const k = r.categoryName ? `категория «${r.categoryName}»` : `название «${r.title}»`; const o = top.get(k) || { n: 0, s: 0 }; o.n++; o.s += r.amount || 0; top.set(k, o); }
  const topList = [...top.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  const md = [`# Сопоставление заявок со статьями — план (${stamp()})`, '',
    `Заявок без статьи: ${p.total}. Высокая уверенность: ${by('высокая')}, средняя: ${by('средняя')}, не сопоставлено: ${by('нет')}.`,
    `Сумма сопоставленных: ${Math.round(sum(p.rows.filter((r) => r.to)))} ₽; несопоставленных: ${Math.round(sum(unm))} ₽.`, '',
    p.badTargets.length ? `⚠ Правила ссылаются на подстатьи, которых нет в справочнике «Статьи расходов»: ${p.badTargets.join('; ')}` : 'Все цели правил есть в справочнике «Статьи расходов».', '',
    '## Топ несопоставленных', '', ...(topList.length ? topList.map(([k, o]) => `- ${k} — ${o.n} заявок, ${Math.round(o.s)} ₽`) : ['- нет']), '',
    '## Предложение categoryIds (категория → подстатья)', '', ...(p.catSug.size ? [...p.catSug].map(([t, s]) => `- ${t} ← ${[...s].join(', ')}`) : ['- нет']), '',
    '## Было → станет', '', '| № | Название | Категория | Поставщик | Сумма | → Подстатья | Правило | Уверенность |', '|--|--|--|--|--|--|--|--|',
    ...p.rows.map((r) => `| ${r.no} | ${r.title} | ${r.categoryName} | ${r.supplierName} | ${r.amount ?? ''} | ${r.to || '—'} | ${r.rule} | ${r.conf} |`)];
  const csv = '﻿' + ['№;Название;Категория;Поставщик;Сумма;Подстатья;Правило;Уверенность',
    ...p.rows.map((r) => [r.no, r.title, r.categoryName, r.supplierName, r.amount, r.to, r.rule, r.conf].map(csvCell).join(';'))].join('\n');
  return { md: md.join('\n'), csv };
}

async function applyPlan(db, p, minConf, outFile) {
  const subs = await db.collection('expensearticles').find({ deletedAt: null, parentId: { $ne: null } }).toArray();
  const parents = new Map((await db.collection('expensearticles').find({ deletedAt: null, parentId: null }).toArray()).map((a) => [String(a._id), a.name]));
  if (!subs.length) throw new Error('Коллекция expensearticles пуста — сначала запустите бэкенд с сидом статей.');
  const idByPath = new Map(subs.map((s) => [`${parents.get(String(s.parentId))} / ${s.name}`, s._id]));
  const todo = p.rows.filter((r) => r.to && RANK[r.conf] >= RANK[minConf] && idByPath.has(r.to));
  const bak = outFile || `/tmp/map-articles-backup-${stamp()}-${Date.now()}.json`;
  const ids = todo.map((r) => new ObjectId(r.id));
  const before = await db.collection('supplyrequests').find({ _id: { $in: ids } }, { projection: { articleId: 1 } }).toArray();
  fs.writeFileSync(bak, JSON.stringify(before.map((b) => ({ _id: String(b._id), articleId: b.articleId ?? null }))));
  let written = 0;
  const byTarget = new Map();
  for (const r of todo) (byTarget.get(r.to) || byTarget.set(r.to, []).get(r.to)).push(new ObjectId(r.id));
  for (const [to, list] of byTarget) {
    const res = await db.collection('supplyrequests').updateMany({ _id: { $in: list }, articleId: { $exists: false } }, { $set: { articleId: idByPath.get(to) } });
    written += res.modifiedCount;
  }
  const catByName = new Map((await db.collection('categories').find({}, { projection: { name: 1 } }).toArray()).map((c) => [norm(c.name), c._id]));
  let catAdded = 0;
  for (const [to, names] of p.catSug) {
    const sid = idByPath.get(to); const cids = [...names].map((n) => catByName.get(norm(n))).filter(Boolean);
    if (sid && cids.length) { const res = await db.collection('expensearticles').updateOne({ _id: sid }, { $addToSet: { categoryIds: { $each: cids } } }); catAdded += res.modifiedCount; }
  }
  return { written, planned: todo.length, catAdded, backup: bak };
}

module.exports = { classify, buildPlan, renderPlan, applyPlan };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  try {
    const db = c.db(process.env.MONGO_DB || undefined);
    const p = await buildPlan(db);
    const { md } = renderPlan(p);
    const NL = String.fromCharCode(10);
    const lines = md.split(NL);
    const cut = lines.findIndex((l) => l.startsWith('## Было → станет'));
    console.log(lines.slice(0, cut < 0 ? lines.length : cut).join(NL));
    const show = p.rows.filter((r) => r.to).slice(0, 80);
    if (show.length) console.log('## Что станет (первые ' + show.length + ')' + NL + show.map((r) => `- №${r.no} ${r.title} → ${r.to} (${r.conf})`).join(NL));
    if (process.argv.includes('--apply')) {
      const min = arg('--min') || 'высокая';
      if (!(min in RANK)) throw new Error('--min: высокая | средняя');
      const i = process.argv.indexOf('--out');
      const r = await applyPlan(db, p, min, i > 0 ? process.argv[i + 1] : null);
      console.log(NL + `Записано заявок: ${r.written} из ${r.planned} (уверенность «${min}» и выше); подстатей с новыми категориями: ${r.catAdded}; выгрузка для отката: ${r.backup}`);
    } else {
      const i = process.argv.indexOf('--out');
      if (i > 0) { const { csv } = renderPlan(p); fs.writeFileSync(process.argv[i + 1], csv); console.log('Таблица: ' + process.argv[i + 1]); }
      console.log(NL + 'Только план, ничего не записано. Записать: --apply (только «высокая» уверенность).');
    }
  } finally { await c.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
