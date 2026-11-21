import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const registry = 'docs/roles/ownership.json';
const script = 'backend/scripts/review-scope.mjs';
const backend = 'backend/src/modules/sample/engine.js';
const doc = 'docs/crew/заметка с пробелом.md';
const verdict = 'PASS проверены файлы и права';
const ownership = resolve(source, '..', '..', registry);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'datacore-review-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/.test(key)) delete env[key];
  const run = (cmd, args, expected = 0) => {
    const result = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr || result.stdout || String(result.error));
    return result.stdout + result.stderr;
  };
  const git = (...args) => run('git', args).trim();
  const cli = (mode, value, expected) => run(process.execPath, [script, 'owners', mode, ...[value].flat().filter(Boolean)], expected);
  const write = (file, text) => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  };
  const copy = (from, to) => {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    copyFileSync(from, join(dir, to));
  };
  const marks = (against) => Object.fromEntries([...cli('--staged', against ? ['--against', against] : null)
    .matchAll(/^Проверка зоны: (\S+ \S+) ([0-9a-f]{64}) PASS /gm)].map(([, key, digest]) => [key, digest]));
  const message = (title, stamps = marks(), ending = verdict, extra = '') => write('message.txt', title + '\n\n' + extra +
    Object.entries(stamps).map(([key, digest]) => 'Проверка зоны: ' + key + ' ' + digest + ' ' + ending).join('\n') + '\n');
  const commit = (title, stamps, ending) => {
    message(title, stamps, ending);
    git('commit', '--no-verify', '-F', 'message.txt');
    return git('rev-parse', 'HEAD');
  };
  t.after(() => {
    const subpath = relative(resolve(tmpdir()), resolve(dir));
    assert.ok(subpath.startsWith('datacore-review-') && !subpath.includes('/') && !subpath.includes('\\'));
    rmSync(dir, { recursive: true, force: true });
  });

  git('init', '-b', 'main');
  git('config', 'core.hooksPath', join(dir, 'no-hooks'));
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.quotePath', 'true');
  copy(join(source, 'review-scope.mjs'), script);
  write(backend, 'base\n');
  write(doc, 'base\n');
  git('add', '--', backend, doc);
  const legacy = commit('До введения реестра', {});
  copy(ownership, registry);
  for (const role of ['architect', 'analyst', 'backend', 'data-steward', 'designer', 'frontend', 'qa']) {
    write('.claude/agents/datacore-' + role + '.md', 'fixture\n');
    write('.codex/agents/datacore-' + role + '.toml', 'name = "fixture"\n');
  }
  git('add', '--', registry, script, '.claude', '.codex');
  return { git, run, cli, write, message, commit, marks, legacy };
}

test('реестр в индексе, независимые владелец и архитектор, ранняя история', t => {
  const f = fixture(t);
  assert.match(f.cli('--verify-commit', f.legacy), /до введения реестра/);
  f.write('not-staged.txt', 'только намерение добавить\n');
  f.git('add', '-N', '--', 'not-staged.txt');
  const current = f.marks();
  assert.deepEqual(Object.keys(current).sort(), ['governance architect', 'governance coordinator']);
  f.message('Только владелец', { 'governance coordinator': current['governance coordinator'] });
  assert.match(f.cli('--verify-message', 'message.txt', 1), /governance architect/);
  f.message('Без явного результата', current, 'проверены файлы и права');
  assert.match(f.cli('--verify-message', 'message.txt', 1), /Не распознана строка/);
  f.message('Пустой итог', current, 'PASS <итог проверки или ссылка>');
  assert.match(f.cli('--verify-message', 'message.txt', 1), /Нужен актуальный итог/);
  f.message('Обе квитанции', current);
  f.cli('--verify-message', 'message.txt');
  const first = f.commit('Введение реестра', current);
  assert.match(f.cli('--verify-commit', first), /подтверждения зон проверены/);
  f.git('rm', '--', registry);
  assert.match(f.cli('--staged', undefined, 1), /Реестр отсутствует в индексе/);
  const deleted = f.commit('Удаление реестра', {});
  assert.match(f.cli('--verify-commit', deleted, 1), /Удалён обязательный реестр/);
});

test('FAIL всегда отклоняется, PARTIAL сохраняется только в явном WIP и блокирует выпуск', t => {
  const f = fixture(t);
  const start = f.commit('Реестр');
  f.write(backend, 'изменение\n');
  f.git('add', '--', backend);
  const current = f.marks();
  const partial = 'PARTIAL осталось проверить права';
  const todo = '⚠ Недоделано: проверка прав\n';
  f.message('Незавершённый main', current, partial, todo);
  assert.match(f.cli('--verify-message', 'message.txt', 1), /только в codex\/wip-/);
  f.git('switch', '-c', 'codex/wip-scope');
  f.message('Нет явного остатка', current, partial);
  f.cli('--verify-message', 'message.txt', 1);
  f.message('Провал', current, 'FAIL проверка прав провалена', todo);
  assert.match(f.cli('--verify-message', 'message.txt', 1), /FAIL: backend backend/);
  f.message('Незавершённая ветка', current, partial, todo);
  f.cli('--verify-message', 'message.txt');
  f.git('commit', '--no-verify', '-F', 'message.txt');
  const wip = f.git('rev-parse', 'HEAD');
  assert.match(f.cli('--verify-range', start + '..' + wip, 1), /PARTIAL допустим только/);
});

test('смена каталога и владельца назначает D по прежнему реестру, A/M по текущему', t => {
  const f = fixture(t);
  const before = f.commit('Реестр');
  const newFile = 'handover/новый владелец.md';
  f.write('docs/crew/осталась.md', 'до смены владельца\n');
  f.git('add', '--', 'docs/crew/осталась.md');
  f.commit('Вторая заметка');
  const rules = JSON.parse(readFileSync(ownership, 'utf8'));
  const docs = rules.zones.find(zone => zone.id === 'docs');
  docs.owner = 'analyst';
  docs.exclude.push(doc);
  rules.zones.push({ id: 'handover', owner: 'qa', paths: ['handover/**'] });
  f.write(registry, JSON.stringify(rules));
  f.write('docs/crew/осталась.md', 'после смены владельца\n');
  f.write(newFile, 'новый каталог\n');
  f.git('rm', '--', doc);
  f.git('add', '--', registry, 'docs/crew/осталась.md', newFile);
  const output = f.cli('--staged');
  assert.match(output, /Владелец: docs coordinator · 1\n  D docs\/crew\/заметка с пробелом\.md/u);
  assert.match(output, /Владелец: docs analyst · 1\n  M docs\/crew\/осталась\.md/u);
  assert.match(output, /Владелец: handover qa · 1\n  A handover\/новый владелец\.md/u);
  const after = f.commit('Перенос каталога и новая зона');
  f.cli('--verify-range', before + '..' + after);
});

test('amend проверяет указанную базу, выпуск сверяет её с реальным родителем', t => {
  const f = fixture(t);
  const originalParent = f.commit('Реестр');
  f.write(backend, 'изменение\n');
  f.git('add', '--', backend);
  f.commit('Изменение до amend');
  f.write(backend, 'изменение после amend\n');
  f.git('add', '--', backend);
  const output = f.cli('--staged', ['--against', 'HEAD^']);
  assert.match(output, new RegExp('База проверки зон: ' + originalParent));
  const stamps = f.marks('HEAD^');
  const base = 'База проверки зон: ' + originalParent + '\n';
  assert.notEqual(stamps['backend backend'], f.marks()['backend backend']);
  f.message('Недопустимая база', stamps, verdict, 'База проверки зон: ' + f.legacy + '\n');
  assert.match(f.cli('--verify-message', 'message.txt', 1), /должна быть HEAD/);
  f.message('Поправка к коммиту', stamps, verdict, base);
  f.cli('--verify-message', 'message.txt');
  f.git('commit', '--amend', '--no-verify', '-F', 'message.txt');
  f.cli('--verify-commit', 'HEAD');

  f.write(backend, 'новый коммит после amend\n');
  f.git('add', '--', backend);
  f.message('Ошибочно указан родитель для обычного коммита', f.marks('HEAD^'), verdict, base);
  f.cli('--verify-message', 'message.txt');
  f.git('commit', '--no-verify', '-F', 'message.txt');
  assert.match(f.cli('--verify-commit', 'HEAD', 1), /не совпадает с первым родителем/);
});

test('профили назначенных ролей обязательны, документы дизайн-канона проверяет дизайнер', t => {
  const f = fixture(t);
  const head = f.commit('Реестр');
  f.cli('--all');
  f.write('docs/DESIGN.md', 'правила дизайна\n');
  f.write('docs/DESIGN-MOBILE.md', 'правила мобильного дизайна\n');
  f.git('add', '--', 'docs/DESIGN.md', 'docs/DESIGN-MOBILE.md');
  assert.match(f.cli('--staged'), /Обязательный проверяющий: frontend designer · 2/);
  f.commit('Правила дизайна');
  f.git('rm', '--', '.codex/agents/datacore-designer.toml');
  assert.match(f.cli('--all', null, 1), /\.codex\/agents\/datacore-designer\.toml/);
  assert.match(f.cli('--staged', null, 1), /требуется профиль/);
  const invalid = f.commit('Удаление профиля', {});
  assert.match(f.cli('--verify-range', head + '..' + invalid, 1), /требуется профиль/);
});

test('слияние старой ветки не может скрыть исчезновение уже введённого реестра', t => {
  const f = fixture(t);
  f.commit('Введён реестр');
  f.git('checkout', '-b', 'legacy-merge', f.legacy);
  f.git('merge', '--no-ff', '-s', 'ours', '-m', 'Старый снимок без реестра', 'main');
  f.write(script, readFileSync(join(source, 'review-scope.mjs'), 'utf8'));
  assert.match(f.cli('--verify-commit', 'HEAD', 1), /Удалён обязательный реестр/);
  assert.match(f.cli('--staged', null, 1), /Реестр отсутствует в индексе/);
});

test('точная дельта A/M/D и переименования, режим файла и частичный index', t => {
  const f = fixture(t);
  const start = f.commit('Введение реестра');
  const old = doc;
  const target = 'backend/src/modules/sample/новое имя.md';
  const common = 'backend/src/common/scope.ts';
  f.git('mv', '--', old, target);
  f.git('rm', '--', backend);
  f.write(common, '// staged\n');
  f.git('add', '--', common);
  const output = f.cli('--staged');
  assert.match(output, /D docs\/crew\/заметка с пробелом\.md/u);
  assert.match(output, /A backend\/src\/modules\/sample\/новое имя\.md/u);
  assert.match(output, /D backend\/src\/modules\/sample\/engine\.js/);
  assert.match(output, /Обязательный проверяющий: backend architect · 1/);

  const stamps = f.marks();
  f.write(common, '// unstaged\n');
  assert.deepEqual(f.marks(), stamps);
  f.write('docs/crew/другая.md', 'another area\n');
  f.git('add', '--', 'docs/crew/другая.md');
  const docsChanged = f.marks();
  assert.equal(docsChanged['backend backend'], stamps['backend backend']);
  assert.notEqual(docsChanged['docs coordinator'], stamps['docs coordinator']);
  f.git('update-index', '--chmod=+x', target);
  const modeChanged = f.marks();
  assert.notEqual(modeChanged['backend backend'], docsChanged['backend backend']);
  assert.equal(modeChanged['backend architect'], docsChanged['backend architect']);
  f.message('Устаревший итог', docsChanged);
  assert.match(f.cli('--verify-message', 'message.txt', 1), /backend backend/);
  assert.doesNotMatch(f.cli('--verify-message', 'message.txt', 1), /backend architect/);

  const good = f.commit('Переименование и режим', modeChanged);
  f.cli('--verify-commit', good);
  f.write(target, 'updated\n');
  f.git('add', '--', target);
  assert.match(f.cli('--staged'), /M backend\/src\/modules\/sample\/новое имя\.md/u);
  const bad = f.commit('Пропущена проверка', {});
  assert.match(f.cli('--verify-range', start + '..' + good), /Проверено коммитов: 1/);
  assert.match(f.cli('--verify-range', start + '..' + bad, 1), new RegExp(bad.slice(0, 12)));
  f.write('new-unowned.txt', 'new root file\n');
  f.git('add', '--', 'new-unowned.txt');
  assert.match(f.cli('--staged', undefined, 1), /Нет владельца: new-unowned\.txt/);
});

test('merge с разрешённым конфликтом получает собственный отпечаток от первого родителя', t => {
  const f = fixture(t);
  const start = f.commit('Реестр');
  f.git('branch', 'side');
  f.write(backend, 'main\n');
  f.git('add', '--', backend);
  const main = f.commit('main');
  f.git('switch', 'side');
  f.write(backend, 'side\n');
  f.git('add', '--', backend);
  const sideStamps = f.marks();
  f.commit('side', sideStamps);
  f.git('switch', 'main');
  f.run('git', ['merge', '--no-commit', '--no-ff', 'side'], 1);
  f.write(backend, 'resolved\n');
  f.git('add', '--', backend);
  assert.match(f.cli('--staged', ['--against', 'HEAD^'], 1), /вне слияния/);
  const mergeStamps = f.marks();
  assert.notEqual(mergeStamps['backend backend'], sideStamps['backend backend']);
  f.message('Merge: старый итог', sideStamps);
  assert.match(f.cli('--verify-message', 'message.txt', 1), /backend backend/);
  const merge = f.commit('Merge: конфликт разрешён', mergeStamps);
  assert.equal(f.git('rev-parse', 'HEAD^1'), main);
  assert.match(f.cli('--commit', merge), /M backend\/src\/modules\/sample\/engine\.js/);
  assert.match(f.cli('--verify-range', start + '..' + merge), /Проверено коммитов: 3/);
});
