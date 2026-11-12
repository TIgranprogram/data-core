import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

async function fixture(full = {}, initial = {}, manual = []) {
  const source = readFileSync(new URL('./product-block.js', import.meta.url), 'utf8');
  const deps = {};
  for (const m of source.matchAll(/import \{([^}]+)\} from '([^']+)'/g)) {
    deps[m[2]] ||= {};
    for (const part of m[1].split(',')) deps[m[2]][part.trim().split(/\s+as\s+/)[0]] = () => {};
  }
  Object.assign(deps['./common.js'], { st: {}, num: Number, V2_NUMS: [['ageFrom', 'Возраст']], api_get: async () => full });
  Object.assign(deps['./models.js'], { mmOf: (v) => v, models: async () => [] });
  deps['../../core/dom.js'].h = (tag, attrs, text) => ({ textContent: text, hidden: false });
  const context = createContext({});
  const mod = new SourceTextModule(source, { context });
  await mod.link((key) => new SyntheticModule(Object.keys(deps[key]), function () { for (const [k, v] of Object.entries(deps[key])) this.setExport(k, v); }, { context }));
  await mod.evaluate();
  const values = { ...initial }; const fields = new Map(); const changes = [];
  const form = {
    get: (k) => values[k] ?? '', manual: (k) => manual.includes(k),
    set: (k, v) => { values[k] = v; changes.push(k); },
    input: (k) => k === '_mspec' ? { isEmpty: () => !values[k] } : { classList: { contains: () => false } },
    field: (k) => {
      if (!fields.has(k)) fields.set(k, { inert: false, classList: { toggle() {} }, querySelector() { return this.note; }, append(note) { this.note = note; } });
      return fields.get(k);
    },
  };
  return { mod: mod.namespace, form, fields, values, changes };
}

test('реальная блокировка уважает точный серверный список и alias таблицы материалов', async () => {
  const f = await fixture();
  for (const key of ['certNumber', 'certUntil', 'certEac', 'seatWidth', 'seatHeight', 'supports', 'shipVolume', 'category']) f.form.field(key);
  f.mod.lockProductFields(f.form, new Set(['name', 'elements', 'textChoices', 'materialsSpec', 'warrantyMonths']), { active: true });
  for (const key of ['name', 'elements', 'textChoices', '_mspec', 'warrantyMonths']) {
    assert.equal(f.fields.get(key).inert, true, key);
    assert.match(f.fields.get(key).note.textContent, /Из изделия/);
  }
  for (const key of ['height', 'weight', 'certNumber', 'certUntil', 'certEac', 'seatWidth', 'seatHeight', 'supports', 'shipVolume', 'category']) assert.equal(f.fields.get(key).inert, false, key);
  // Источник очистили в изделии: прежние замки и метки должны исчезнуть.
  f.mod.lockProductFields(f.form, new Set(['name']), { active: true });
  assert.equal(f.fields.get('_mspec').inert, false);
  assert.equal(f.fields.get('warrantyMonths').note.hidden, true);
});

test('новое изделие блокирует только непустые источники, включая false и нулевые умолчания', async () => {
  const full = { name: 'Турник', sku: '', dimensions: { length: 10, width: null }, weightKg: 0, materialsSpec: null,
    passportDefaults: { isKit: false, ageFrom: 0, elements: [], textChoices: {}, warrantyMonths: 12 }, certNumber: 'Не источник' };
  const f = await fixture(full);
  const sources = f.mod.productSourceFields(full, 'BLG');
  f.mod.lockProductFields(f.form, sources, { active: true });
  for (const key of ['name', 'length', 'isKit', 'ageFrom', 'warrantyMonths', 'passportCategory']) assert.equal(f.fields.get(key).inert, true, key);
  for (const key of ['article', 'width', 'weight', 'elements', 'textChoices', '_mspec']) assert.equal(f.fields.get(key).inert, false, key);
  assert.equal(sources.has('certNumber'), false);
});

test('возврат applyProduct обновляет источники, но сохраняет ручной выбор текстов и соседние поля', async () => {
  const full = { name: 'Изделие', dimensions: { length: 100 }, passportDefaults: { warrantyMonths: 24, textChoices: { purpose: 'new' } }, materialsSpec: { rows: [{ materialId: 'new' }] } };
  const f = await fixture(full, { textChoices: '{"purpose":"mine"}', _mspec: 'ручная таблица', certNumber: 'Ручной сертификат', warrantyMonths: 12 }, ['textChoices', '_mspec', 'certNumber']);
  const info = await f.mod.applyProduct(f.form, { id: 'p' }, new Map());
  assert.equal(f.values.textChoices, '{"purpose":"mine"}');
  assert.equal(f.values._mspec, 'ручная таблица');
  assert.equal(f.values.certNumber, 'Ручной сертификат');
  assert.equal(f.values.warrantyMonths, 24);
  assert.equal(info.sourceFields.has('textChoices'), true);
  f.mod.lockProductFields(f.form, info.sourceFields, { active: true });
  assert.equal(f.fields.get('textChoices').inert, true);
  assert.match(f.fields.get('textChoices').note.textContent, /заменится данными изделия/);
});

test('явно ручной монтаж и назначение остаются доступны и не заменяются при возврате', async () => {
  const f = await fixture({ purpose: 'Из изделия', installation: 'Из изделия' }, { _manualText: 'yes', purpose: 'Моё назначение', installationMethod: 'Мой монтаж' });
  const info = await f.mod.applyProduct(f.form, { id: 'p' }, new Map());
  f.mod.lockProductFields(f.form, info.sourceFields, { active: true, manualText: ['purpose', 'installationMethod'] });
  assert.equal(f.values.purpose, 'Моё назначение');
  assert.equal(f.values.installationMethod, 'Мой монтаж');
  assert.equal(f.fields.get('purpose').inert, false);
  assert.equal(f.fields.get('installationMethod').inert, false);
});

test('ручная очистка соседнего поля не заполняется заново после возврата', async () => {
  const f = await fixture({ description: 'Старое описание', passportDefaults: { warrantyMonths: 24 } }, { description: '', warrantyMonths: '' }, ['description', 'warrantyMonths']);
  await f.mod.applyProduct(f.form, { id: 'p' }, new Map());
  assert.equal(f.values.description, '');
  assert.equal(f.values.warrantyMonths, '');
});

test('запоздавший ответ прежнего изделия не меняет текущую форму', async () => {
  const f = await fixture({ name: 'Прежнее', dimensions: { length: 999 } }, { name: 'Новое', length: 111 });
  assert.equal(await f.mod.applyProduct(f.form, { id: 'old' }, new Map(), () => false), null);
  assert.equal(f.values.name, 'Новое'); assert.equal(f.values.length, 111);
  assert.equal(f.changes.length, 0);
});


test('DOM: первый клик после ввода сертификата и blur/change открывает изделие', async () => {
  const { chromium } = await import('../../../../tools/design-checks/node_modules/playwright-core/index.mjs');
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<form id="form"><input name="certNumber"><input name="length"><div id="product"></div></form>');
    const source = readFileSync(new URL('./product-block.js', import.meta.url), 'utf8')
      .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    await page.evaluate(async (source) => {
      const prelude = `
        const st = {}, V2_NUMS = [], V2_CATS = [], PREFIX = '', products = {};
        const dims = () => '', canEdit = () => true;
        const mmOf = (v) => v, num = Number;
        const api_get = async () => ({ id: 'p', name: 'Изделие', passportDefaults: {} });
        const productsAll = async () => [{ id: 'p', name: 'Изделие' }];
        const openCard = () => { window.opened = (window.opened || 0) + 1; };
        const h = (tag, attrs, ...children) => {
          const el = document.createElement(tag);
          for (const [key, value] of Object.entries(attrs || {})) {
            if (key === 'class') el.className = value;
            else if (key === 'style') Object.assign(el.style, value);
            else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
            else if (value != null) el.setAttribute(key, value);
          }
          for (const child of children.flat(Infinity)) if (child != null) el.append(child);
          return el;
        };
        const button = ({ label, onClick }) => h('button', { type: 'button', onclick: onClick }, label);
        const kitSku = (v) => v;
      `;
      const mount = new Function(prelude + source + '; return productBlock;')();
      const form = document.querySelector('#form');
      const values = { productId: 'p' };
      mount({ root: form, get: (key) => form.querySelector('[name="' + key + '"]')?.value ?? values[key] ?? '',
        set: (key, value) => { values[key] = value; }, manual: () => false, field: () => null,
        input: (key) => key === '_product' ? { el: document.querySelector('#product') } : form.querySelector('[name="' + key + '"]'),
      }, { r: { id: 'passport', status: 'draft', fromProductFields: [] }, catBy: new Map() });
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.originalEdit = document.querySelector('[data-edit-product]');
    }, source);
    await page.locator('[name="certNumber"]').fill('Ручной сертификат');
    assert.equal(await page.evaluate(() => window.originalEdit === document.querySelector('[data-edit-product]')), true, 'Сертификат не должен пересоздавать сводку');
    await page.locator('[data-edit-product]').click();
    assert.equal(await page.evaluate(() => window.opened), 1);
    assert.equal(await page.locator('[name="certNumber"]').inputValue(), 'Ручной сертификат');
    // Размер меняет сводку на input, но следующий change на blur не должен съесть click.
    await page.locator('[name="length"]').fill('123');
    await page.evaluate(() => { window.afterInput = document.querySelector('[data-edit-product]'); });
    await page.locator('[data-edit-product]').click();
    assert.equal(await page.evaluate(() => window.opened), 2);
    assert.equal(await page.evaluate(() => window.afterInput === document.querySelector('[data-edit-product]')), true);
  } finally { await browser.close(); }
});
