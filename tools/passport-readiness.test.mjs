import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './passport-readiness.mjs';

test('classify: умолчание — не пробел, но отмечается', () => {
  const g = { missing: [{ key: 'warranty', label: 'Гарантия', required: true, default: '12' }, { key: 'f', label: 'Цвет', required: false }] };
  assert.deepEqual(classify(g, { missing: [] }), { ready: false, defaultsOnly: true, reasons: [], defaults: 1 });
});

test('classify: обязательное без умолчания и выбор раздела — причины', () => {
  const g = { missing: [{ key: 'dims', label: 'Габариты', required: true }] };
  const c = { missing: [{ key: 'choice:abc', label: 'Назначение' }, { key: 'dims', label: 'Габариты' }] };
  const r = classify(g, c);
  assert.equal(r.ready, false);
  assert.deepEqual(r.reasons, ['Габариты', 'Выбор: Назначение']);
});

test('classify: пусто — готов', () => {
  assert.equal(classify({ missing: [] }, null).ready, true);
});
