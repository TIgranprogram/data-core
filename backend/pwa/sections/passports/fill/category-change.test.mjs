import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { changeCategory } = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('./category-change.js', import.meta.url), 'utf8')).toString('base64'));
const product = () => ({ id: 'p', passportCategory: { code: 'BLG' }, passportDefaults: { passportCategory: 'BLG', textChoices: { purpose: 'choice' }, textOverrides: { purpose: 'Ручное' }, warrantyMonths: 24 } });

test('отмена несовместимой категории не пишет и сохраняет ручной текст', async () => {
  const prod = product(); const before = structuredClone(prod);
  assert.equal(await changeCategory(prod, 'DIO', { approve: async () => false, put: () => assert.fail(), reset: () => assert.fail(), read: () => assert.fail() }), false);
  assert.deepEqual(prod, before);
});

test('явное согласие очищает только выборы и ручной шаблон, сохраняя общие сведения', async () => {
  const prod = product(); let saved;
  assert.equal(await changeCategory(prod, 'DIO', { approve: async () => true, put: async (p, change) => { saved = { ...p.passportDefaults, ...change }; }, reset: () => assert.fail(), read: async () => ({ ...prod, passportDefaults: saved, passportCategory: { code: 'DIO' } }) }), true);
  assert.deepEqual(saved, { passportCategory: 'DIO', textChoices: {}, textOverrides: {}, warrantyMonths: 24 });
  assert.equal(prod.passportCategory.code, 'DIO');
});

test('сброс использует специальный reset и возвращает наследуемую категорию', async () => {
  const prod = product(); let resetCalled = false;
  await changeCategory(prod, '', { approve: async () => true, put: () => assert.fail(), read: () => assert.fail(), reset: async (p) => {
    resetCalled = true; const pd = { ...p.passportDefaults }; delete pd.passportCategory;
    return { ...p, passportDefaults: pd, passportCategory: { code: 'WRK' } };
  } });
  assert.equal(resetCalled, true); assert.equal(prod.passportCategory.code, 'WRK');
  assert.equal(prod.passportDefaults.passportCategory, undefined);
  assert.equal(prod.passportDefaults.warrantyMonths, 24);
});

test('ошибка записи не меняет локальную категорию/ручной текст', async () => {
  const prod = product(); const before = structuredClone(prod);
  await assert.rejects(changeCategory(prod, 'DIO', { approve: async () => true, put: async () => { throw new Error('PUT'); } }), /PUT/);
  assert.deepEqual(prod, before);
});
