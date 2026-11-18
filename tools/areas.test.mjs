import assert from 'node:assert/strict';
import test from 'node:test';
import { areaOf, areasOf, buildIndex, FOLDER_RULES, listTrackedFiles, scan } from './areas.mjs';

test('C128: длинный префикс atlas побеждает правило папки', () => {
  const index = buildIndex([
    { id: 'partners', code: ['backend/src/modules/partners', 'backend/pwa/sections/partners.js'] },
  ], FOLDER_RULES);
  assert.equal(areaOf('backend/src/modules/partners/partners.service.ts', index), 'partners');
  assert.equal(areaOf('backend/pwa/sections/partners.js', index), 'partners');
  assert.equal(areaOf('backend/src/common/guards/x.ts', index), 'server-common');
  assert.equal(areaOf('tools/ai-tester/run.mjs', index), 'aitester');
});

test('C128: файл без префикса — null', () => {
  const index = buildIndex([{ id: 'x', code: ['backend/src/modules/x'] }], [['backend/src/modules/x', 'x']]);
  assert.equal(areaOf('docs/BACKLOG.md', index), null);
});

test('C128: общий модуль — atlas раньше rule при той же длине', () => {
  const index = buildIndex(
    [{ id: 'requests', code: ['backend/src/modules/supply'] }],
    [['backend/src/modules/supply', 'server-modules']],
  );
  assert.equal(areaOf('backend/src/modules/supply/supply.service.ts', index), 'requests');
  assert.ok(areasOf('backend/src/modules/supply/x.ts', index).includes('requests'));
});

test('C128: listTrackedFiles не тянет node_modules и логи', () => {
  const files = listTrackedFiles();
  assert.ok(files.some((f) => f.startsWith('backend/src/')));
  assert.ok(files.some((f) => f.startsWith('tools/')));
  assert.equal(files.some((f) => f.includes('node_modules')), false);
  assert.equal(files.some((f) => f.includes('tools/logs/')), false);
});

test('C128: полный scan — без дыр (волна 1)', async () => {
  const { NODES } = await import('../backend/pwa/sections/atlas-data.js');
  const r = scan(NODES);
  assert.equal(r.unmapped.length, 0, `без участка: ${r.unmapped.slice(0, 10).join(', ')}`);
  assert.ok(r.mapped > 1000);
  assert.ok(r.areas.length >= 20);
});
