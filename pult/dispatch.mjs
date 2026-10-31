// Как кнопка превращается в запуск программы. Чистые функции: ничего не запускают, проверяются без сети.
// Запуск идёт без shell с готовым списком аргументов: строка из браузера в командную строку не попадает.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBash } from '../tools/dc.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Без этого скрипта на кнопке «план» запишет данные: запись выдаёт только флаг --apply.
const APPLY_FLAG = /--apply/;
// Удаление таблиц на кнопки не выносится даже с подтверждением.
const NEVER_ON_BUTTON = /^drop-/;

/** Скрипты backend/scripts с режимом плана: только они есть в выпадающем списке. */
export function listProdScripts(root = ROOT) {
  const dir = path.join(root, 'backend', 'scripts');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && !f.includes('.test.'))
    .map((f) => f.slice(0, -3))
    .filter((n) => !NEVER_ON_BUTTON.test(n) && APPLY_FLAG.test(fs.readFileSync(path.join(dir, `${n}.js`), 'utf8')))
    .sort();
}

/** Что есть на этом ПК: от этого зависят доступность кнопок и способ входа на сервер. */
export function detectMachine(home = os.homedir()) {
  const bash = findBash();
  const has = (f) => fs.existsSync(path.join(home, '.ssh', f));
  const sshConfig = fs.existsSync(path.join(home, '.ssh', 'config'))
    ? fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8') : '';
  const docker = (spawnSync('where', ['docker'], { encoding: 'utf8' }).stdout || '').trim().split(/\r?\n/)[0] || null;
  return {
    bash,
    gitRoot: bash ? path.dirname(path.dirname(bash)) : null,
    docker,
    route: has('datacore_work') && /^Host datacore-vm\s*$/m.test(sshConfig) ? 'work' : has('kppdf80-vm') ? 'home' : null,
    home,
  };
}

export const ROUTE_LABEL = { work: 'через VPS', home: 'по домашней сети' };

/** Какие требования команды не выполнены на этом ПК: [] — кнопка работает. */
export function missingNeeds(cmd, m) {
  const out = [];
  for (const n of cmd.needs || []) {
    if (n === 'bash' && !m.bash) out.push('Нет Git Bash: поставьте Git для Windows');
    if (n === 'docker' && !m.docker) out.push('Нет Docker: поставьте Docker Desktop');
    if (n === 'vm' && !m.route) out.push('Нет ключа входа на сервер: «Настройка ПК → Подготовить рабочий ПК»');
  }
  return out;
}

/** Проверка параметров из браузера: допускается только значение из списка. Итог — { значения } или бросок. */
export function validateParams(cmd, given = {}, scripts = []) {
  const known = cmd.params || [];
  for (const k of Object.keys(given)) {
    if (!known.some((p) => p.name === k)) throw new Error(`Лишний параметр: ${k}`);
  }
  const values = {};
  for (const p of known) {
    const v = given[p.name] ?? p.default;
    const allowed = p.from === 'prodScripts' ? scripts : p.options.map((o) => o.value);
    if (!allowed.includes(v)) throw new Error(`Недопустимое значение параметра «${p.label}»`);
    values[p.name] = v;
  }
  return values;
}

const fill = (s, values) => s.replace(/\{(\w+)\}/g, (_, k) => {
  if (!(k in values)) throw new Error(`Нет параметра ${k}`);
  return values[k];
});

function sshArgs(m) {
  const base = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
  if (m.route === 'work') return [...base, 'datacore-vm'];
  return [...base, '-i', path.join(m.home, '.ssh', 'kppdf80-vm'), 'tiit@192.168.1.52'];
}

/** Запись каталога + значения → { file, args, cwd } либо { open } / { folder }. */
export function buildRun(cmd, values, m, root = ROOT) {
  const run = cmd.run;
  const cwd = run.cwd ? path.join(root, run.cwd) : root;
  const a = (list) => list.map((x) => fill(x, values));
  if (run.open) return { open: run.open };
  if (run.folder) return { folder: path.join(root, run.folder) };
  if (run.node) return { file: process.execPath, args: a(run.node), cwd };
  if (run.bash) return { file: m.bash, args: a(run.bash), cwd };
  if (run.deploy) {
    const script = m.route === 'work' ? 'remote-access/deploy.sh' : 'deploy/synology/release.sh';
    return { file: m.bash, args: [script, ...a(run.deploy)], cwd };
  }
  if (run.vm) {
    const ssh = m.gitRoot ? path.join(m.gitRoot, 'usr', 'bin', 'ssh.exe') : 'ssh';
    return { file: ssh, args: [...sshArgs(m), fill(run.vm, values)], cwd };
  }
  if (run.git) return { file: 'git', args: ['-c', 'core.quotepath=false', ...a(run.git)], cwd };
  if (run.docker) return { file: 'docker', args: a(run.docker), cwd };
  if (run.npx) return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', 'npx', ...a(run.npx)], cwd };
  if (run.cmd) return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', ...a(run.cmd)], cwd };
  if (run.powershell) return { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ...a(run.powershell)], cwd };
  throw new Error(`Неизвестный способ запуска: ${cmd.id}`);
}

/** Окружение запуска: Git Bash раньше System32 (иначе bash — это WSL), без цвета и без вопросов в консоль. */
export function childEnv(m, base = process.env) {
  const extra = m.gitRoot ? [path.join(m.gitRoot, 'bin'), path.join(m.gitRoot, 'usr', 'bin'), path.join(m.gitRoot, 'mingw64', 'bin')] : [];
  const key = Object.keys(base).find((k) => k.toLowerCase() === 'path') || 'Path';
  return {
    ...base,
    [key]: [...extra, base[key] || ''].join(path.delimiter),
    NO_COLOR: '1', FORCE_COLOR: '0', GIT_TERMINAL_PROMPT: '0', LANG: 'C.UTF-8', PYTHONUTF8: '1',
  };
}

const SECRET_PATTERNS = [
  [/kppd_[A-Za-z0-9_-]+/g, 'kppd_***'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '***jwt***'],
  [/(Bearer\s+)\S+/gi, '$1***'],
  [/(mongodb(?:\+srv)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1***@'],
  [/\b([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY)[A-Z0-9_]*\s*[=:]\s*)\S+/gi, '$1***'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***ключ***'],
];

/** Пароли и ключи не показываются и не пишутся в журнал, даже если скрипт их напечатал. */
export function maskSecrets(text) {
  return SECRET_PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function cleanLine(s) {
  return maskSecrets(s.replace(ANSI, ''));
}

/** Подсказки к выводу: первые совпадения, без повторов. */
export function adviceFor(text, advice) {
  return advice.filter((a) => text.includes(a.match)).map((a) => a.say);
}
