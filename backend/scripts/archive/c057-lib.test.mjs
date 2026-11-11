// C057-Э0: тесты разборщика названий и JS-копии ключа сравнения. Запуск (из backend/): node --test scripts/c057-lib.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { groupOf, parseName, fillEmpty } = require('./lib/c057-parse.js');
const jsMatch = require('./lib/c057-match.js');

// ───── разборщик: 34 названия прода → ожидаемое ─────
// [название, категория, typeName, standardRef, materialGrade, размеры {тип: значение}]
const CASES = [
  ['Болт мебельный, M10х120, DIN 603', 'Метизы', 'Болт мебельный', 'DIN 603', '', { diameter: 10, length: 120 }],
  ['Болт мебельный, M6х20, DIN 603', 'Метизы', 'Болт мебельный', 'DIN 603', '', { diameter: 6, length: 20 }],
  ['Болт с шестигр. головкой, M10х100, кп 8.8, DIN 933', 'Метизы', 'Болт с шестигр. головкой', 'DIN 933', 'кп 8.8', { diameter: 10, length: 100 }],
  ['Болт с шестигр. головкой, M12х130, DIN 933', 'Метизы', 'Болт с шестигр. головкой', 'DIN 933', '', { diameter: 12, length: 130 }],
  ['Винт целиндр., с внутр. шестигр., M10х30, DIN 912', 'Метизы', 'Винт целиндр.', 'DIN 912', '', { diameter: 10, length: 30 }],
  ['Гайка колпачковая, M10, DIN 1587', 'Метизы', 'Гайка колпачковая', 'DIN 1587', '', { diameter: 10 }],
  ['Гайка с пластиковой вставкой, M8, DIN 985', 'Метизы', 'Гайка с пластиковой вставкой', 'DIN 985', '', { diameter: 8 }],
  ['Гайка шестигр., M16, DIN 6334', 'Метизы', 'Гайка шестигр.', 'DIN 6334', '', { diameter: 16 }],
  ['Гайка шестигр., M6, DIN 934', 'Метизы', 'Гайка шестигр.', 'DIN 934', '', { diameter: 6 }],
  ['Заклёпка вытяжная, 4,8х16, DIN 7337', 'Метизы', 'Заклёпка вытяжная', 'DIN 7337', '', { diameter: 4.8, length: 16 }],
  ['Конструкционный саморез по дереву 8 х 100/50', 'Метизы', 'Конструкционный саморез по дереву', '', '', { diameter: 8, length: 100 }],
  ['Кровельный саморез по металлу, с буром, 5,5х25, с шайбой EPDM', 'Метизы', 'Кровельный саморез по металлу', '', '', { diameter: 5.5, length: 25 }],
  ['Оцинкованный саморез по металлу SORREX DIN 7504P М4,2х19, 250 шт. 7504P-1-042-019 250', 'Метизы', 'Саморез по металлу', 'DIN 7504P', 'оцинкованная сталь', { diameter: 4.2, length: 19 }],
  ['Резьбовая шпилька, М12х2000, кп 8.8, DIN 975', 'Метизы', 'Резьбовая шпилька', 'DIN 975', 'кп 8.8', { diameter: 12, length: 2000 }],
  ['Саморез оконный б.ц. 3,9х19 сверло', 'Метизы', 'Саморез оконный сверло', '', 'белый цинк', { diameter: 3.9, length: 19 }],
  ['Саморез универсальный, PZ, потай., 5х25', 'Метизы', 'Саморез универсальный', '', '', { diameter: 5, length: 25 }],
  ['Саморез, потай., 6х140, DIN 7982', 'Метизы', 'Саморез', 'DIN 7982', '', { diameter: 6, length: 140 }],
  ['Саморез-шуруп, полусфер., 4,8х32, DIN 7981', 'Метизы', 'Саморез-шуруп', 'DIN 7981', '', { diameter: 4.8, length: 32 }],
  ['Цепь короткозвенная 6 мм DIN 766, нерж.', 'Метизы', 'Цепь короткозвенная', 'DIN 766', 'нержавеющая сталь', { diameter: 6 }],
  ['Шайба гроверная, M22, DIN 127', 'Метизы', 'Шайба гроверная', 'DIN 127', '', { diameter: 22 }],
  ['Шайба плоская, M22, DIN 125 чер. металл', 'Метизы', 'Шайба плоская', 'DIN 125', 'чёрная сталь', { diameter: 22 }],
  ['Шайба увеличенная, M16, DIN 9021', 'Метизы', 'Шайба увеличенная', 'DIN 9021', '', { diameter: 16 }],
  ['Шестигранная заклепка КРЕП-КОМП с внутр. резьбой, цил. бортик, белый цинк м8х1.25х18 350шт зрш8', 'Метизы', 'Шестигранная заклепка с внутр. резьбой', '', 'белый цинк', { diameter: 8, length: 18 }],
  ['Шуруп 5,0х25 желтый Цинк SG', 'Метизы', 'Шуруп', '', 'жёлтый цинк', { diameter: 5, length: 25 }],
  ['Шуруп., с шестигр. головкой, 10х150, DIN 571', 'Метизы', 'Шуруп', 'DIN 571', '', { diameter: 10, length: 150 }],
  ['Анкерный болт с гайкой 10х100', '', 'Анкерный болт с гайкой', '', '', { diameter: 10, length: 100 }],
  ['Лист AISI 304, 0,5 мм, 1250×1980', 'Листовой металл', 'Лист', '', 'AISI 304', { thickness: 0.5, length: 1980, width: 1250 }],
  ['Лист Ст3, 10 мм, 1500×3000', 'Листовой металл', 'Лист', '', 'Ст3', { thickness: 10, length: 3000, width: 1500 }],
  ['Лист рифлёный AISI 304, 2 мм, 1250×2500', 'Листовой металл', 'Лист', '', 'AISI 304', { thickness: 2, length: 2500, width: 1250 }],
  ['Лист АМг2, 4 мм', 'Листовой металл', 'Лист', '', 'АМг2', { thickness: 4 }],
  ['Лист AISI 430, 1,5 мм', 'Листовой металл', 'Лист', '', 'AISI 430', { thickness: 1.5 }],
  ['Стекло 10мм 2085х1230мм', 'Стекло', 'Стекло', '', '', { thickness: 10, length: 2085, width: 1230 }],
  ['Труба круглая Ø108×3, мытая, 12 м', 'Круглая труба', 'Труба', '', '', {}],
  ['Труба профильная 100×100×3, мытая, 6 м', 'Профильная труба', 'Труба', '', '', {}],
];

test(`разборщик: ${CASES.length} названий прода`, () => {
  assert.ok(CASES.length >= 30);
  for (const [name, cat, typeName, standardRef, grade, dims] of CASES) {
    const g = groupOf(cat, name);
    const p = parseName(name, g, cat);
    assert.ok(p.ok, `разобрано: ${name} (${p.reason})`);
    assert.equal(p.typeName, typeName, `typeName: ${name}`);
    assert.equal(p.standardRef, standardRef, `standardRef: ${name}`);
    assert.equal(p.materialGrade, grade, `materialGrade: ${name}`);
    assert.deepEqual(p.dims, dims, `размеры: ${name}`);
  }
});

test('виды разбора по категории', () => {
  assert.equal(groupOf('Метизы', 'x'), 'fastener');
  assert.equal(groupOf('Листовой металл', 'x'), 'sheet');
  assert.equal(groupOf('Круглая труба', 'x'), 'pipe');
  assert.equal(groupOf('Расходники', 'Бита KRAFTOOL'), 'other');
  assert.equal(groupOf('', 'Анкерный болт 10х100'), 'fastener');
  assert.equal(groupOf('', 'Что-то непонятное'), 'other');
  assert.equal(parseName('Бита KRAFTOOL', 'other').skipped, true);
});

test('fillEmpty: только пустые поля и недостающие размеры', () => {
  const p = parseName('Лист AISI 304, 1,5 мм, 1250×2500', 'sheet', 'Листовой металл');
  const m = { typeName: '', materialGrade: 'AISI 304', assortment: 'Лист 1,5 мм', dimensions: [{ type: 'thickness', value: 1.5 }] };
  const { set, addDims } = fillEmpty(m, p);
  assert.deepEqual(set, { typeName: 'Лист' });
  assert.deepEqual(addDims.map((d) => d.type).sort(), ['length', 'width']);
  const full = fillEmpty({ typeName: 'Свой', standardRef: 'X', materialGrade: 'Y', assortment: 'Z', dimensions: [{ type: 'diameter', value: 1 }, { type: 'length', value: 2 }] }, parseName('Болт, M10х120, DIN 933', 'fastener'));
  assert.deepEqual(full.set, {}, 'заполненное не меняется');
  assert.deepEqual(full.addDims, []);
});

// ───── JS-копия ключа = TS-версия ─────
function loadTs() {
  const ts = require(path.join(here, '..', '..', 'node_modules', 'typescript'));
  const src = fs.readFileSync(path.join(here, '..', 'src', 'common', 'catalog', 'match-key.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2022' } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
  return mod.exports;
}

test('ключ сравнения: JS-копия совпадает с TS на 24 примерах', () => {
  const tsMatch = loadTs();
  const inputs = [
    { kind: 'fastener', name: 'Болт мебельный, M10х120, DIN 603' },
    { kind: 'fastener', name: 'Болт с шестигр. головкой, M10х100, кп 8.8, DIN 933' },
    { kind: 'fastener', name: 'Гайка шестигр., M16, DIN 934' },
    { kind: 'fastener', name: 'Шайба плоская, M22, DIN 125 чер. металл' },
    { kind: 'fastener', typeName: 'Болт мебельный', standardRef: 'DIN 603', dimensions: [{ type: 'diameter', value: 8 }, { type: 'length', value: 110 }] },
    { kind: 'raw', name: 'Лист AISI 304, 1,5 мм, 1250×2500', materialGrade: 'AISI 304', assortment: 'Лист 1,5 мм' },
    { kind: 'raw', name: 'Лист Ст3, 10 мм, 1500×3000', typeName: 'Лист' },
    { kind: 'raw', name: 'Лист рифлёный Ст3, 3 мм, 1250×2500' },
    { kind: 'raw', name: 'Лист АМг2, 4 мм', assortment: 'Лист 4 мм', materialGrade: 'АМг2' },
    { kind: 'raw', name: 'Труба круглая Ø108×3, мытая, 12 м', assortment: 'Труба Ø108×3', typeName: 'Труба' },
    { kind: 'raw', name: 'Труба профильная 100×100×3, не мытая, 6 м', assortment: 'Труба 100×100×3' },
    { kind: 'raw', name: 'Труба круглая нерж. Ø21,3×1, 2 м', assortment: 'Труба Ø21,3×1', materialGrade: 'Нержавеющая сталь' },
    { kind: 'raw', name: 'Стекло 10мм 2085х1230мм' },
    { kind: 'raw', name: 'Фанера ФСФ 21 мм, береза, ГОСТ 3916.1-2018' },
    { kind: 'purchased', name: 'Подшипник 6-180306 АС17 (6306 2RS) (4) (72х30х19 мм)' },
    { kind: 'purchased', name: 'Cкоба такелажная из нержавеющей стали с габаритами 40х65 мм M04-310' },
    { kind: 'other', name: 'Рулетка Komfortabel, 8 м х 25 мм обрезиненный корпус GROSS 32563' },
    { name: 'Краска-спрей AUTON акриловая быстросохнущая RAL 3020 глянец' },
    { name: 'Анкерный болт с гайкой 10х100' },
    { name: '' },
  ];
  for (const i of inputs) assert.equal(jsMatch.matchKey(i), tsMatch.matchKey(i), JSON.stringify(i));
  const pdm = [
    { kind: 'fastener', assortment: 'Болт мебельный M8х110 DIN 603', material: 'Ст3', size: { length: 110 } },
    { kind: 'raw', assortment: 'Лист 1,5 мм', material: 'AISI 304' },
    { kind: 'raw', assortment: 'Труба Ø108×3', material: '' },
    { kind: 'purchased', assortment: 'Подшипник 6306', material: '', size: { length: 19 } },
    { kind: 'raw', assortment: 'Фанера 21 мм', material: 'берёза ФСФ' },
  ];
  for (const i of pdm) assert.equal(jsMatch.matchKeyPdm(i), tsMatch.matchKeyPdm(i), JSON.stringify(i));
  for (const c of ['SHP08.D125', 'ШП08.D125', 'SK08.080.PRSH', 'СК08.080.ПРШ']) assert.equal(jsMatch.designationKey(c), tsMatch.designationKey(c));
  assert.equal(inputs.length + pdm.length + 4 >= 24, true);
});

test('ключ: латиница и кириллица, х и ×, запятая — один ключ', () => {
  const a = jsMatch.matchKey({ kind: 'fastener', name: 'Болт мебельный, M8х110, DIN 603' });
  const b = jsMatch.matchKey({ kind: 'fastener', name: 'Болт мебельный, М8×110, din 603' });
  assert.equal(a, b);
  assert.equal(jsMatch.matchKey({ kind: 'raw', name: 'Лист AISI 304, 1,5 мм, 1250×2500' }), jsMatch.matchKeyPdm({ kind: 'raw', assortment: 'Лист 1,5 мм', material: 'AISI 304' }));
});
