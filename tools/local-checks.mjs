// Единый ручной прогон. Никаких входов в API, чтения .env и запуска БД.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = path.join(ROOT, 'tools/logs/local-checks');
export function parseArgs(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (['--ready-only', '--last'].includes(args[i])) o[args[i].slice(2)] = true;
    else if (['--baseline', '--current', '--vision-input'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) o[args[i].slice(2)] = path.resolve(args[++i]);
    else throw new Error('Неизвестный или незаполненный параметр');
  }
  if (!!o.baseline !== !!o.current) throw new Error('Эталон и новый снимок задаются вместе');
  if ((o.last || o['ready-only']) && Object.keys(o).length > 1) throw new Error('Режим не совмещается с другими параметрами');
  return o;
}

export function totalStatus(rows) {
  return rows.some(r => r.status === 'FAIL') ? 'FAIL' : rows.some(r => r.status === 'SKIP') ? 'PARTIAL' : 'PASS';
}

// Тест с пропусками не считается полностью выполненным, даже при exit 0.
export function commandStatus(result) {
  if (result.timedOut || result.error || result.code !== 0) return 'FAIL';
  return /(?:#|ℹ) skipped [1-9]|# SKIP\b|\b[1-9]\d* skipped\b|пропущено:\s*[1-9]/i.test(result.output) ? 'SKIP' : 'PASS';
}

export function runCommand(command, args, { cwd = ROOT, timeoutMs = 60000 } = {}) {
  return new Promise(resolve => {
    let output = '', timedOut = false, error = false, finished = false;
    const child = spawn(command, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const append = data => { output = (output + data.toString()).slice(-2 * 1024 * 1024); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const done = code => { if (finished) return; finished = true; clearTimeout(timer); resolve({ code, output, timedOut, error }); };
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }, timeoutMs);
    child.on('error', () => { error = true; done(null); });
    child.on('close', done);
  });
}

export function plan(options = {}, exists = p => fs.existsSync(path.join(ROOT, p))) {
  const node = (id, title, args, extra = {}) => ({ id, title, command: process.execPath, args, ...extra });
  const steps = [
    node('node', 'Node.js', ['--version']),
    { id: 'git', title: 'Git', command: 'git', args: ['--version'] },
    { id: 'docker', title: 'Docker доступен (не требуется для тестов без БД)', command: 'docker', args: ['info', '--format', '{{.ServerVersion}}'], optional: true, timeoutMs: 15000 },
  ];
  const backend = exists('backend/node_modules/typescript/bin/tsc') && exists('backend/node_modules/jest/bin/jest.js');
  const design = ['playwright-core', 'axe-core', 'pixelmatch', 'pngjs'].every(p => exists(`tools/design-checks/node_modules/${p}/package.json`));
  steps.push({ id: 'dependencies', title: 'Зависимости сервера', status: backend ? 'PASS' : 'FAIL', detail: backend ? 'Установлены' : 'Нет локальных TypeScript/Jest; установите зависимости backend' });
  steps.push({ id: 'design-dependencies', title: 'Зависимости проверок вида', status: design ? 'PASS' : 'SKIP', detail: design ? 'Установлены' : 'Кнопка «Установить проверки дизайна»' });
  const edge = process.env.DESIGN_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  steps.push({ id: 'browser', title: 'Браузер для локальной фикстуры', status: edge && fs.existsSync(edge) ? 'PASS' : 'SKIP', detail: edge && fs.existsSync(edge) ? 'Найден' : 'Нужен Edge или DESIGN_BROWSER' });
  if (options['ready-only']) return steps;
  const be = path.join(ROOT, 'backend');
  steps.push(
    node('types', 'Типы сервера', ['node_modules/typescript/bin/tsc', '--noEmit'], { cwd: be, skip: !backend, timeoutMs: 180000 }),
    node('unit', 'Юнит-тесты сервера и PWA guards', ['node_modules/jest/bin/jest.js', '--silent', '--runInBand'], { cwd: be, skip: !backend, timeoutMs: 900000 }),
    node('imports', 'Синтаксис и импорты PWA/admin', ['backend/scripts/pwa-import-check.mjs']),
    node('design-lint', 'Правила дизайна', ['backend/scripts/design-lint.mjs']),
    node('cycles', 'Циклы модулей', ['backend/scripts/audit-cycles.js']),
    node('pult', 'Пульт', ['--test', ...fs.readdirSync(path.join(ROOT, 'pult/test')).filter(f => f.endsWith('.test.mjs')).map(f => `pult/test/${f}`)], { timeoutMs: 180000 }),
    node('tools', 'Инструменты проверок', ['--test', 'tools/local-checks.test.mjs', 'tools/site-audit.test.mjs', 'tools/ai-tester/vision-review.test.mjs'], { timeoutMs: 180000 }),
    node('pixels-tool', 'Инструмент сравнения PNG', ['--test', 'tools/design-checks/compare.test.mjs'], { skip: !design }),
    node('browser-fixture', 'HTML-фикстура: подписи, геометрия, axe (не сайт)', ['--test', 'tools/design-checks/browser.test.mjs'], { skip: !design || !edge || !fs.existsSync(edge) }),
    node('pixels', 'Сравнение явно выбранных снимков', ['tools/design-checks/compare.mjs', '--baseline', options.baseline || '', '--current', options.current || ''], { skip: !design || !options.baseline, reason: 'Нужны установленные проверки вида и явно выбранная пара снимков; эталоны автоматически не принимаются' }),
    node('vision', 'Локальная модель: гипотезы по снимкам', ['tools/ai-tester/vision-review.mjs', '--input', options['vision-input'] || '', '--limit', '3', '--timeout-seconds', '90'], { skip: !options['vision-input'], reason: 'Нет явно выбранных снимков; старый аудит автоматически не используется', timeoutMs: 300000 }),
    { id: 'live-ui', title: 'Сайт: обход, геометрия и axe на реальных данных', status: 'SKIP', detail: 'Нужен отдельный авторизованный обход изолированного стенда агентом доступа; фикстура не заменяет приёмку сайта' },
    { id: 'e2e', title: 'E2E с БД', status: 'SKIP', detail: 'Не запускаются: изоляция тестовой БД этим запуском не подтверждена' },
    { id: 'human', title: 'Приёмка дизайна человеком', status: 'SKIP', detail: 'Автоматические проверки и модель не заменяют визуальную приёмку' },
  );
  return steps;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  fs.mkdirSync(LOGS, { recursive: true });
  if (options.last) {
    const { runDir } = JSON.parse(fs.readFileSync(path.join(LOGS, 'last.json'), 'utf8'));
    const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
    console.log(`Последняя проверка: ${summary.status}\nОтчёт: ${path.join(runDir, 'REPORT.md')}`);
    return summary.status === 'PASS' ? 0 : summary.status === 'FAIL' ? 1 : 2;
  }
  const lock = path.join(LOGS, 'run.lock');
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    try { process.kill(pid, 0); } catch (e) {
      if (e.code === 'ESRCH') { fs.unlinkSync(lock); return main(args); }
    }
    throw new Error('Локальная проверка уже выполняется');
  }
  const runDir = path.join(LOGS, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  const rows = [];
  try {
    fs.mkdirSync(runDir);
    const startedAt = new Date().toISOString();
    const save = finished => {
      const summary = { startedAt, finished, status: finished ? totalStatus(rows) : 'RUNNING', rows };
      fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
      fs.writeFileSync(path.join(runDir, 'REPORT.md'), ['# Единая локальная проверка', '', `Начало: ${startedAt}; итог: ${summary.status}.`, '', 'PASS — этап выполнен; FAIL — ошибка/таймаут; SKIP — этап не выполнен полностью. PARTIAL — есть пропуски.', 'Это не разрешение на выкладку и не приёмка сайта. Облако и БД не используются.', '', '| Этап | Статус | Подробности |', '|--|--|--|', ...rows.map(r => `| ${r.title} | ${r.status} | ${r.detail || ''}${r.log ? ` ([журнал](${r.log}))` : ''} |`), ''].join('\n'));
      if (finished) fs.writeFileSync(path.join(LOGS, 'last.json'), JSON.stringify({ runDir }));
    };
    save(false);
    for (const step of plan(options)) {
      const at = Date.now();
      let row = { id: step.id, title: step.title, status: step.status, detail: step.detail };
      if (step.skip) Object.assign(row, { status: 'SKIP', detail: step.reason || 'Нет необходимых локальных зависимостей' });
      else if (step.command) {
        const result = await runCommand(step.command, step.args, step);
        let status = commandStatus(result);
        if (step.optional && status === 'FAIL') status = 'SKIP';
        if (step.id === 'cycles' && !/Взаимных пар модулей:\s*0\b/.test(result.output)) status = 'FAIL';
        row = { ...row, status, code: result.code, log: `${step.id}.log`, detail: result.timedOut ? 'Превышено время; процесс остановлен' : result.error ? 'Не удалось запустить' : status === 'SKIP' ? 'Недоступно или есть пропущенные тесты' : `Код ${result.code}` };
        fs.writeFileSync(path.join(runDir, row.log), result.output);
      }
      row.elapsedMs = Date.now() - at;
      rows.push(row); save(false);
      console.log(`${row.status}: ${row.title}`);
    }
    save(true);
    console.log(`Итог: ${totalStatus(rows)}\nОтчёт: ${path.join(runDir, 'REPORT.md')}`);
    return totalStatus(rows) === 'PASS' ? 0 : totalStatus(rows) === 'FAIL' ? 1 : 2;
  } finally { fs.unlinkSync(lock); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.message); process.exitCode = 2; });
