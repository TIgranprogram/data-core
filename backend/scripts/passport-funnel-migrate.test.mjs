// План перевода «Готовых текстов» в дерево (ПВ): node --test backend/scripts/passport-funnel-migrate.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { buildPlan } = createRequire(import.meta.url)('./passport-funnel-migrate.js');

const ph = (id, section, name, text, categories = '', extra = {}) => ({ _id: id, section, name, text, categories, ...extra });

test('старые эталоны → листья под корнями; без категорий — «для всех»', () => {
  const p = buildPlan([ph('a1', 'purpose', 'Для занятий', 'Изделие для занятий.'), ph('a2', 'installation', 'Анкерное', 'Крепится анкерами.', 'TRN')], []);
  assert.deepEqual(p.roots.map((r) => r.section), ['purpose', 'installation']);
  assert.equal(p.leaves.length, 2);
  assert.equal(p.leaves.find((l) => l.id === 'a1').allCategories, true);
  assert.equal(p.leaves.find((l) => l.id === 'a2').allCategories, false);
});

test('повторный запуск: перенесённое и корни не создаются заново', () => {
  const root = { _id: 'r', section: 'purpose', name: 'Назначение', text: null, funnelV: 1 };
  const p = buildPlan([root, ph('a1', 'purpose', 'Для занятий', 'Текст.', '', { parentId: 'r', funnelV: 1 })], []);
  assert.equal(p.roots.length, 0);
  assert.equal(p.leaves.length, 0);
  assert.equal(p.skipped, 1);
});

test('способ установки: привязка по названию и новый лист из текста монтажа', () => {
  const inst = [{ _id: 'i1', name: 'Анкерное', montage: 'Шаг 1\nШаг 2', categories: '' }, { _id: 'i2', name: 'Бетонирование', montage: 'Залить бетон', categories: 'WRK' }, { _id: 'i3', name: 'Без текста' }];
  const p = buildPlan([ph('a2', 'installation', 'Анкерное', 'Крепится анкерами.')], inst);
  assert.equal(p.leaves[0].installTypeId, 'i1');
  assert.equal(p.newLeaves.length, 1);
  assert.equal(p.newLeaves[0].installTypeId, 'i2');
  assert.equal(p.newLeaves[0].text, 'Залить бетон');
  assert.equal(p.newLeaves[0].allCategories, false);
});
