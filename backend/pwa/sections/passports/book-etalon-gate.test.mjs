/**
 * C141: ворота «эталон = книжка».
 * Если снова появится вход в старую анкету/форму/карандаши — этот тест красный.
 * Так не бродим по сайту вручную: список запрещённых вызовов в файлах-входах.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = fileURLToPath(new URL('.', import.meta.url));
const sections = join(here, '..'); // backend/pwa/sections
const pwaRoot = join(here, '../..');

/** Файлы-входы UI (не сам fill/wizard — их код может жить, но не звать с экрана). */
const ENTRY_GLOBS = [
  'docs.js',
  'passports.js',
  'products.js',
  'products/card-blocks.js',
  'products/fill-block.js',
  'order-line-passports.js',
  'order-passport-plan.js',
  'passports/funnel/index.js',
  'passports/funnel/open.js',
  'passports/models.js',
  'passports/open-book.js',
  'passports/book-editor.js',
];

/** Запрещено в файлах-входах: монтировать старую анкету / вести в правую форму паспорта. */
const FORBIDDEN = [
  { re: /passportFill\s*\(/, why: 'старая анкета passportFill — только книжка' },
  { re: /passportWizard\s*\(/, why: 'wizard на карточке — только книжка' },
  { re: /openPassportTemplate[\s\S]{0,200}doctpl/, why: 'шаблон через doctpl — только openBookForProduct' },
  { re: /of:\s*['"]passports['"]\s*,\s*new:\s*['"]1['"]/, why: 'создание через старую форму of=passports' },
  { re: /fieldPencil\s*\(/, why: 'карандаш на карточке — правка в книжке' },
];

/** Обязательно: единая точка входа в книжку существует. */
const REQUIRED = [
  { file: 'passports/open-book.js', re: /export async function openBookForProduct/, why: 'openBookForProduct' },
  { file: 'passports/book-editor.js', re: /export async function openBookEditor/, why: 'openBookEditor' },
  { file: 'passports/funnel/index.js', re: /openBookForProduct/, why: 'воронка после изделия → книжка' },
  { file: 'passports/funnel/index.js', re: /import\s*\{[^}]*passportFill|passportFill\s*\(/, why: 'воронка не должна импортировать/звать passportFill', neg: true },
];

function read(rel) {
  return readFileSync(join(sections, rel), 'utf8');
}

test('C141: open-book и book-editor на месте', () => {
  for (const r of REQUIRED) {
    const text = read(r.file);
    if (r.neg) assert.equal(r.re.test(text), false, `${r.file}: ${r.why}`);
    else assert.match(text, r.re, `${r.file}: нет ${r.why}`);
  }
});

test('C141: файлы-входы не зовут старую анкету/форму/карандаши', () => {
  const hits = [];
  for (const rel of ENTRY_GLOBS) {
    let text;
    try { text = read(rel); } catch { hits.push(`${rel}: файл не найден`); continue; }
    for (const f of FORBIDDEN) {
      if (f.re.test(text)) hits.push(`${rel}: ${f.why}`);
    }
  }
  assert.equal(hits.length, 0, hits.join('\n'));
});

test('C141: эталонные кнопки зовут книжку (строки-якоря)', () => {
  const products = read('products.js');
  assert.match(products, /Шаблон паспорта/, 'меню изделия: Шаблон паспорта');
  assert.match(products, /openBookEditor|openBookForProduct|openPassportTemplate/, 'меню изделия ведёт в книжку');

  const docs = read('docs.js');
  assert.match(docs, /openBookForProduct|\.\.\.passports\.card/, 'документация использует книжку и карточку паспорта');
  assert.match(read('passports.js'), /openBookEditor/, 'архив открывает книжку экземпляра по id');
  assert.equal(/passportFill\s*\(/.test(docs), false, 'docs.js не монтирует passportFill');

  const line = read('order-line-passports.js');
  assert.match(line, /openBookEditor/, 'заказ: номер/кнопка → книжка');
  assert.equal(/of:\s*['"]passports['"]/.test(line), false, 'заказ не открывает of=passports для правки');
});

test('C141: канон iLogic на сайте (статика)', () => {
  const path = join(pwaRoot, 'ilogic', 'passport-images.iLogicVb');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /UploadPassportImages/);
  assert.match(text, /kppdf-crm\.ru\/db\/api\//);
  const ui = read('passports/book-ilogic.js');
  assert.match(ui, /ilogic\/passport-images\.iLogicVb/);
});
