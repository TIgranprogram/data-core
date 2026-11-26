import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atlasCodeHashes, atlasCodeWarnings, readAtlasCodeReviews, recordAtlasCodeReview } from './atlas-code.mjs';

test('сверка Atlas независима по блокам, учитывает правки до коммита и не зависит от CRLF', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-atlas-code-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
  const read = () => readAtlasCodeReviews(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true });
  git('init', '-q');
  fs.mkdirSync(path.join(root, 'suppliers'));
  fs.mkdirSync(path.join(root, 'tools'));
  write('.gitattributes', '* text=auto\n');
  write('.gitignore', 'suppliers/ignored.js\n');
  write('suppliers/code.js', 'const a = 1;\n');
  write('stock.js', 'const b = 2;\n');
  write('tools/atlas-code-reviewed.json', '{}');
  git('-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'add', '.');
  const nodes = [{ id: 'suppliers', code: ['suppliers/'] }, { id: 'stock', code: ['stock.js'] }];
  const current = () => atlasCodeHashes(root, nodes);
  for (const node of nodes) recordAtlasCodeReview(root, node);
  const before = read();

  write('suppliers/code.js', 'const a = 1;\r\n');
  write('suppliers/ignored.js', 'ignored');
  write('atlas-data.js', '// Изменение другого блока\n');
  assert.deepEqual(current(), before);

  write('suppliers/new.js', 'const c = 3;\n');
  write('stock.js', 'const b = 4;\n');
  assert.deepEqual(atlasCodeWarnings(current(), before).map(warning => warning.split(':')[0]), ['suppliers', 'stock']);
  write('tools/atlas-code-reviewed.json.lock', '');
  assert.throws(() => recordAtlasCodeReview(root, nodes[1]), { code: 'EEXIST' });
  assert.deepEqual(read(), before);
  fs.unlinkSync(path.join(root, 'tools/atlas-code-reviewed.json.lock'));
  recordAtlasCodeReview(root, nodes[1]);
  assert.equal(read().suppliers, before.suppliers);
  assert.deepEqual(atlasCodeWarnings(current(), read()).map(warning => warning.split(':')[0]), ['suppliers']);
  assert.match(atlasCodeWarnings(current(), { stock: read().stock })[0], /^suppliers: нет отметки/);

  recordAtlasCodeReview(root, nodes[0]);
  fs.unlinkSync(path.join(root, 'suppliers/code.js'));
  assert.deepEqual(atlasCodeWarnings(current(), read()).map(warning => warning.split(':')[0]), ['suppliers']);
});
