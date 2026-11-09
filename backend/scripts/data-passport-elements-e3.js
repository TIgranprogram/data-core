#!/usr/bin/env node
/**
 * C055 Э3: заполненность passportElements — inDescription, usageRules, categories (TRN/WRK/BLG/DIO/DSP).
 * По умолчанию план, база не меняется. Образец плана — C054 части.
 *
 *   node scripts/data-passport-elements-e3.js
 *   node scripts/data-passport-elements-e3.js --dump путь\dict-passportElements.json --plan путь\elements-fill-plan.json
 *   MONGO_URI=... MONGO_DB=... node scripts/data-passport-elements-e3.js --apply --out откат.json
 *
 * --apply пишет только поля из плана и только если «было» совпало. Базу datacore скрипт не трогает.
 * На прод и стенд --apply не запускать: это координатор после «да» пользователя.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ORDER = ['TRN', 'WRK', 'BLG', 'DIO', 'DSP'];
const ALLOWED = new Set(ORDER);
const FORBIDDEN_DB = new Set(['datacore']);

const LADDER_RULES = [
  'Подниматься и спускаться лицом к ступеням, держась за поручни',
  'Не стоять вдвоём на одной ступени',
  'Не пользоваться лестницей, если ступени мокрые или обледенели',
].join('\n');

const PLATFORM_RULES = [
  'Не бегать и не толкаться на площадке',
  'Не вставать на ограждение',
  'Спускаться на землю по лестнице, а не прыжком',
].join('\n');

const RAILING_RULES = [
  'Не перелезать через ограждение',
  'Не сидеть и не стоять на перилах',
  'Не раскачивать ограждение',
].join('\n');

/** Правки. Нет полей — запись остаётся, в note только спор. kind=part прячет узел из «Что это за изделие», текст описания не стирает. */
const PATCH = {
  BASKETBALL_STAND: {
    categories: ['WRK', 'DSP'],
    note: 'Тип «Баскетбольная стойка» — WRK. Детский щит ниже взрослого — DSP, как кольцо и щит в плане частей C054. Не TRN.',
  },
  MINI_FOOTBALL_GOAL: {
    categories: ['WRK', 'DSP'],
    note: 'Тип «Ворота» — WRK. Детские ворота — DSP, как крючок сетки в плане частей C054. Не TRN.',
  },
  PLATFORM: {
    categories: ['WRK', 'DIO', 'DSP'],
    usageRules: PLATFORM_RULES,
    note: 'Площадка для стояния есть у комплекса ДИО и у детского спорта (ГОСТ Р 55677). Правил не было — в паспорте раздел пустел. TRN и BLG не ставить.',
  },
  RAILING: {
    categories: ['BLG', 'DIO', 'DSP'],
    usageRules: RAILING_RULES,
    note: 'Перила площадки и беседки. Детский спорт добавляем: на комплексе ГОСТ Р 55677 перила есть. Это не секция забора «Ограждение площадки».',
  },
  LADDER: {
    inDescription: 'лестница с поручнями для подъёма',
    usageRules: LADDER_RULES,
    note: 'В описании было одно слово «лестница». Правила пустые, а лестница выбирается как снаряд (ДИО, детский спорт, полоса).',
  },
  ROOF: {
    kind: 'part',
    inDescription: 'кровля на опорах',
    note: 'Узел навеса и домика, не отдельный снаряд. В списке «Что это» мешает беседке и перголе. Часть «Кровля» в passportParts не трогаем.',
  },
  TABLE_TOP: {
    kind: 'part',
    inDescription: 'столешница уличного стола',
    note: 'Узел стола. Снаряд — «Стол уличный», у него правила уже есть. Одно слово «столешница» в описание не годится.',
  },
  BODY_CONTAINER: {
    kind: 'part',
    inDescription: 'корпус ёмкости для мусора',
    note: 'Узел урны. Снаряд — «Урна». Справочник частей «Корпус» не сливать с этой записью.',
  },
  FLYWHEEL: {
    inDescription: 'маховик подвижного узла',
    note: 'Деталь тренажёра. В описании было одно слово «маховик».',
  },
  SIDE_WALL: {
    kind: 'part',
    note: 'Борт ската — узел горки, не снаряд. Описание «боковые борта ската» оставляем. Горка уже несёт правила катания.',
  },
  SWING_HANGER: {
    kind: 'part',
    note: 'Подвес — узел качелей. Правила сидения уже у элемента «Качели». Часть «Подвес» в passportParts не трогаем.',
  },
  SLIDE_CHUTE: {
    kind: 'part',
    note: 'Скат — узел горки. Отдельный снаряд «Горка» уже описывает скат и правила съезда. Иначе в паспорте два элемента об одном.',
  },
  SUPPORT_POST: {
    kind: 'part',
    note: 'Опора в основании — узел, не снаряд. Беседка и навес уже есть отдельно. Часть «Опора» в passportParts не сливать.',
  },
  SWING: {
    note: '⚠ Спорно. Элемент — DIO (ГОСТ 34614.2, детские качели). Тип изделий «Качели, качалка» в seed-passport-types помечен BLG. BLG не добавлять: в паспорте беседки всплывут качели. Решает пользователь.',
  },
  BALANCE_SEESAW: {
    note: '⚠ Спорно. Балансир — DIO. Тип «Качели, качалка» помечен BLG. Категорию не расширять без «да».',
  },
  ABS_BENCH: {
    note: '⚠ Спорно. Оставить WRK: тип «Скамья воркаут» и правка 2026-11-07 сняли TRN вместе с турником. Признак trn.muscles.core всё ещё ссылается на эту скамью. TRN не возвращать без «да».',
  },
  VOLLEYBALL_POSTS: {
    note: '⚠ Спорно. Только WRK, как тип «Волейбол, теннис». Детский спорт (DSP) в частях C054 для волейбола не размечен. Не добавлять DSP без «да».',
  },
};

function parseCats(v) {
  return String(v ?? '').split(/[,;\s]+/).filter(Boolean);
}

function canon(codes) {
  const set = new Set(codes);
  return ORDER.filter((c) => set.has(c)).join(',');
}

function sameCats(a, b) {
  return canon(parseCats(a)) === canon(parseCats(b));
}

function normText(v) {
  return String(v ?? '').replace(/\r\n/g, '\n').trim();
}

function loadItems(dumpPath) {
  const raw = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
  const items = Array.isArray(raw) ? raw : raw.items;
  if (!Array.isArray(items)) throw new Error('В выгрузке нет items');
  return items.filter((e) => e && e.dict !== undefined ? e.dict === 'passportElements' : true);
}

function buildPlan(items) {
  const seen = new Set();
  const rows = [];
  for (const el of items) {
    const code = String(el.code || '').trim();
    if (seen.has(code)) throw new Error(`Повтор кода ${code}`);
    seen.add(code);
    const spec = PATCH[code] || null;
    const cur = {
      inDescription: normText(el.inDescription),
      usageRules: normText(el.usageRules),
      categories: String(el.categories ?? '').trim(),
      kind: String(el.kind ?? '').trim(),
    };
    const nextCats = spec && spec.categories ? canon(spec.categories) : cur.categories;
    const next = {
      inDescription: spec && spec.inDescription != null ? spec.inDescription : cur.inDescription,
      usageRules: spec && spec.usageRules != null ? spec.usageRules : cur.usageRules,
      kind: spec && spec.kind != null ? spec.kind : cur.kind,
    };
    const set = {};
    const was = {};
    if (next.inDescription !== cur.inDescription) {
      set.inDescription = next.inDescription;
      was.inDescription = cur.inDescription;
    }
    if (next.usageRules !== cur.usageRules) {
      set.usageRules = next.usageRules;
      was.usageRules = cur.usageRules;
    }
    if (spec && spec.categories && !sameCats(cur.categories, nextCats)) {
      set.categories = nextCats;
      was.categories = cur.categories;
    }
    if (next.kind !== cur.kind) {
      set.kind = next.kind;
      was.kind = cur.kind;
    }
    const action = Object.keys(set).length ? 'patch' : 'keep';
    rows.push({
      id: String(el.id || el._id || ''),
      code,
      name: String(el.name || '').trim(),
      kind: next.kind || cur.kind,
      categories: set.categories || canon(parseCats(cur.categories)) || cur.categories,
      action,
      ...(action === 'patch' ? { set, was } : {}),
      note: (spec && spec.note) || 'Описание есть. Правила снаряда есть, либо это деталь или крепёж без своих шагов.',
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const missing = Object.keys(PATCH).filter((c) => !seen.has(c));
  if (missing.length) throw new Error(`В выгрузке нет кодов: ${missing.join(', ')}`);
  return rows;
}

function audit(items) {
  const by = {};
  for (const c of ORDER) by[c] = { n: 0, product: 0, withRules: 0, withDescription: 0, productNoRules: 0 };
  const gaps = { emptyDescription: [], emptyCategories: [], badCodes: [], productNoRules: [], thin: [] };
  for (const el of items) {
    const cats = parseCats(el.categories);
    const desc = normText(el.inDescription);
    const rules = normText(el.usageRules);
    const kind = String(el.kind || '').trim();
    const name = String(el.name || '').trim();
    if (!desc) gaps.emptyDescription.push(name);
    if (!cats.length) gaps.emptyCategories.push(name);
    const bad = cats.filter((c) => !ALLOWED.has(c));
    if (bad.length) gaps.badCodes.push(`${name}: ${bad.join(',')}`);
    const words = desc.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length <= 1) gaps.thin.push(`${name} (${kind})`);
    const product = !kind || kind === 'product';
    if (product && !rules) gaps.productNoRules.push(name);
    for (const c of cats) {
      if (!by[c]) continue;
      by[c].n += 1;
      if (desc) by[c].withDescription += 1;
      if (rules) by[c].withRules += 1;
      if (product) {
        by[c].product += 1;
        if (!rules) by[c].productNoRules += 1;
      }
    }
  }
  return { total: items.length, by, gaps };
}

function printAudit(a, rows) {
  const patch = rows.filter((r) => r.action === 'patch').length;
  console.log(`Элементов: ${a.total}. План: patch ${patch}, keep ${rows.length - patch}.`);
  console.log('Категория | всего | снаряды | описание | правила | снаряд без правил');
  for (const c of ORDER) {
    const x = a.by[c];
    console.log(`${c} | ${x.n} | ${x.product} | ${x.withDescription} | ${x.withRules} | ${x.productNoRules}`);
  }
  console.log(`Пустое описание: ${a.gaps.emptyDescription.length}. Пустые категории: ${a.gaps.emptyCategories.length}. Чужие коды: ${a.gaps.badCodes.length}.`);
  console.log(`Снаряд без правил: ${a.gaps.productNoRules.join(', ') || '—'}`);
  console.log(`Описание из одного слова: ${a.gaps.thin.join(', ') || '—'}`);
  for (const r of rows.filter((x) => x.action === 'patch')) {
    const fields = Object.keys(r.set).join(', ');
    console.log(`  patch ${r.name} [${fields}]`);
  }
}

function valuesMatch(field, current, expected) {
  if (field === 'categories') return sameCats(current, expected) || normText(current) === normText(expected);
  return normText(current) === normText(expected);
}

async function applyPlan(col, rows) {
  const now = new Date();
  let n = 0;
  const skipped = [];
  for (const row of rows.filter((r) => r.action === 'patch')) {
    const d = await col.findOne({ _id: row._id, dict: 'passportElements', deletedAt: null });
    if (!d) { skipped.push(`${row.name}: нет записи`); continue; }
    const stale = Object.entries(row.was).filter(([k, v]) => !valuesMatch(k, d[k], v));
    if (stale.length) { skipped.push(`${row.name}: поле изменилось (${stale.map(([k]) => k).join(', ')})`); continue; }
    await col.updateOne({ _id: row._id }, { $set: { ...row.set, updatedAt: now } });
    n += 1;
  }
  return { n, skipped };
}

function defaultDump() {
  return path.join(__dirname, '../../docs/crew/C054-passport-funnel/data/dict-passportElements.json');
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const dumpFlag = argv.indexOf('--dump');
  const planFlag = argv.indexOf('--plan');
  const outFlag = argv.indexOf('--out');
  const dumpPath = dumpFlag >= 0 ? argv[dumpFlag + 1] : (process.env.MONGO_URI ? '' : defaultDump());
  if (apply && dumpPath) {
    console.error('--apply пишет в Mongo, не в файл выгрузки. Уберите --dump.');
    process.exit(2);
  }
  if (apply && FORBIDDEN_DB.has(String(process.env.MONGO_DB || ''))) {
    console.error('База datacore — общая с CRM. --apply запрещён.');
    process.exit(2);
  }

  let items;
  let client;
  let col;
  try {
    if (dumpPath) {
      items = loadItems(dumpPath);
      console.log(`Выгрузка ${dumpPath}`);
      console.log('ПЛАН, база не открывалась.');
    } else {
      if (!process.env.MONGO_URI) { console.error('Нет выгрузки и нет MONGO_URI'); process.exit(2); }
      const mongoosePath = require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] });
      const { MongoClient } = require(mongoosePath).mongo;
      client = await MongoClient.connect(process.env.MONGO_URI);
      const db = client.db(process.env.MONGO_DB || undefined);
      if (FORBIDDEN_DB.has(db.databaseName)) {
        console.error(`База ${db.databaseName} — общая с CRM. --apply запрещён.`);
        process.exit(2);
      }
      col = db.collection('dict_values');
      items = await col.find({ dict: 'passportElements', deletedAt: null }).toArray();
      console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    }

    const rows = buildPlan(items);
    printAudit(audit(items), rows);
    if (planFlag >= 0) {
      const dest = path.resolve(argv[planFlag + 1]);
      fs.writeFileSync(dest, `${JSON.stringify(rows, null, 2)}\n`);
      console.log(`План записан: ${dest}`);
    }
    if (!apply) {
      console.log('\nНичего не записано в справочник. Запись только координатором: --apply --out откат.json');
      return;
    }
    const idBy = new Map(items.map((e) => [String(e.id || e._id), e._id]));
    for (const row of rows) row._id = idBy.get(row.id);
    if (outFlag >= 0) {
      const dest = path.resolve(argv[outFlag + 1]);
      const undo = rows.filter((r) => r.action === 'patch').map((r) => ({ id: r.id, name: r.name, was: r.was }));
      fs.writeFileSync(dest, `${JSON.stringify(undo, null, 2)}\n`);
      console.log(`Откат (было): ${dest}`);
    }
    const res = await applyPlan(col, rows);
    console.log(`Обновлено записей: ${res.n}. Пропуск: ${res.skipped.length}`);
    for (const s of res.skipped) console.log(`  ! ${s}`);
  } finally {
    if (client) await client.close();
  }
}

module.exports = { buildPlan, audit, PATCH, parseCats, canon, ORDER };

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(2); }).finally(() => {});
}
