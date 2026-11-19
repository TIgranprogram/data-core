import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('падение PWA сохраняет полный журнал и имя теста даже после удаления временного вывода', () => {
  const source = readFileSync(new URL('../deploy/synology/preflight.sh', import.meta.url), 'utf8');
  const handler = source.match(/^pwa_tests_failed\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(handler);
  const base = path.resolve(os.tmpdir());
  const work = mkdtempSync(path.join(base, 'datacore-preflight-test-'));
  try {
    const content = 'not ok 1 - именованный тест\n  error: конкретная причина\n' + 'подробности\n'.repeat(120) + 'конец полного журнала\n';
    writeFileSync(path.join(work, 'failure.txt'), content);
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
    const script = `LOG=failure.txt\nstop() { echo "$1"; rm -f "$LOG"; return 1; }\n${handler}\npwa_tests_failed`;
    const result = spawnSync(bash, ['-c', script], { cwd: work, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /именованный тест/);
    assert.match(result.stdout, /конкретная причина/);
    assert.doesNotMatch(result.stdout, /нужен Node 20/);
    const logs = readdirSync(path.join(work, 'tools/logs'));
    assert.equal(logs.length, 1);
    assert.equal(readFileSync(path.join(work, 'tools/logs', logs[0]), 'utf8'), content);
    assert.equal(existsSync(path.join(work, 'failure.txt')), false);
  } finally {
    assert.ok(path.resolve(work).startsWith(base + path.sep + 'datacore-preflight-test-'));
    rmSync(work, { recursive: true, force: true });
  }
});
