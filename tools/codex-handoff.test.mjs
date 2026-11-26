import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { persistHandoff, runHandoff } from './codex-handoff.mjs';

const NOW = Date.parse('2026-11-26T19:00:00.000Z');
const RUN = '2026-11-26_200000';
const SECRET = 'synthetic_password_TEST_CANARY';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-codex-handoff-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q');
  fs.writeFileSync(path.join(root, '.gitignore'), 'tools/.night/\ntools/logs/\n');
  fs.writeFileSync(path.join(root, 'code.js'), '');
  git('add', '.');
  git('-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture');
  const head = git('rev-parse', 'HEAD');
  const sha = head.slice(0, 8);
  const makeStep = (step, code = 0, signature = null) => ({ step, code, ms: 300, commit: sha, ok: code === 0, signature, tail: SECRET });
  const summary = {
    date: '2026-11-26T17:00:00.000Z', durationMs: 35000, commit: sha, quick: true,
    steps: [makeStep('tsc'), makeStep('unit', 1, 'unit:12345678'), makeStep('imports'), makeStep('eslint'),
      makeStep('design-lint'), makeStep('unit', 1, 'unit:12345678'), makeStep('unit', -1, SECRET)],
    failed: [SECRET], token: SECRET,
  };
  function save(value = summary, id = RUN) {
    const dir = path.join(root, 'tools/.night/runs', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'summary.json'), typeof value === 'string' ? value : JSON.stringify(value));
  }
  save();
  return { root, git, head, save, summary };
}

test('из локального прогона выводятся проверяемые факты, одинаковые ошибки объединяются и отчёт не дублируется', t => {
  const { root, head } = fixture(t);
  const result = runHandoff(root, NOW);
  assert.match(result.report, /## Факты/);
  assert.match(result.report, new RegExp(head));
  assert.match(result.report, /текущему чистому HEAD/);
  assert.match(result.report, /Неуспешных: 3\. Групп сбоев: 2/);
  assert.match(result.report, /unit, код 1, сигнатура 12345678, записей 2/);
  assert.match(result.report, /unit, код -1, сигнатура не подтверждена/);
  assert.match(result.report, /## Гипотезы/);
  assert.ok(!result.report.includes(SECRET));
  assert.deepEqual(runHandoff(root, NOW + 1000), result);
  const rel = persistHandoff(root, result);
  assert.equal(persistHandoff(root, result), rel);
  assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), result.report);
  assert.deepEqual(fs.readdirSync(path.dirname(path.join(root, rel))), [result.reportId + '.md']);
});

test('при старом SHA, грязной копии, возрасте и пропуске этапов результат не приписывается текущему дереву', t => {
  const { root, git, save, summary } = fixture(t);
  fs.writeFileSync(path.join(root, 'code.js'), 'новая версия');
  let result = runHandoff(root, NOW);
  assert.match(result.report, /незакоммиченные изменения/);
  assert.doesNotMatch(result.report, /текущему чистому HEAD/);
  git('add', 'code.js');
  git('-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'next');
  save({ ...summary, quick: false });
  result = runHandoff(root, NOW + 48 * 3600000);
  assert.match(result.report, /SHA прогона отличается/);
  assert.match(result.report, /старше 36 часов/);
  assert.match(result.report, /Отсутствующие этапы: tools-unit, e2e/);
});

test('новый незавершённый прогон не подменяется прошлым, а повредившиеся файлы и внешние ссылки отклоняются', t => {
  const { root, save, summary } = fixture(t);
  const newer = '2026-11-26_210000';
  const dir = path.join(root, 'tools/.night/runs', newer);
  fs.mkdirSync(dir);
  assert.match(runHandoff(root, NOW).issue, /ещё нет итогового/);
  const own = runHandoff(root, NOW, RUN);
  assert.ok(own.report.includes(`runs/${RUN}/summary.json`));
  assert.match(runHandoff(root, NOW, '2026-11-26_220000').issue, /ещё нет итогового/);
  assert.match(runHandoff(root, NOW, '../outside').issue, /Недействительный идентификатор/);
  save('x'.repeat(256 * 1024 + 1), newer);
  assert.match(runHandoff(root, NOW).issue, /Размер/);
  save({ ...summary, steps: [...summary.steps, { step: SECRET }] }, newer);
  assert.match(runHandoff(root, NOW).issue, /Формат/);
  save(SECRET + '\n', newer);
  assert.match(runHandoff(root, NOW).issue, /Формат/);
  const input = path.join(dir, 'summary.json');
  fs.unlinkSync(input);
  fs.rmdirSync(dir);
  fs.symlinkSync(path.join(root, 'tools/.night/runs', RUN), dir, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(runHandoff(root, NOW).issue, /перенаправлен/);
  assert.deepEqual(runHandoff(root, NOW, RUN), own);
});
