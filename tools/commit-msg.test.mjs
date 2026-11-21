import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('PARTIAL сохраняется только в явно незавершённой WIP-ветке', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dc-commit-msg-'));
  const hook = resolve('.githooks/commit-msg').replaceAll('\\', '/');
  const env = {...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: dir.replaceAll('\\', '/')};
  const git = (...args) => {
    const r = spawnSync('git', args, {cwd: dir, env, encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    git('init', '-b', 'main');
    mkdirSync(join(dir, 'backend/pwa'), {recursive: true});
    mkdirSync(join(dir, 'backend/scripts'), {recursive: true});
    copyFileSync(resolve('backend/scripts/review-scope.mjs'), join(dir, 'backend/scripts/review-scope.mjs'));
    writeFileSync(join(dir, 'backend/pwa/example.js'), '// fixture\n');
    git('add', 'backend/pwa/example.js');
    const message = join(dir, 'message.txt');
    const run = (body) => {
      writeFileSync(message, body);
      const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
      return spawnSync(bash, [hook, message.replaceAll('\\', '/')], {cwd: dir, env, encoding: 'utf8'});
    };
    const partial = 'feat: рабочая копия\n\nКласс: XL\nДизайнер: PARTIAL\n';
    const unfinished = '⚠ Недоделано: визуальная приёмка и общий QA\n';
    assert.equal(run(partial + unfinished).status, 1);
    git('symbolic-ref', 'HEAD', 'refs/heads/codex/wip-test');
    assert.equal(run(partial).status, 1);
    const accepted = run(partial + unfinished);
    assert.equal(accepted.status, 0, accepted.stderr + accepted.stdout);
    assert.equal(run('feat: готово\n\nКласс: XL\nДизайнер: принято\n').status, 0);
    assert.equal(run('feat: нет класса\n\nДизайнер: PARTIAL\n' + unfinished).status, 1);
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\') || resolve(dir).startsWith(resolve(tmpdir()) + '/'));
    rmSync(dir, {recursive: true, force: true});
  }
});
