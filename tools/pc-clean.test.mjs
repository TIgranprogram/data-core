// node --test tools/pc-clean.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickOld, oldCopies } from './pc-clean.mjs';

test('уборка: старше срока — убрать, служебные файлы — оставить', () => {
  const now = 100 * 86400000;
  const e = [{ path: 'logs/a.log', mtime: now - 31 * 86400000 }, { path: 'logs/b.log', mtime: now - 2 * 86400000 }, { path: 'logs/run.json', mtime: 0 }];
  assert.deepEqual(pickOld(e, now, 30 * 86400000, (x) => x.path.endsWith('run.json')), ['logs/a.log']);
});

test('копии базы: остаётся только самая свежая', () => {
  assert.deepEqual(oldCopies(['datacore-2026-11-10_135427.tgz', 'pull.log', 'datacore-2026-11-13_053526.tgz', 'datacore-2026-11-12_152138.tgz']),
    ['datacore-2026-11-10_135427.tgz', 'datacore-2026-11-12_152138.tgz']);
  assert.deepEqual(oldCopies(['datacore-2026-11-13_053526.tgz']), []);
  assert.deepEqual(oldCopies([]), []);
});
