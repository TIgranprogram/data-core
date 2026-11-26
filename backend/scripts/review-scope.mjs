// Проверка зон по точной дельте Git и просмотр прежних журналов архитектора/дизайнера.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = 'docs/roles/ownership.json';
const GATE_FILES = [REGISTRY, 'backend/scripts/review-scope.mjs', '.githooks/commit-msg', '.githooks/pre-commit', 'deploy/synology/preflight.sh'];
const PROJECT_GATE_FILES = ['.github/workflows/project-guard.yml', 'tools/project-guard.mjs'];
const GIT_OPTIONS = { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const ID = /^[a-z][a-z0-9-]*$/;
const MARKER = 'Проверка зоны:';
const BASE_MARKER = 'База проверки зон:';
const PROFILE = /^\.(claude|codex)\/agents\//;
const RAW = ['--raw', '-z', '--no-abbrev', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--ignore-submodules=none'];
const git = (...args) => UTF8.decode(execFileSync('git', ['--no-replace-objects', ...args], GIT_OPTIONS));
const nul = (str) => str.split('\0').slice(0, -1);
const display = (path) => /[\x00-\x1f\x7f]/.test(path) ? JSON.stringify(path) : path;

function maybeGit(...args) {
  try { return git(...args).trim(); }
  catch (e) {
    if (Number.isInteger(e.status)) return '';
    throw e;
  }
}

function revision(ref) {
  const hash = ref && maybeGit('rev-parse', '--verify', '--end-of-options', ref + '^{commit}');
  if (!hash) throw new Error('Не найден коммит: ' + ref);
  return hash;
}

function patterns(list, label) {
  if (!Array.isArray(list) || list.length === 0) throw new Error('Нет шаблонов: ' + label);
  return list.map((pattern) => {
    if (typeof pattern !== 'string') throw new Error('Некорректный шаблон: ' + label);
    const prefix = pattern.endsWith('/**');
    const path = prefix ? pattern.slice(0, -3) : pattern;
    if (!path || /[?*\[\]\\\x00-\x1f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Некорректный шаблон: ' + pattern);
    }
    return prefix ? (file) => file.startsWith(path + '/') : (file) => file === path;
  });
}

function loadRegistry(source, files = []) {
  const registry = JSON.parse(source);
  if (registry.version !== 1 || !Array.isArray(registry.zones) || registry.zones.length === 0) {
    throw new Error('Нужен реестр зон версии 1: ' + REGISTRY);
  }
  const ids = new Set();
  const zones = registry.zones.map(({ id, owner, paths, exclude, reviewers = [] }) => {
    if (typeof id !== 'string' || !ID.test(id) || typeof owner !== 'string' || !ID.test(owner) || ids.has(id)) {
      throw new Error('Неверное имя или повтор зоны/владельца: ' + id);
    }
    ids.add(id);
    const includes = patterns(paths, id);
    const excludes = exclude ? patterns(exclude, id + ' exclude') : [];
    const roles = new Set([owner]);
    const checks = reviewers.map(({ role, paths: reviewed, excludeSuffixes = [] }) => {
      if (typeof role !== 'string' || !ID.test(role) || roles.has(role)) throw new Error('Повтор или неверная роль: ' + id + ' ' + role);
      roles.add(role);
      const matches = patterns(reviewed, id + ' ' + role);
      if (!Array.isArray(excludeSuffixes) || excludeSuffixes.some(suffix => typeof suffix !== 'string' || !suffix.startsWith('.'))) {
        throw new Error('Неверные исключения суффиксов: ' + id + ' ' + role);
      }
      return { role, matches: (file) => matches.some(match => match(file)) && !excludeSuffixes.some(suffix => file.endsWith(suffix)) };
    });
    return { id, owner, checks, matches: (file) => includes.some(match => match(file)) && !excludes.some(match => match(file)) };
  });
  // Новые ворота требуют проверяющего с появления файла в индексе или проверяемом коммите.
  const present = new Set(files);
  for (const file of [...GATE_FILES, ...PROJECT_GATE_FILES.filter(path => present.has(path))]) {
    const zone = ownerOf(zones, file);
    if (!zone.checks.some(check => check.role === 'architect' && check.matches(file))) {
      throw new Error('Для ворот нужен отдельный проверяющий architect: ' + file);
    }
  }
  return zones;
}

function ownerOf(zones, path) {
  const owners = zones.filter(zone => zone.matches(path));
  if (owners.length !== 1) {
    const reason = owners.length ? 'Несколько владельцев (' + owners.map(zone => zone.id).join(', ') + ')' : 'Нет владельца';
    throw new Error(reason + ': ' + display(path));
  }
  return owners[0];
}

function entries(raw) {
  const fields = nul(raw);
  const records = [];
  for (let i = 0; i < fields.length; i += 2) {
    const [meta, path] = fields.slice(i, i + 2);
    const match = /^:\d{6} \d{6} [0-9a-f]+ [0-9a-f]+ ([AMDT])$/.exec(meta);
    if (!match || !path) throw new Error('Неподдерживаемая запись Git, проверьте индекс: ' + display(meta));
    records.push({ meta, path, status: match[1] });
  }
  return records.sort((a, b) => a.path < b.path ? -1 : Number(a.path > b.path));
}

function scope(zones, records, former = zones) {
  const grouped = new Map();
  function add(zone, role, owner, record) {
    const key = zone + ' ' + role;
    if (!grouped.has(key)) grouped.set(key, { key, owner, records: [] });
    grouped.get(key).records.push(record);
  }
  for (const record of records) {
    const zone = ownerOf(record.status === 'D' ? former : zones, record.path);
    add(zone.id, zone.owner, true, record);
    for (const check of zone.checks) {
      if (check.matches(record.path)) add(zone.id, check.role, false, record);
    }
  }
  return [...grouped.values()].sort((a, b) => Number(b.owner) - Number(a.owner)).map(({ key, owner, records: files }) => {
    const hash = createHash('sha256').update('data-core review-scope v1\0' + key + '\0');
    for (const { meta, path } of files) hash.update(meta + '\0' + path + '\0');
    return { key, owner, files, digest: hash.digest('hex') };
  });
}

function coverage(zones, files) {
  const totals = new Map();
  const errors = [];
  for (const path of files) {
    try {
      const { id } = ownerOf(zones, path);
      totals.set(id, (totals.get(id) || 0) + 1);
    } catch (e) { errors.push(e.message); }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return totals;
}

function checkProfiles(zones, files, { worktree = false } = {}) {
  const trackedFiles = new Set(files);
  const roles = new Set(zones.flatMap(({ owner, checks }) => [owner, ...checks.map(check => check.role)]));
  roles.delete('coordinator');
  const missing = [...roles].sort().flatMap(role =>
    ['.claude/agents/datacore-' + role + '.md', '.codex/agents/datacore-' + role + '.toml']
      .filter(path => !trackedFiles.has(path) || (worktree && !existsSync(join(ROOT, path)))));
  if (missing.length) throw new Error('Для назначенной роли требуется профиль:\n' + missing.join('\n'));
}

const tracked = () => [...new Set(nul(git('ls-files', '-z')))];
const treeFiles = (hash) => nul(git('ls-tree', '-r', '--name-only', '-z', hash));
const firstParent = (hash) => hash ? /^parent ([0-9a-f]+)$/m.exec(git('cat-file', 'commit', hash).split('\n\n', 1)[0])?.[1] ?? '' : '';

function registryInCommit(hash) {
  return hash && git('ls-tree', hash, '--', REGISTRY) ? git('show', hash + ':' + REGISTRY) : '';
}

function reviewScope(registry, priorRegistry, records, files) {
  const changedRegistry = records.some(({ path }) => path === REGISTRY);
  const checkTree = changedRegistry || records.some(({ path }) => PROFILE.test(path));
  const tree = checkTree ? files() : records.filter(({ status }) => status !== 'D').map(({ path }) => path);
  const zones = loadRegistry(registry, tree);
  if (checkTree) {
    if (changedRegistry) coverage(zones, tree);
    checkProfiles(zones, tree);
  }
  const former = registry !== priorRegistry && priorRegistry ? loadRegistry(priorRegistry) : zones;
  return scope(zones, records, former);
}

function commitScope(hash) {
  const registry = registryInCommit(hash);
  if (!registry) {
    if (git('log', '--full-history', '-1', '--format=%H', hash, '--', REGISTRY).trim()) throw new Error('Удалён обязательный реестр: ' + REGISTRY);
    return null;
  }
  const base = firstParent(hash);
  const raw = base ? git('diff', ...RAW, base, hash, '--') : git('diff-tree', '--root', '-r', '--no-commit-id', ...RAW, hash, '--');
  return { base, reviews: reviewScope(registry, registryInCommit(base), entries(raw), () => treeFiles(hash)) };
}

function stagedScope(head, base = head) {
  const stagedDiff = ['diff', '--cached', '--ita-invisible-in-index', ...RAW, ...(base ? [base] : []), '--'];
  const [registryChange] = entries(git(...stagedDiff, REGISTRY));
  const priorRegistry = registryInCommit(base);
  const registry = registryChange?.status === 'D' ? ''
    : registryChange ? git('show', ':' + REGISTRY) : priorRegistry;
  if (!registry) {
    if (registryChange) throw new Error('Реестр отсутствует в индексе или пуст: ' + REGISTRY);
    if (head && git('log', '--full-history', '-1', '--format=%H', head, '--', REGISTRY).trim()) throw new Error('Реестр отсутствует в индексе: ' + REGISTRY);
    return null;
  }
  const records = entries(git(...stagedDiff));
  return reviewScope(registry, priorRegistry, records, () => {
    const files = new Set(base ? treeFiles(base) : []);
    for (const { path, status } of records) {
      if (status === 'D') files.delete(path);
      else files.add(path);
    }
    return files;
  });
}

const expectedMarker = ({ key, digest }) => MARKER + ' ' + key + ' ' + digest + ' PASS <итог проверки или ссылка>';

function summary(result, base) {
  if (!result) { console.log('Реестр ещё не введён.'); return; }
  if (base) console.log(BASE_MARKER + ' ' + base);
  if (!result.length) { console.log('В выбранной дельте нет файлов.'); return; }
  for (const item of result) {
    const { key, owner, files } = item;
    console.log((owner ? 'Владелец: ' : 'Обязательный проверяющий: ') + key + ' · ' + files.length);
    for (const { path, status } of files) console.log('  ' + status + ' ' + display(path));
    console.log(expectedMarker(item));
  }
}

function meaningful(text) {
  if (/https?:\/\/[^\s<>]+|(?:^|[\s(\x60])(?:\.\/)?(?:docs|tools|backend)\/[^\s<>]+\.[\w-]+/u.test(text)) return true;
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  return !text.startsWith('<') && text.length >= 12 && words.length >= 2;
}

function messageBase(message) {
  const lines = message.split(/\r?\n/).filter(line => line.startsWith(BASE_MARKER));
  if (lines.length === 0) return '';
  const hash = /^База проверки зон: ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(lines[0])?.[1];
  if (lines.length !== 1 || !hash) throw new Error('Нужна одна строка «' + BASE_MARKER + ' <полный хэш>».');
  return hash;
}

function stagedBase(head, requested) {
  if (!requested || requested === head) return head;
  if (requested !== firstParent(head) || maybeGit('rev-parse', '--verify', 'MERGE_HEAD')) {
    throw new Error('База проверки должна быть HEAD, либо HEAD^ для amend вне слияния.');
  }
  return requested;
}

function verify(result, message, allowPartial = false) {
  if (!result) return;
  const receipts = new Map();
  for (const line of message.split(/\r?\n/)) {
    if (!line.startsWith(MARKER)) continue;
    const parsed = /^Проверка зоны: ([a-z][a-z0-9-]*) ([a-z][a-z0-9-]*) ([0-9a-f]{64}) (PASS|PARTIAL|FAIL) (.+)$/.exec(line);
    if (!parsed) throw new Error('Не распознана строка подтверждения: ' + line);
    const [, zone, role, digest, status, text] = parsed;
    const key = zone + ' ' + role;
    if (receipts.has(key)) throw new Error('Повтор подтверждения: ' + key);
    if (status === 'FAIL') throw new Error('Проверка завершилась FAIL: ' + key);
    if (status === 'PARTIAL' && !allowPartial) {
      throw new Error('PARTIAL допустим только в codex/wip-* со строкой «⚠ Недоделано: …»: ' + key);
    }
    receipts.set(key, { digest, text: text.trim() });
  }
  const missing = result.filter(({ key, digest }) => {
    const receipt = receipts.get(key);
    return receipt?.digest !== digest || !meaningful(receipt.text);
  });
  if (missing.length) {
    throw new Error('Нужен актуальный итог проверки:\n' + missing.map(expectedMarker).join('\n'));
  }
}

function verifyCommit(result, hash) {
  if (!result) return;
  const message = git('show', '-s', '--format=%B', hash);
  const markedBase = messageBase(message);
  if (markedBase && markedBase !== result.base) {
    throw new Error('База проверки не совпадает с первым родителем коммита: ' + (result.base || 'корневой коммит'));
  }
  verify(result.reviews, message);
}

function rangeCommits(range) {
  const parts = range?.split('..');
  if (parts?.length !== 2 || !parts.every(Boolean) || parts[1].startsWith('.')) throw new Error('Укажите диапазон FROM..TO');
  const first = revision(parts[0]);
  const last = revision(parts[1]);
  return git('rev-list', '--reverse', '--topo-order', first + '..' + last).trim().split('\n').filter(Boolean);
}

function runOwners(mode, value, extra) {
  const against = mode === '--staged' && value === '--against' && extra.length === 1 ? extra[0] : '';
  if (extra.length && !against) throw new Error('Лишние аргументы.');
  if (mode === '--all' && !value) {
    const files = tracked();
    const zones = loadRegistry(readFileSync(join(ROOT, REGISTRY), 'utf8'), files);
    const totals = coverage(zones, files);
    checkProfiles(zones, files, { worktree: true });
    for (const zone of zones) console.log(zone.id + ' · ' + zone.owner + ' · ' + (totals.get(zone.id) || 0));
    console.log('Назначен один владелец для всех файлов индекса: ' + files.length);
  } else if (mode === '--staged' && (!value || against)) {
    const head = maybeGit('rev-parse', '--verify', 'HEAD');
    const base = stagedBase(head, against && revision(against));
    summary(stagedScope(head, base), against && base);
  } else if (mode === '--verify-message' && value) {
    const head = maybeGit('rev-parse', '--verify', 'HEAD');
    const message = readFileSync(resolve(value), 'utf8');
    const base = stagedBase(head, messageBase(message));
    const wip = /^codex\/wip-.+/.test(maybeGit('symbolic-ref', '--quiet', '--short', 'HEAD')) && /^⚠ Недоделано: \S/m.test(message);
    verify(stagedScope(head, base), message, wip);
  } else if (mode === '--commit' && value) {
    summary(commitScope(revision(value))?.reviews);
  } else if (mode === '--verify-commit' && value) {
    const hash = revision(value);
    const result = commitScope(hash);
    verifyCommit(result, hash);
    console.log(hash.slice(0, 12) + (result ? ' · подтверждения зон проверены' : ' · до введения реестра'));
  } else if (mode === '--range' || mode === '--verify-range') {
    let verified = 0;
    let legacy = 0;
    for (const hash of rangeCommits(value)) {
      try {
        const result = commitScope(hash);
        if (mode === '--range') { console.log('\n' + git('show', '-s', '--format=%h %s', hash).trim()); summary(result?.reviews); }
        else if (result) { verifyCommit(result, hash); verified++; }
        else legacy++;
      } catch (e) { throw new Error(hash.slice(0, 12) + ': ' + e.message); }
    }
    if (mode === '--verify-range') console.log('Проверено коммитов: ' + verified + ' · до введения реестра: ' + legacy);
  } else {
    throw new Error('owners --all | --staged [--against HEAD^] | --commit HASH | --range FROM..TO | --verify-message FILE | --verify-commit HASH | --verify-range FROM..TO');
  }
}

const SCOPE = {
  architect: (file) => /^backend\/(src|pwa|admin|scripts|test)\//.test(file) || /^(docker-compose|deploy\/)/.test(file) || /^docs\/(ARCH-PLAN|ARCHITECTURE|MAP)\.md$/.test(file),
  designer: (file) => /^backend\/(pwa|admin)\//.test(file) && /\.(js|css|html)$/.test(file) || /^docs\/(DESIGN|CANON)\.md$/.test(file),
};

function legacy(agent, flag) {
  if (!Object.hasOwn(SCOPE, agent)) throw new Error('Неизвестный режим: ' + agent + ' (architect | designer | owners)');
  if (flag) throw new Error('Журнал прежних ролей доступен только для чтения. Для точной проверки: owners --staged или owners --commit HASH.');
  const ledgerPath = join(ROOT, '.claude', 'review', agent + '.json');
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { commit: null, files: {} };
  const head = git('rev-parse', '--short', 'HEAD').trim();
  const files = new Map(nul(git('ls-files', '--stage', '-z')).flatMap(line => {
    const match = /^\d{6} ([0-9a-f]+) 0\t([\s\S]+)$/.exec(line);
    return match ? [[match[2], match[1].slice(0, 12)]] : [];
  }));
  const since = ledger.commit && maybeGit('rev-parse', '--verify', '--end-of-options', ledger.commit + '^{commit}');
  const baseline = since && maybeGit('merge-base', since, 'HEAD') === since ? since : null;
  const groups = new Map();
  for (const [file, blob] of files) {
    if (!SCOPE[agent](file) || ledger.files[file] === blob) continue;
    const [, mod] = /^backend\/src\/modules\/([^/]+)/.exec(file) || [];
    const [, area] = /^backend\/(src\/common|pwa|admin|scripts|test)\//.exec(file) || [];
    const key = mod ? 'модуль ' + mod : area || 'прочее';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const removed = Object.keys(ledger.files).filter(file => !files.has(file));
  console.log('Агент: ' + agent + ' · прошлая проверка: ' + (ledger.commit || 'не было') + ' · сейчас: ' + head);
  if (baseline) console.log(git('log', '--format=%h %s', baseline + '..HEAD').trim());
  console.log('Изменённых файлов: ' + [...groups.values()].reduce((n, paths) => n + paths.length, 0) + ' · удалено: ' + removed.length);
  for (const [group, paths] of [...groups].sort()) console.log(group + ':\n' + paths.sort().map(file => '  ' + display(file)).join('\n'));
  for (const path of removed.sort()) console.log('  D ' + display(path));
  console.log('Автопроверки по области: TypeScript, тесты модуля, импорты PWA и pwa-guards.');
  console.log('Подтверждение точной версии: node backend/scripts/review-scope.mjs owners --staged');
}

try {
  const [agent = 'architect', flag, value, ...extra] = process.argv.slice(2);
  if (agent === 'owners') runOwners(flag, value, extra);
  else {
    if (extra.length || (value && flag !== '--baseline')) throw new Error('Лишние аргументы.');
    legacy(agent, flag);
  }
} catch (e) {
  console.error('Проверка зон: ' + (e.stderr?.toString().trim() || e.message));
  process.exitCode = 1;
}
