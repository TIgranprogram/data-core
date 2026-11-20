import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const folderScript = fileURLToPath(new URL('./document-intake-folder.ps1', import.meta.url));
const production = 'https://kppdf-crm.ru/db/api';
const defaults = { root: '', apiBase: '', modelBase: 'http://127.0.0.1:1235/v1', model: '' };
const emptyCounts = { inbox: 0, processing: 0, ready: 0, question: 0 };
const importRoles = new Set(['manager', 'accountant', 'director', 'admin']);
const fail = (status, error) => ({ status, body: { error } });
const ok = (body, status = 200) => ({ status, body });
const asText = (value, limit = 1200) => typeof value === 'string' ? value.slice(0, limit) : '';
const asCount = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;

function localBase(value, suffix) {
  // Проверяем исходную строку до нормализации URL: путь, имя хоста и порт задаются явно.
  const match = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})(\/[a-z0-9]+)\/?$/i.exec(value);
  if (!match || match[3] !== suffix || Number(match[2]) < 1 || Number(match[2]) > 65535) return '';
  const host = match[1].toLowerCase() === 'localhost' ? '127.0.0.1' : match[1];
  return `http://${host}:${Number(match[2])}${suffix}`;
}

function serviceSettings({ apiBase, modelBase, model } = {}) {
  const api = asText(apiBase).trim().replace(/\/$/, '');
  const localModel = localBase(asText(modelBase).trim(), '/v1');
  const modelName = typeof model === 'string' ? model.trim() : '';
  if (api !== production && !localBase(api, '/api')) return fail(400, 'Укажите рабочий сайт или адрес локальной копии вида http://127.0.0.1:3001/api.');
  if (!localModel) return fail(400, 'Модель должна работать на этом ПК. Укажите адрес вида http://127.0.0.1:1235/v1.');
  if (!modelName || modelName.length > 160 || /[\x00-\x1f\x7f]/.test(modelName)) return fail(400, 'Введите название модели из LM Studio.');
  return ok({ apiBase: api === production ? production : localBase(api, '/api'), modelBase: localModel, model: modelName });
}

async function nativeFolder(mode, initialPath) {
  if (process.platform !== 'win32') throw new Error('Папку можно открыть в Пульте для Windows.');
  const args = ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', folderScript, '-Mode', mode];
  if (initialPath) args.push('-InitialPath', initialPath);
  const { stdout } = await exec('powershell.exe', args, { windowsHide: true, timeout: mode === 'Pick' ? 10 * 60_000 : 15_000 });
  const value = stdout.trim();
  return value ? Buffer.from(value, 'base64').toString('utf8') : '';
}

function counts(value) {
  return Object.fromEntries(Object.keys(emptyCounts).map((key) => [key, asCount(value?.[key])]));
}

function expiresAt(access) {
  try {
    const { exp } = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString('utf8'));
    if (Number.isFinite(exp)) return exp * 1000;
  } catch { /* срок по умолчанию совпадает с access-сессией API */ }
  return Date.now() + 15 * 60_000;
}

const errors = {
  AUTH: 'Войдите в учётную запись менеджера, затем нажмите «Возобновить».',
  ACTOR: 'Войдите под учётной записью, которой начали разбор, и нажмите «Возобновить».',
  MODEL_UNAVAILABLE: 'Запустите локальную модель в LM Studio, затем нажмите «Возобновить».',
  BUSY: 'Эту папку уже разбирает другой процесс. Дождитесь его завершения.',
  ABORTED: 'Разбор остановлен. Чтобы продолжить, нажмите «Возобновить».',
};

export function createDocumentIntake({ stateDir, changed, engine = () => import('../tools/document-intake/index.mjs'), fetchFn = fetch, pickFolder = (root) => nativeFolder('Pick', root), openFolder = (root) => nativeFolder('Open', root) }) {
  const file = path.join(stateDir, 'document-intake.json');
  const initialized = fs.readFile(file, 'utf8').then((raw) => {
    const saved = JSON.parse(raw);
    const services = serviceSettings(saved);
    settings = { ...defaults, ...(services.status === 200 ? services.body : {}), root: asText(saved.root, 32767) };
  }).catch(() => {});
  let settings = { ...defaults };
  let revision = 0;
  let auth = null;
  let active = null;
  let task = null;
  let pending = false;
  let progress = null;

  const busy = () => !!active || pending;
  const loggedIn = () => !!auth && auth.expiresAt > Date.now();
  const notify = () => changed?.();

  async function save(next) {
    await fs.mkdir(stateDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    if (settings.apiBase !== next.apiBase) auth = null;
    settings = next;
    revision++;
  }

  function publicProgress(value) {
    if (!value) return null;
    return {
      processed: asCount(value.processed), total: asCount(value.total), current: asText(value.current, 400),
      state: ['processing', 'ready', 'question', 'stopped', 'finished', 'stopping'].includes(value.state) ? value.state : 'processing',
      message: safeText(value.message),
    };
  }

  function safeText(value) {
    let text = typeof value === 'string' ? value : '';
    if (auth?.access) text = text.replaceAll(auth.access, '[скрыто]');
    return asText(text.replace(/\bBearer\s+[^\s,;]+/gi, '[скрыто]').replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[скрыто]'));
  }

  function safeStopped(value) {
    if (!value) return '';
    return errors[value.code] || [safeText(value.message), safeText(value.action)].filter(Boolean).join(' ')
      || 'Разбор приостановлен. Проверьте настройки и возобновите работу.';
  }

  async function view() {
    const { root } = settings;
    const snapshot = root ? await (await engine()).status({ root }).catch(() => null) : null;
    const running = !!active || !!snapshot?.running;
    return {
      settings, revision, signedIn: loggedIn(), busy: pending, running, canStop: !!active && !active.signal.aborted,
      counts: counts(snapshot?.counts),
      progress: progress || (snapshot?.running ? publicProgress({ state: 'processing', current: snapshot.current }) : null),
    };
  }

  async function report() {
    const { root } = settings;
    const result = root ? await (await engine()).report({ root }) : { counts: emptyCounts, items: [] };
    return {
      counts: counts(result.counts), stopped: safeStopped(result.stopped),
      items: result.items.map((item) => ({
        arrivalId: asText(item.arrivalId, 36), name: asText(item.name, 400), state: asText(item.state, 32), outcome: asText(item.outcome, 32),
        message: safeText(item.message), action: safeText(item.action),
      })),
    };
  }

  async function login({ username, password } = {}) {
    if (!settings.apiBase) return fail(409, 'Сначала сохраните адрес сайта или локальной копии.');
    if (typeof username !== 'string' || !username.trim() || username.length > 64 || typeof password !== 'string' || !password || password.length > 128) {
      return fail(400, 'Введите логин и пароль менеджера.');
    }
    auth = null;
    let response;
    try {
      response = await fetchFn(`${settings.apiBase}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, remember: false }), redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
    } catch { return fail(502, 'Сайт не отвечает по сохранённому адресу. Проверьте подключение и адрес.'); }
    if (response.status === 429) return fail(429, 'Слишком много попыток входа. Подождите минуту.');
    if (response.status === 401 || response.status === 403) return fail(401, 'Проверьте логин и пароль менеджера.');
    if (!response.ok) return fail(502, 'Сайт не подтвердил вход. Проверьте адрес в настройках.');
    const result = await response.json().catch(() => null);
    if (!result?.access || typeof result.access !== 'string') return fail(502, 'Сайт не подтвердил вход. Проверьте адрес в настройках.');
    const user = result.user;
    // Ответ входа содержит тот же профиль, что /auth/me. Маршруты импорта проверяют права повторно.
    if (!user?.isOwner && (!importRoles.has(user?.baseRole ?? user?.role) || user?.canMoney === false)) {
      return fail(403, 'Для разбора документов нужна учётная запись с правами менеджера и доступом к суммам.');
    }
    auth = { access: result.access, expiresAt: expiresAt(result.access) };
    return ok({ signedIn: loggedIn() });
  }

  function start(mode, arrivalIds) {
    if (!settings.root) return fail(409, 'Сначала выберите папку документов.');
    if (!settings.apiBase || !settings.model) return fail(409, 'Сначала сохраните адрес сайта и настройки локальной модели.');
    if (!loggedIn()) return fail(401, 'Войдите в учётную запись менеджера.');
    const { root, apiBase, modelBase, model } = settings;
    const token = auth.access;
    const controller = new AbortController();
    active = controller;
    progress = publicProgress({ state: 'processing', message: 'Проверяем входящие документы…' });
    notify();
    const onProgress = (update) => {
      if (!controller.signal.aborted) progress = publicProgress(update);
      notify();
    };
    task = Promise.resolve().then(engine).then((intake) => {
      controller.signal.throwIfAborted();
      return intake[mode]({ root, apiBase, token, modelBase, model, onProgress, signal: controller.signal, ...(arrivalIds ? { arrivalIds } : {}) });
    })
      .then((result) => {
        if (result?.stopped?.code === 'AUTH') auth = null;
        const message = safeStopped(result?.stopped);
        progress = publicProgress({ ...progress, state: message || controller.signal.aborted ? 'stopped' : 'finished', current: '', message: message || (controller.signal.aborted ? errors.ABORTED : '') });
      }).catch((err) => {
        if (err.code === 'AUTH') auth = null;
        const message = controller.signal.aborted ? errors.ABORTED : errors[err.code] || 'Не удалось продолжить разбор. Проверьте доступ к папке, сайту и локальной модели.';
        progress = publicProgress({ ...progress, state: 'stopped', message });
      }).finally(() => { active = null; task = null; notify(); });
    return ok({ accepted: true }, 202);
  }

  async function route(method, action, readBody) {
    await initialized;
    if (method === 'GET' && action === 'status') return ok(await view());
    if (method === 'GET' && action === 'report') return ok(await report());
    if (method !== 'POST') return fail(404, 'Нет такого действия.');
    if (action === 'stop') {
      if (!active) return fail(409, 'Разбор уже завершён или запущен из другого процесса.');
      active.abort();
      progress = publicProgress({ ...progress, state: 'stopping', message: 'Ожидаем безопасной остановки…' });
      notify();
      return ok({ accepted: true }, 202);
    }
    // Проводник доступен и во время разбора. Путь берётся только из выбранной папки.
    if (action === 'inbox' || action === 'question') {
      if (!settings.root) return fail(409, 'Сначала выберите папку документов.');
      await openFolder(path.join(settings.root, action === 'inbox' ? 'Inbox' : 'Question'));
      return ok({ opened: true });
    }
    if (busy()) return fail(409, 'Дождитесь завершения текущего действия с документами.');
    pending = true;
    try {
      if (action === 'folder') {
        const selected = await pickFolder(settings.root);
        if (!selected) return ok({ cancelled: true });
        if (!path.isAbsolute(selected)) return fail(400, 'Выберите папку на компьютере.');
        const configured = await (await engine()).configure({ root: selected });
        await save({ ...settings, root: configured.root });
        progress = null;
        return ok({ selected: true });
      }
      if (action === 'logout') { auth = null; return ok({ signedIn: false }); }
      if (!['settings', 'login', 'run', 'resume', 'retry'].includes(action)) return fail(404, 'Нет такого действия.');
      const body = await readBody();
      if (body?.revision !== revision) return fail(409, 'Настройки изменились в другом окне. Проверьте показанный адрес и повторите действие.');
      if (action === 'settings') {
        const validated = serviceSettings(body);
        if (validated.status !== 200) return validated;
        await save({ ...settings, ...validated.body });
        return ok({ saved: true });
      }
      if (action === 'login') return await login(body);
      if (action === 'retry') {
        const ids = body.arrivalIds;
        if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) return fail(400, 'Выберите от 1 до 100 документов в отчёте.');
        return start(action, ids);
      }
      return start(action);
    } finally { pending = false; notify(); }
  }

  return { route, busy, async stop() { active?.abort(); await task; } };
}
