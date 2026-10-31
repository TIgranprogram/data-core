// Каталог совпадает с проектом, опасные кнопки защищены, справка не отстала.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import * as catalog from '../catalog.mjs';
import { auditCatalog, auditProblems } from '../audit.mjs';
import { adviceFor, buildRun, childEnv, listProdScripts, maskSecrets, missingNeeds, validateParams } from '../dispatch.mjs';
import { DOC_FILE, renderDoc } from '../gen-docs.mjs';

const { COMMANDS, SECTIONS, RISKS, ADVICE } = catalog;
const work = { bash: 'C:\\Git\\bin\\bash.exe', gitRoot: 'C:\\Git', docker: 'docker', route: 'work', home: 'C:\\Users\\U' };

test('каталог совпадает со скриптами проекта', () => {
  assert.deepEqual(auditProblems(auditCatalog(catalog)), []);
});

test('справка собрана из текущего каталога', () => {
  const now = fs.readFileSync(DOC_FILE, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(now, renderDoc(), 'запустите: node pult/gen-docs.mjs');
});

test('записи каталога заполнены', () => {
  const ids = COMMANDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'повтор id');
  for (const c of COMMANDS) {
    assert.ok(c.title && c.hint && c.time, `${c.id}: нет title, hint или time`);
    assert.ok(RISKS[c.risk], `${c.id}: неизвестный risk`);
    assert.ok(SECTIONS.some((s) => s.id === c.section), `${c.id}: неизвестный раздел`);
  }
});

test('запись на сайт всегда с подтверждением, опасное — со словом', () => {
  for (const c of COMMANDS) {
    if (c.risk === 'prod-write' || c.risk === 'danger') assert.ok(c.confirm, `${c.id}: нет confirm`);
    if (c.risk === 'danger') assert.ok(c.word, `${c.id}: нет word`);
  }
});

test('выкладка и команды на сервере не помечены как чтение, кроме явного списка', () => {
  const readOnlyVm = new Set(['prod-containers', 'prod-disk', 'prod-log']);
  for (const c of COMMANDS) {
    if (c.run.deploy) assert.notEqual(c.risk, 'read', c.id);
    if (c.run.vm && c.risk === 'read') assert.ok(readOnlyVm.has(c.id), c.id);
    if (JSON.stringify(c.run).includes('--apply')) assert.equal(c.risk, 'danger', c.id);
  }
});

test('на кнопках нет --wipe, удаления таблиц и архива без пароля', () => {
  const all = JSON.stringify(COMMANDS.map((c) => c.run));
  for (const bad of ['--wipe', '--drop-archive', 'dropDatabase', 'make-kit', 'rm -rf']) assert.ok(!all.includes(bad), bad);
});

test('в списке скриптов только с режимом плана и без drop-', () => {
  const list = listProdScripts();
  assert.ok(list.length > 10);
  assert.ok(!list.some((n) => n.startsWith('drop-')));
  assert.ok(list.includes('fix-sport-passports'));
  assert.ok(!list.includes('mongo-create-appuser'), 'скрипт без --apply записал бы сразу');
});

test('параметр — только значение из списка', () => {
  const cmd = COMMANDS.find((c) => c.id === 'script-plan');
  assert.deepEqual(validateParams(cmd, { script: 'a' }, ['a']), { script: 'a' });
  assert.throws(() => validateParams(cmd, { script: 'a; rm -rf /' }, ['a']));
  assert.throws(() => validateParams(cmd, { script: 'a', extra: 1 }, ['a']));
  const log = COMMANDS.find((c) => c.id === 'prod-log');
  assert.deepEqual(validateParams(log, {}), { lines: '200' });
  assert.throws(() => validateParams(log, { lines: '1; reboot' }));
});

test('выкладка идёт по пути этого ПК', () => {
  const cmd = COMMANDS.find((c) => c.id === 'deploy-data');
  assert.deepEqual(buildRun(cmd, {}, work).args, ['remote-access/deploy.sh', '--data']);
  assert.deepEqual(buildRun(cmd, {}, { ...work, route: 'home' }).args, ['deploy/synology/release.sh', '--data']);
});

test('вход на сервер по способу этого ПК', () => {
  const cmd = COMMANDS.find((c) => c.id === 'prod-log');
  const atWork = buildRun(cmd, { lines: '100' }, work);
  assert.ok(atWork.file.endsWith('ssh.exe'));
  assert.equal(atWork.args.at(-2), 'datacore-vm');
  assert.equal(atWork.args.at(-1), 'docker logs --tail 100 datacore-backend 2>&1');
  assert.equal(buildRun(cmd, { lines: '100' }, { ...work, route: 'home' }).args.at(-2), 'tiit@192.168.1.52');
});

test('нет нужного на ПК — кнопка объясняет почему', () => {
  const cmd = COMMANDS.find((c) => c.id === 'deploy-release');
  assert.deepEqual(missingNeeds(cmd, work), []);
  assert.equal(missingNeeds(cmd, { ...work, bash: null, route: null }).length, 2);
});

test('Git Bash раньше System32 в PATH', () => {
  const env = childEnv(work, { Path: 'C:\\Windows\\System32' });
  assert.ok(env.Path.startsWith('C:\\Git\\bin;') || env.Path.startsWith('C:\\Git\\bin:'));
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});

test('секреты закрываются маской', () => {
  const cases = [
    ['ключ kppd_abc123DEF конец', 'ключ kppd_*** конец'],
    ['ADMIN_PASSWORD=qwerty', 'ADMIN_PASSWORD=***'],
    ['"cookie":"__Host-device=abc; b=c","x":1', '"cookie":***,"x":1'],
    ['set-cookie: sid=abc', 'set-cookie: ***'],
    ['Authorization: Bearer abc.def', 'Authorization: Bearer ***'],
    ['mongodb://root:s3cr3t@mongo:27017/x', 'mongodb://root:***@mongo:27017/x'],
    ['eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abcdefgh', '***jwt***'],
  ];
  for (const [src, want] of cases) assert.equal(maskSecrets(src), want);
  assert.equal(maskSecrets('обычная строка: версия 1.2'), 'обычная строка: версия 1.2');
});

test('подсказка к реальному отказу ворот', () => {
  const said = adviceFor('ВОРОТА: СТОП — есть незакоммиченные изменения в backend/deploy — сначала коммит', ADVICE);
  assert.equal(said.length, 1);
  assert.match(said[0], /Что изменено/);
});
