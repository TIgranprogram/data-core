import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBatchSafe } from '../ui/chain.mjs';

test('пакетная цепочка разрешает только доступные read-only команды', () => {
  assert.equal(isBatchSafe({ kind: 'job', risk: 'read', blocked: [] }), true);
  assert.equal(isBatchSafe({ kind: 'job', risk: 'local', blocked: [] }), false);
  assert.equal(isBatchSafe({ kind: 'job', risk: 'prod-write', blocked: [] }), false);
  assert.equal(isBatchSafe({ kind: 'job', risk: 'danger', blocked: [] }), false);
  assert.equal(isBatchSafe({ kind: 'job', risk: 'read', confirm: 'Подтвердите', blocked: [] }), false);
  assert.equal(isBatchSafe({ kind: 'job', risk: 'read', word: 'СРОЧНО', blocked: [] }), false);
  assert.equal(isBatchSafe({ kind: 'job', risk: 'read', blocked: ['Нет Docker'] }), false);
  assert.equal(isBatchSafe({ kind: 'link', risk: 'read', blocked: [] }), false);
});
