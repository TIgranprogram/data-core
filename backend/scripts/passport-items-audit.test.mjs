// Аудит пунктов паспорта (C054 B4): node --test backend/scripts/passport-items-audit.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = createRequire(import.meta.url)('./passport-items-audit.js');
const DATA = path.join(here, '..', '..', 'docs', 'crew', 'C054-passport-funnel', 'data');
// Тексты — копия без условий (when): в рабочем файле они уже поставлены (--apply 2026-11-09), а тесты проверяют сам аудит
const TEXTS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c054-texts-')), 'texts.json');
fs.writeFileSync(TEXTS, fs.readFileSync(path.join(here, 'passport-texts.v2.json'), 'utf8').replace(/, "when": \[[^\]]*\]/g, ''));
const opts = { data: DATA, texts: TEXTS };
// выгрузки прода лежат только локально (gitignored) — без них тесты аудита пропускаются
const HAVE_DATA = fs.existsSync(path.join(DATA, 'passport-597.json'));
const dataTest = (name, fn) => test(name, { skip: !HAVE_DATA && 'нет выгрузок прода в docs/crew/C054-passport-funnel/data/' }, fn);

test('слова → признаки: сильные уверенно, слабые спорно, «корней деревьев» — не дерево', () => {
  assert.deepEqual([A.suggest('Если опоры бетонируют, работы выполняют...').when, A.suggest('Если опоры бетонируют').sure], ['concrete', true]);
  assert.equal(A.suggest('Проверяют трещины сварных швов').when, 'welds');
  const tree = A.suggest('Рядом нет корней деревьев');
  assert.equal(tree.when, '!atTree');
  assert.ok(!tree.why.includes('дерев?') || tree.why.startsWith('корн'));
  assert.equal(A.suggest('Проверяют затяжку крепежа').sure, false);
  assert.equal(A.suggest('Общие указания по гарантии'), null);
});

test('условия: проверка и вычисление как на сервере', () => {
  assert.ok(A.whenOk('bolts|welds !freestanding'));
  assert.ok(!A.whenOk('bolts|'));
  assert.ok(!A.whenOk('nonsense'));
  assert.equal(A.evalWhen('concrete !freestanding', ['concrete']), true);
  assert.equal(A.evalWhen('concrete !freestanding', ['concrete', 'freestanding']), false);
  assert.equal(A.evalWhen('', []), true);
});

dataTest('отчёт: спорных не больше 40, 13 фраз проверяются, у решётки остаются только данные, которые чинятся новой записью', () => {
  const audit = A.buildAudit(opts);
  const rep = A.renderReport(audit, DATA);
  assert.ok(rep.disputed <= 40 && rep.sure > 0);
  assert.equal(A.FORBIDDEN.length, 13);
  assert.ok(rep.md.includes('Проверка «как 597»'));
  // все предложения + новый материал: ни одной запрещённой фразы
  assert.equal(rep.leftAll.length, 0);
  // каждое when предложения — допустимая строка
  for (const x of [...audit.texts, ...audit.defects]) if (x.sug) assert.ok(A.whenOk(x.sug.when), x.sug.when);
  assert.ok(A.NEW_INSTALL.traits === 'freestanding');
});

dataTest('apply: when записывается в копию файла, формат и длины сохраняются, повтор не меняет файл', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c054-'));
  const copy = path.join(dir, 'texts.json');
  fs.copyFileSync(TEXTS, copy);
  const audit = A.buildAudit({ data: DATA, texts: copy });
  const raw = fs.readFileSync(copy, 'utf8');
  const r1 = A.applyToTexts(raw, audit, A.makeDecide(null));
  const json = JSON.parse(r1.out);
  let n = 0;
  for (const cat of Object.values(json)) for (const s of cat.sections) {
    assert.equal(s.ids.length, s.paragraphs.length);
    if (s.when) { assert.equal(s.when.length, s.paragraphs.length); n += s.when.filter(Boolean).length; s.when.filter(Boolean).forEach((w) => assert.ok(A.whenOk(w), w)); }
  }
  assert.equal(n, r1.changed.length);
  assert.ok(n > 0);
  assert.ok(r1.out.split('\r\n').length === raw.split('\r\n').length, 'число строк не изменилось');
  // повтор: уже поставленные when сохраняются, новых нет
  const audit2 = A.buildAudit({ data: DATA, texts: copy });
  fs.writeFileSync(copy, r1.out);
  const r2 = A.applyToTexts(fs.readFileSync(copy, 'utf8'), A.buildAudit({ data: DATA, texts: copy }), A.makeDecide(null));
  assert.equal(r2.changed.length, 0);
  assert.equal(r2.out, r1.out);
  void audit2;
});

dataTest('apply: решения пользователя — keep пропускает, свой when принимается, мусор отклоняется', () => {
  const audit = A.buildAudit(opts);
  const sure = audit.texts.find((x) => x.state === 'уверенно' && x.source === 'код');
  const disputed = audit.texts.find((x) => x.state === 'спорно' && x.source === 'код');
  const key = (x) => `${x.cat}/${x.section}/${x.id}`;
  assert.equal(A.makeDecide({ [key(sure)]: 'keep' })(sure), null);
  assert.equal(A.makeDecide(null)(disputed), null); // без решения спорное не применяется
  assert.equal(A.makeDecide({ [key(disputed)]: 'concrete' })(disputed), 'concrete');
  assert.throws(() => A.makeDecide({ [key(disputed)]: 'nonsense' })(disputed), /неверное условие/);
});

dataTest('план для прода: только данные, без паспортов; новые записи способа и материала', () => {
  const audit = A.buildAudit(opts);
  const plan = A.buildApplyPlan(audit, A.makeDecide(null), DATA);
  assert.ok(plan.create.some((c) => c.dict === 'passportInstall' && c.body.traits === 'freestanding'));
  assert.ok(plan.create.some((c) => c.dict === 'passportMaterials' && c.body.code === 'STEEL_POWDER_SHEET'));
  assert.ok(plan.dicts.every((d) => ['passportElements', 'passportMaterials', 'passportInstall', 'passportDefects'].includes(d.dict)));
  assert.ok(plan.dicts.some((d) => d.dict === 'passportDefects' && d.code === 'WELD_CRACK' && d.set.when === 'welds'));
  assert.ok(!JSON.stringify(plan).includes('productpassports'));
});
