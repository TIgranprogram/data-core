// Сводка для Codex из готового ночного прогона. Только локальные файлы и Git.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = 'tools/.night/runs';
const OUTPUT = 'tools/logs/codex-handoff';
const RUN_ID = /^\d{4}-\d{2}-\d{2}_\d{6}$/;
const SHA = /^(?:[a-f0-9]{8}|[a-f0-9]{40})$/;
const FULL_SHA = /^[a-f0-9]{40}$/;
const MAX_SUMMARY_BYTES = 256 * 1024;
const HOUR = 60 * 60 * 1000;
const QUICK = ['tsc', 'unit', 'imports', 'eslint', 'design-lint'];
const FULL = [...QUICK, 'tools-unit', 'e2e', 'smoke', 'screen-walk', 'scenarios', 'stock-filters'];
const OWNERS = {
  tsc: 'backend', unit: 'backend / QA', imports: 'frontend', eslint: 'backend / архитектор',
  'design-lint': 'frontend / дизайнер', 'tools-unit': 'координатор инструментов', e2e: 'backend / QA',
  smoke: 'QA', 'screen-walk': 'frontend / QA', scenarios: 'frontend / QA', 'stock-filters': 'склад / QA',
  tool: 'координатор инструментов', cleanup: 'координатор инструментов',
};
const int = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const hash = s => createHash('sha256').update(s).digest('hex');

const git = (root, args) => spawnSync('git', ['--no-optional-locks', ...args], {
  cwd: root, windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
});

function gitState(root, testedCommit) {
  const head = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const status = git(root, ['status', '--porcelain', '--untracked-files=normal']);
  const current = head.status === 0 && FULL_SHA.test(head.stdout.trim()) ? head.stdout.trim() : null;
  const tested = testedCommit && git(root, ['rev-parse', '--verify', `${testedCommit}^{commit}`]);
  const resolved = tested?.status === 0 && FULL_SHA.test(tested.stdout.trim()) ? tested.stdout.trim() : null;
  return { current, resolved, dirty: status.status === 0 ? Boolean(status.stdout.trim()) : null };
}

/** Снимок утверждений из фиксированных полей. Произвольные строки из журнала сюда не попадают. */
function factsFromSummary(summary) {
  if (typeof summary?.date !== 'string' || typeof summary.commit !== 'string') return null;
  const start = Date.parse(summary?.date);
  if (!Number.isFinite(start) || new Date(start).toISOString() !== summary.date
    || !int(summary.durationMs, 24 * HOUR) || typeof summary.quick !== 'boolean'
    || (summary.commit !== '?' && !SHA.test(summary.commit))
    || !Array.isArray(summary.steps) || !int(summary.steps.length, 32) || !summary.steps.length) return null;
  const steps = [];
  for (const step of summary.steps) {
    if (!step || typeof step.step !== 'string' || !Object.hasOwn(OWNERS, step.step) || step.commit !== summary.commit
      || !(step.code === -1 || step.code === null || int(step.code, 0xffffffff)) || !int(step.ms, 24 * HOUR)
      || step.ok !== (step.code === 0) || (step.timedOut !== undefined && step.timedOut !== true)) return null;
    const match = typeof step.signature === 'string' && /^([a-z-]+):([a-f0-9]{8}|no-lines)$/.exec(step.signature);
    steps.push({ name: step.step, code: step.code, ok: step.ok, timedOut: step.timedOut === true,
      fingerprint: match && match[1] === step.step ? match[2] : null });
  }
  return { testedCommit: summary.commit === '?' ? null : summary.commit,
    start: summary.date, completed: start + summary.durationMs, durationMs: summary.durationMs, quick: summary.quick, steps };
}

function readLatest(root) {
  const runs = path.join(root, RUNS);
  if (!fs.existsSync(runs)) return { issue: 'Локальных ночных прогонов пока нет.' };
  if (fs.realpathSync(runs) !== runs) return { issue: 'Каталог прогонов перенаправлен.' };
  const id = fs.readdirSync(runs, { withFileTypes: true }).filter(entry => RUN_ID.test(entry.name))
    .map(entry => entry.name).sort().at(-1);
  if (!id) return { issue: 'Локальных ночных прогонов пока нет.' };
  const file = path.join(runs, id, 'summary.json');
  if (!fs.existsSync(file)) return { id, issue: 'У последнего прогона ещё нет итогового файла.' };
  if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) return { id, issue: 'Итоговый файл перенаправлен или недоступен.' };
  const fd = fs.openSync(file, 'r');
  try {
    if (fs.fstatSync(fd).size > MAX_SUMMARY_BYTES) return { id, issue: 'Размер итогового файла превышает допустимый.' };
    const data = Buffer.alloc(MAX_SUMMARY_BYTES + 1);
    const size = fs.readSync(fd, data, 0, data.length, 0);
    if (size > MAX_SUMMARY_BYTES) return { id, issue: 'Размер итогового файла превышает допустимый.' };
    let facts;
    try { facts = factsFromSummary(JSON.parse(data.subarray(0, size).toString('utf8'))); } catch { /* Иначе в отчёт попал бы текст ошибки разбора JSON. */ }
    return facts ? { id, facts } : { id, issue: 'Формат итогового файла не подтверждён.' };
  } finally {
    fs.closeSync(fd);
  }
}

function formatReport({ id, facts }, state, now) {
  const hits = new Map();
  for (const step of facts.steps.filter(step => !step.ok)) {
    const key = JSON.stringify(step);
    const hit = hits.get(key);
    if (hit) hit.count++;
    else hits.set(key, { ...step, count: 1 });
  }
  const missing = (facts.quick ? QUICK : FULL).filter(name => !facts.steps.some(step => step.name === name));
  const age = now - facts.completed;
  const reasons = [];
  if (!state.resolved || !state.current || state.dirty === null) reasons.push('SHA или состояние рабочей копии не удалось подтвердить');
  else if (state.resolved !== state.current) reasons.push('SHA прогона отличается от текущего HEAD');
  if (state.dirty) reasons.push('в рабочей копии есть незакоммиченные изменения');
  if (age > 36 * HOUR) reasons.push('прогон старше 36 часов');
  if (age < -5 * 60000) reasons.push('время завершения в будущем');
  if (missing.length) reasons.push('состав прогона неполный');
  const failures = facts.steps.filter(step => !step.ok).length;
  const body = [
    '## Факты', '',
    `- Источник: \`${RUNS}/${id}/summary.json\`.`,
    `- Запуск: ${facts.start}. Режим: ${facts.quick ? 'быстрый' : 'полный'}. Длительность: ${Math.round(facts.durationMs / 1000)} с.`,
    `- Проверяемый SHA: ${state.resolved || facts.testedCommit || 'не установлен'}. Текущий HEAD: ${state.current || 'не установлен'}.`,
    `- Этапов: ${facts.steps.length}. Успешных: ${facts.steps.length - failures}. Неуспешных: ${failures}. Групп сбоев: ${hits.size}.`,
    `- Применимость: ${reasons.length ? reasons.join(', ') : 'результат относится к текущему чистому HEAD'}.`,
    ...(missing.length ? [`- Отсутствующие этапы: ${missing.join(', ')}.`] : []),
    '', '## Разбор', '',
    ...(hits.size ? [...hits.values()].map(step => `- ${step.name}, код ${step.code ?? 'не получен'}${step.timedOut ? ', таймаут' : ''}, сигнатура ${step.fingerprint ?? 'не подтверждена'}, записей ${step.count}. Проверяет ${OWNERS[step.name]}.`)
      : ['- Сбоев в итоговом файле нет.']),
    ...(reasons.length ? ['- Для вывода о текущем дереве нужна подтверждённая проверка его версии.'] : []),
    ...(hits.size ? ['', '## Гипотезы', '', 'Совпадение сигнатур помогает сгруппировать записи. Причина сбоя требует адресного воспроизведения.'] : []),
  ].join('\n');
  const reportId = hash(body).slice(0, 16);
  return { reportId, report: `# Сводка для Codex ${reportId}\n\n${body}\n` };
}

export function runHandoff(root = ROOT, now = Date.now()) {
  const realRoot = fs.realpathSync(root);
  const latest = readLatest(realRoot);
  if (!latest.facts) return { issue: latest.issue };
  return formatReport(latest, gitState(realRoot, latest.facts.testedCommit), now);
}

export function persistHandoff(root, result) {
  const realRoot = fs.realpathSync(root);
  for (const folder of ['tools', 'tools/logs', OUTPUT]) {
    const dir = path.join(realRoot, folder);
    try { fs.mkdirSync(dir); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (fs.realpathSync(dir) !== dir || !fs.lstatSync(dir).isDirectory()) throw new Error('Каталог сводок перенаправлен.');
  }
  if (!/^[a-f0-9]{16}$/.test(result.reportId)) throw new Error('Недействительный номер сводки.');
  const rel = `${OUTPUT}/${result.reportId}.md`;
  const file = path.join(realRoot, rel);
  const tmp = path.join(path.dirname(file), randomUUID() + '.tmp');
  fs.writeFileSync(tmp, result.report, { flag: 'wx', mode: 0o600 });
  try {
    fs.linkSync(tmp, file);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size !== Buffer.byteLength(result.report) || fs.readFileSync(file, 'utf8') !== result.report) throw error;
  } finally {
    fs.unlinkSync(tmp);
  }
  return rel;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runHandoff();
    if (result.issue) { console.log(result.issue); process.exitCode = 1; }
    else { const rel = persistHandoff(ROOT, result); console.log(result.report + '\nЛокальный файл: ' + rel); }
  } catch {
    console.error('Не удалось собрать локальную сводку для Codex.');
    process.exitCode = 2;
  }
}
