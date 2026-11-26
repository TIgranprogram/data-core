import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const bash = process.env.TEST_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const release = '0794ccce';
const current = { version: release, count: 2, users: 1, message: 'Сбой в новой версии', section: 'stock' };

function postCheckFixture(t) {
  const temp = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, 'dc-post-check-'));
  assert.equal(path.dirname(root), temp);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'deploy/synology');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'));
  for (const name of ['post-check.sh', 'client-errors-report.js', 'doctor.sh', 'doctor-report.js']) {
    fs.copyFileSync(new URL(name, import.meta.url), path.join(scripts, name));
  }
  fs.writeFileSync(path.join(root, 'bin/curl'), '#!/usr/bin/env bash\nif [[ "${!#}" == */api/health ]]; then printf "%s" "$MOCK_HEALTH"; else printf "%s" "$MOCK_VERSION"; fi\nexit "$MOCK_STATUS"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin/ssh'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(scripts, 'api.sh'), 'printf "%s\\n" "$@" >> api-args\nif [[ "$3" == */client-errors/top* && "$3" != *"&version="* ]]; then printf "%s" "$MOCK_ALL"; else printf "%s" "$MOCK_RESPONSE"; fi\nexit "$MOCK_API_STATUS"\n');
  const git = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);

  return {
    run({ response = { version: release, items: [] }, version = { v: release }, status = 0, apiStatus = 0, doctor = false } = {}) {
      return spawnSync(bash, ['-c', 'export PATH="$PWD/bin:$PATH"; exec bash "$@"', 'fixture',
        ...(doctor ? ['deploy/synology/doctor.sh'] : ['deploy/synology/post-check.sh', '2'])], {
        cwd: root, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, MOCK_VERSION: JSON.stringify(version, null, 2), MOCK_STATUS: String(status),
          MOCK_RESPONSE: JSON.stringify(response), MOCK_API_STATUS: String(apiStatus),
          MOCK_HEALTH: '{"status":"ok","info":{"backup":{"status":"up"}}}',
          MOCK_ALL: JSON.stringify({ items: [{ ...current, version: '6026b9fe' }] }) },
      });
    },
    requests() {
      const file = path.join(root, 'api-args');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/) : [];
    },
  };
}

test('отложенная проверка отправляет точную версию сайта и показывает найденные группы', (t) => {
  const fixture = postCheckFixture(t);
  const found = fixture.run({ response: { version: release, items: [current] } });
  assert.equal(found.status, 0, found.stderr + found.stdout);
  assert.deepEqual(fixture.requests(), ['prod', 'GET', `/api/client-errors/top?hours=2&version=${release}`]);
  assert.match(found.stdout, /2× 1 чел · stock · Сбой в новой версии/);
  assert.match(found.stdout, /ПОСЛЕ ВЫКЛАДКИ: 1 групп/);
  assert.match(fixture.run().stdout, /ПОСЛЕ ВЫКЛАДКИ: чисто/);
});

test('ответ прежнего API, неполная или смешанная выборка и сетевой отказ исключают отметку «чисто»', (t) => {
  const fixture = postCheckFixture(t);
  const inputs = [
    { response: { items: [] } }, { response: { version: release } },
    { response: { version: '6026b9fe', items: [] } },
    { response: { version: release, items: [{ ...current, version: release + '1' }] } },
    { apiStatus: 1 },
  ];
  for (const input of inputs) {
    const result = fixture.run(input);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.doesNotMatch(result.stdout, /чисто/);
  }
});

test('недоступная или длинная версия сайта не подменяется локальным SHA', (t) => {
  const fixture = postCheckFixture(t);
  for (const input of [{ version: {} }, { version: { v: 'ab12'.repeat(10) } }, { status: 22 }]) {
    const result = fixture.run(input);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /не удалось прочитать версию сайта/);
  }
  assert.deepEqual(fixture.requests(), []);
});

const doctor = (filtered, all) => spawnSync(process.execPath, [fileURLToPath(new URL('doctor-report.js', import.meta.url))], {
  encoding: 'utf8', timeout: 15000, input: JSON.stringify({ items: all }) + '\0' + JSON.stringify(filtered),
  env: { ...process.env, HEALTH: '{"status":"ok","info":{"backup":{"status":"up"}}}', VERSION: JSON.stringify({ v: release }),
    OFFSITE: '', BACKUPS: '', INTEGRITY: '', SLOW: '', CACHE: '', DRILL: '' },
});

test('doctor учитывает ошибку текущего выпуска даже при более новой записи старого клиента', (t) => {
  const fixture = postCheckFixture(t);
  const result = fixture.run({ doctor: true, response: { version: release, items: [current] } });
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.ok(fixture.requests().includes('/api/client-errors/top?hours=24'));
  assert.ok(fixture.requests().includes(`/api/client-errors/top?hours=24&version=${release}`));
  assert.match(result.stdout, /Ошибки в текущей версии: 1 групп/);
});

test('doctor отделяет подтверждённый ноль от неподтверждённой выборки и заполненного топа', () => {
  const empty = doctor({ version: release, items: [] }, []);
  assert.equal(empty.status, 0, empty.stderr + empty.stdout);
  assert.match(empty.stdout, /Ошибок текущей версии за сутки нет/);
  const old = doctor({ items: [] }, []);
  assert.match(old.stdout, /выборка недоступна/);
  assert.doesNotMatch(old.stdout, /Ошибок текущей версии за сутки нет/);
  const noise = Array.from({ length: 100 }, (_, index) => ({ ...current, name: 'SlowScreen', sig: String(index), sampleStack: 'x'.repeat(4000) }));
  const capped = doctor({ version: release, items: noise }, noise);
  assert.match(capped.stdout, /достигнут предел в 100 групп/);
  assert.doesNotMatch(capped.stdout, /Ошибок текущей версии за сутки нет/);
});
