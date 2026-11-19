import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { HEALTH_URL, checkoutState, latestStandBackup, prepareDevelopment, runAsync, standDevelopmentOwned } from './night.mjs';
import { DEVELOPMENT_PORTS, dockerEndpointProbe, localDockerEndpoint } from './night-owner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORK_APP = 'https://kppdf-crm.ru/db/app/';
export const DEVELOPMENT_APP = `http://localhost:${DEVELOPMENT_PORTS.apiPort}/app/`;
const VERSION_URL = new URL('version.json', WORK_APP).href;
const WORK_READY_URL = new URL('../api/health/ready', WORK_APP).href;
const DEVELOPMENT_METADATA_URL = new URL('/app/development.json', HEALTH_URL).href;
const SERVER_INPUTS = ['backend/src', 'backend/package.json', 'backend/Dockerfile', 'docker-compose.prod.yml'];
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' };
const shell = (file, args) => spawnSync(file, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 7000 });

function requireLocalDocker() {
  const { args, host } = dockerEndpointProbe();
  const result = args ? shell('docker', args) : { status: 0, stdout: host };
  if (result.status !== 0 || !localDockerEndpoint(result.stdout)) throw new Error('Для разработки нужен локальный Docker. Проверьте Docker Desktop или контекст Docker.');
}

async function jsonAt(url, fetchFn = fetch) {
  const response = await fetchFn(url, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(7000) });
  return response.ok ? response.json() : null;
}

async function ready() {
  try { return (await jsonAt(HEALTH_URL))?.status === 'ok'; } catch { return false; }
}

export async function confirmDevelopmentMetadata(expected, fetchFn = fetch) {
  try { return isDeepStrictEqual(await jsonAt(DEVELOPMENT_METADATA_URL, fetchFn), expected); } catch { return false; }
}

function openDevelopment() {
  const win = process.platform === 'win32';
  const mac = process.platform === 'darwin';
  const child = spawn(win ? 'explorer.exe' : mac ? 'open' : 'xdg-open', [DEVELOPMENT_APP], { detached: true, stdio: 'ignore', windowsHide: true });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    if (win) child.once('spawn', () => { child.unref(); resolve(); });
    else child.once('exit', (status) => status === 0 ? resolve() : reject(new Error('Браузер не открылся')));
  });
}

export async function startDevelopment({ say = console.log, prepare = prepareDevelopment, confirmReady = ready, confirmMetadata = confirmDevelopmentMetadata, open = openDevelopment, noOpen = false } = {}) {
  return prepare({ say, log() {} }, async (expected) => {
    if (!await confirmReady()) throw new Error('Локальная копия не прошла проверку API.');
    if (!await confirmMetadata(expected)) throw new Error('Локальное приложение не подтвердило копию данных и сборку разработки.');
    say(`Разработка готова: ${DEVELOPMENT_APP}`);
    if (!noOpen) {
      try { await open(); } catch { throw new Error(`Браузер не открылся. Адрес разработки: ${DEVELOPMENT_APP}`); }
    }
    return 0;
  });
}

function localComponentHead(paths) {
  const result = shell('git', ['log', '-1', '--format=%H', '--', ...paths]);
  return result.status === 0 ? result.stdout.trim() : '';
}

const versionPart = (value) => typeof value === 'string' && /^[a-f0-9]{4,64}$/.test(value);

export function componentVersion(label, remote, local) {
  if (!versionPart(remote)) return `${label}: версия сайта неизвестна`;
  if (!versionPart(local)) return `${label}: сайт ${remote}, версия в Git неизвестна`;
  const same = local.startsWith(remote);
  return `${label}: сайт ${remote}, Git ${local.slice(0, 12)} (${same ? 'совпадает' : 'различается'})`;
}

export async function checkConnections({ say = console.log, fetchFn = fetch, git = checkoutState, gitHead = localComponentHead, docker = checkDocker, localBackup = latestStandBackup, development = standDevelopmentOwned, confirmReady = ready, remote = checkGitRemote } = {}) {
  const [site, workApi, gitRemote] = await Promise.allSettled([
    jsonAt(VERSION_URL, fetchFn),
    jsonAt(WORK_READY_URL, fetchFn),
    remote(),
  ]);
  const version = site.status === 'fulfilled' ? site.value : null;
  const siteOk = versionPart(version?.v);
  const workApiOk = workApi.status === 'fulfilled' && workApi.value?.status === 'ok';
  say(siteOk ? `Рабочий сайт: публичная версия доступна${Number.isSafeInteger(version.n) && version.n > 0 ? `, сборка ${version.n}` : ''}.` : 'Рабочий сайт: публичная версия недоступна.');
  say(workApiOk ? 'Рабочий API: доступ к данным подтверждён.' : 'Рабочий API: доступ к данным не подтверждён.');
  if (siteOk) {
    say(componentVersion('Приложение', version.v, gitHead(['backend/pwa'])));
    say(componentVersion('Сервер', version.b, gitHead(SERVER_INPUTS)));
  }

  const state = git();
  if (state) {
    say(`Git: ${state.branch === '(detached)' ? 'отдельный HEAD' : state.branch || 'ветка неизвестна'}, ${state.head?.slice(0, 12) || 'коммитов нет'}, ${state.dirty ? 'есть локальные изменения' : 'папка чистая'}.`);
    const counts = state.ahead === null || state.behind === null ? '' : `, впереди ${state.ahead}, позади ${state.behind}`;
    say(state.upstream ? `Отслеживание по последним локальным сведениям: ${state.upstream}${counts}.` : 'Git: отслеживаемая ветка не настроена.');
  } else say('Git: не удалось прочитать состояние этой папки.');
  const remoteOk = gitRemote.status === 'fulfilled' && gitRemote.value === true;
  say(remoteOk ? 'Git: origin отвечает.' : 'Git: origin недоступен.');

  try {
    const backup = localBackup();
    say(backup ? `Последний архив на ПК: ${backup}.` : 'В папке копий на ПК нет архива.');
  } catch { say('Не удалось прочитать папку копий на ПК.'); }
  const dockerOk = docker();
  say(dockerOk ? 'Локальный Docker отвечает.' : 'Локальный Docker недоступен.');
  let developOk = false;
  if (dockerOk) {
    try {
      const data = development();
      developOk = await confirmReady();
      say(developOk ? 'Разработка: локальное API готово.' : 'Разработка: локальное API недоступно.');
      const describeTime = (value) => value ? value.replace('T', ' ') : 'дата неизвестна';
      say(`Копия разработки: ${data.backup || 'архив неизвестен'}, снимок ${describeTime(data.snapshotAt)}, восстановление ${describeTime(data.restoredAt)}.`);
    } catch (error) { say(`Разработка: ${error.message}`); }
  }
  return siteOk && workApiOk && state && remoteOk && dockerOk && developOk ? 0 : 1;
}

function checkDocker() {
  try {
    requireLocalDocker();
    return shell('docker', ['info', '--format', '{{.ServerVersion}}']).status === 0;
  } catch { return false; }
}

async function checkGitRemote() {
  return (await runAsync('git', ['ls-remote', '--exit-code', 'origin', 'HEAD'], { cwd: ROOT, env: gitEnv, timeoutMs: 12000 })).code === 0;
}

async function main(args) {
  if (args[0] === 'check' && args.length === 1) return checkConnections();
  if (args[0] === 'start' && (args.length === 1 || args.length === 2 && args[1] === '--no-open')) {
    requireLocalDocker();
    return startDevelopment({ noOpen: args[1] === '--no-open' });
  }
  throw new Error('Режимы: start [--no-open] или check.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
