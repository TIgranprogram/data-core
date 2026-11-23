import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { preflight, probeLocalModel } from '../tools/document-intake/preflight.mjs';
import { FOLDERS, RUSSIAN_FOLDERS, jsonAtomic, openRoot } from '../tools/document-intake/store.mjs';

const exec = promisify(execFile);
const standardFolder = path.join(process.env.LOCALAPPDATA || homedir(), 'DataCore', 'Разбор документов');
const folderScript = fileURLToPath(new URL('./document-intake-folder.ps1', import.meta.url));
const production = 'https://kppdf-crm.ru/db/api';
const defaults = { root: '', apiBase: '', modelBase: 'http://127.0.0.1:1235/v1', model: '' };
const emptyCounts = { inbox: 0, processing: 0, ready: 0, question: 0 };
const importRoles = new Set(['manager', 'accountant', 'director', 'admin']);
const refreshAheadMs = 60_000;
const restoreRetryMs = 15_000;
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
  if (mode === 'Open') return value === 'foreground';
  if (mode === 'PDF') return value === 'opened';
  return value ? Buffer.from(value, 'base64').toString('utf8') : '';
}

const protectSession = process.platform === 'win32' ? (mode, value) => new Promise((resolve, reject) => {
  const operation = mode === 'protect' ? 'Protect' : 'Unprotect';
  const script = "$ErrorActionPreference = 'Stop'; [void][Reflection.Assembly]::LoadWithPartialName('System.Security'); "
    + '$data = [Convert]::FromBase64String([Console]::In.ReadToEnd()); '
    + '$result = [Security.Cryptography.ProtectedData]::' + operation
    + '($data, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); '
    + '[Console]::Out.Write([Convert]::ToBase64String($result))';
  const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 10_000, maxBuffer: 64_000,
  }, (error, output) => {
    if (error) reject(new Error('Хранилище входа Windows недоступно.'));
    else resolve(mode === 'protect' ? output.trim() : Buffer.from(output.trim(), 'base64').toString('utf8'));
  });
  child.stdin.on('error', () => {});
  child.stdin.end(mode === 'protect' ? Buffer.from(value, 'utf8').toString('base64') : value, 'utf8');
}) : null;

function counts(value) {
  return Object.fromEntries(Object.keys(emptyCounts).map((key) => [key, asCount(value?.[key])]));
}

function jwtClaims(token) {
  if (typeof token !== 'string' || token.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (typeof claims?.sub === 'string' && claims.sub && Number.isSafeInteger(claims.exp)) return claims;
  } catch { /* некорректный ответ входа или обновления */ }
  return null;
}

function sameAccount(left, right) {
  return !!left && !!right && left.sub === right.sub && left.version === right.version;
}

function refreshCookie(response, access, remember) {
  const matches = response.headers.getSetCookie().map((value) => /^refreshToken=([^;]+)(?:;|$)/.exec(value)).filter(Boolean);
  if (matches.length !== 1) return null;
  const value = matches[0][1];
  const claims = jwtClaims(value);
  return sameAccount(claims, access) && claims.rem === remember ? { value, expiresAt: claims.exp * 1000 } : null;
}

const errors = {
  AUTH: 'Войдите в DataCore, затем нажмите «Возобновить».',
  ACTOR: 'Войдите под учётной записью, которой начали разбор, и нажмите «Возобновить».',
  MODEL_UNAVAILABLE: 'Запустите локальную модель в LM Studio, затем нажмите «Возобновить».',
  BUSY: 'Эту папку уже разбирает другой процесс. Дождитесь его завершения.',
  ABORTED: 'Разбор остановлен. Чтобы продолжить, нажмите «Возобновить».',
};

export function createDocumentIntake({ stateDir, changed, engine = () => import('../tools/document-intake/index.mjs'), prepare = preflight, probeModel = probeLocalModel, fetchFn = fetch, now = Date.now, pickFolder = (root) => nativeFolder('Pick', root), openFolder = (root) => nativeFolder('Open', root), defaultRoot = standardFolder, secureSession = protectSession, openOriginal = (file) => nativeFolder('PDF', file) }) {
  const file = path.join(stateDir, 'document-intake.json');
  const sessionFile = path.join(stateDir, 'document-intake-session.json');
  const initialized = fs.readFile(file, 'utf8').then((raw) => {
    const saved = JSON.parse(raw);
    const services = serviceSettings(saved);
    settings = { ...defaults, ...(services.status === 200 ? services.body : {}), root: asText(saved.root, 32767) };
  }).catch(() => {}).then(loadSavedSession);
  let settings = { ...defaults };
  let revision = 0;
  let auth = null;
  let savedSession = null;
  let rememberedOnDisk = false;
  let restoreAfter = 0;
  let restoring = null;
  let active = null;
  let task = null;
  let pending = false;
  let progress = null;
  let preparation = null;

  const busy = () => !!active || pending || !!restoring;
  const loggedIn = () => !!auth && (auth.expiresAt > now() || auth.refresh?.expiresAt > now());
  const notify = () => changed?.();

  function clearAuth(session = auth) {
    if (!session) return;
    if (auth === session) auth = null;
    preparation = null;
    session.access = '';
    session.refresh = null;
  }

  function canRemember(apiBase) {
    return Boolean(secureSession && localBase(apiBase, '/api'));
  }

  async function eraseSavedSession() {
    savedSession = null;
    rememberedOnDisk = false;
    restoreAfter = 0;
    return fs.rm(sessionFile, { force: true }).then(() => true, () => false);
  }

  async function forgetAuth(session = auth) {
    if (auth !== session) return;
    clearAuth(session);
    return eraseSavedSession();
  }

  async function loadSavedSession() {
    if (!canRemember(settings.apiBase)) return;
    try {
      const { sealed } = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
      if (typeof sealed !== 'string' || !sealed || sealed.length > 64_000) throw authError();
      const { apiBase, claims, value } = JSON.parse(await secureSession('unprotect', sealed));
      const refresh = jwtClaims(value);
      if (apiBase !== settings.apiBase || !sameAccount(refresh, claims) || refresh.rem !== true || refresh.exp * 1000 <= now()) throw authError();
      savedSession = { apiBase, claims, refresh: { value, expiresAt: refresh.exp * 1000 }, remember: true };
      rememberedOnDisk = true;
    } catch (error) {
      if (error.code !== 'ENOENT') await eraseSavedSession();
    }
  }

  async function saveSession(session) {
    if (!session?.remember || !session.refresh || session.refresh.expiresAt <= now() || !canRemember(session.apiBase)) return;
    const { apiBase, claims, refresh } = session;
    const binding = { sub: claims.sub, version: claims.version, role: claims.role, orgId: claims.orgId };
    savedSession = { apiBase, claims: binding, refresh, remember: true };
    try {
      const sealed = await secureSession('protect', JSON.stringify({ apiBase, claims: binding, value: refresh.value }));
      await fs.mkdir(stateDir, { recursive: true });
      await jsonAtomic(sessionFile, { sealed });
      rememberedOnDisk = true;
    } catch { /* вход в текущем окне остаётся доступен */ }
  }

  function authError() {
    return Object.assign(new Error(errors.AUTH), { code: 'AUTH' });
  }

  async function renew(session, signal, verifyBinding = () => {}) {
    const response = await fetchFn(session.apiBase + '/auth/refresh', {
      method: 'POST', headers: { Authorization: 'Bearer ' + session.refresh.value, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    verifyBinding();
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) throw authError();
      throw new Error('Не удалось продлить вход в DataCore.');
    }
    const { access } = await response.json();
    verifyBinding();
    const claims = jwtClaims(access);
    const refresh = refreshCookie(response, claims, session.remember);
    if (!sameAccount(claims, session.claims) || claims.role !== session.claims.role || claims.orgId !== session.claims.orgId
      || claims.exp * 1000 <= now() || !refresh || refresh.expiresAt <= now()) throw authError();
    return { access, claims, expiresAt: claims.exp * 1000, refresh };
  }

  async function reconnect() {
    if (loggedIn() || !savedSession || restoreAfter > now()) return;
    if (!restoring) {
      restoring = (async () => {
        const candidate = savedSession;
        try {
          if (candidate.apiBase !== settings.apiBase || candidate.refresh.expiresAt <= now()) throw authError();
          const updated = await renew(candidate);
          auth = { ...candidate, ...updated, refreshing: null };
          await saveSession(auth);
          restoreAfter = 0;
        } catch (error) {
          if (error.code === 'AUTH') await eraseSavedSession();
          else restoreAfter = now() + restoreRetryMs;
        }
      })().finally(() => { restoring = null; });
    }
    await restoring;
  }

  async function save(next) {
    await fs.mkdir(stateDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    if (settings.apiBase !== next.apiBase) await forgetAuth();
    settings = next;
    preparation = null;
    revision++;
  }

  function publicProgress(value) {
    if (!value) return null;
    return {
      processed: asCount(value.processed), total: asCount(value.total), current: asText(value.current, 400),
      state: ['processing', 'ready', 'question', 'stopped', 'finished', 'stopping'].includes(value.state) ? value.state : 'processing',
      message: safeText(value.message),
      stage: asText(value.stage, 40), lastEventAt: asText(value.lastEventAt, 40), heartbeatAt: asText(value.heartbeatAt, 40),
    };
  }

  function safeText(value) {
    let text = typeof value === 'string' ? value : '';
    if (auth?.access) text = text.replaceAll(auth.access, '[скрыто]');
    if (auth?.refresh) text = text.replaceAll(auth.refresh.value, '[скрыто]');
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
    const review = root && loggedIn() && auth.claims ? await (await engine()).reviewStatus?.({ root, owner: auth.claims.sub, target: settings.apiBase, collapseCopies: true }).catch(() => null) : null;
    const running = !!active || !!snapshot?.running;
    return {
      settings, inboxPath: root ? snapshot?.folders?.inbox || path.join(root, FOLDERS.inbox) : path.join(defaultRoot, RUSSIAN_FOLDERS.inbox), revision, signedIn: loggedIn(), remembered: rememberedOnDisk, busy: pending, running, canStop: !!active && !active.signal.aborted,
      counts: counts(snapshot?.counts),
      reviewCounts: review ? { inbox: asCount(snapshot?.counts?.inbox), processing: asCount(review.counts.pending), checked: asCount(review.counts.checked), question: asCount(review.counts.question), uploaded: asCount(review.counts.uploaded), ...(review.counts.sending ? { sending: review.counts.sending } : {}), ...(review.counts.automatic ? { automatic: review.counts.automatic } : {}) } : null,
      preparation,
      progress: progress || (snapshot?.running ? publicProgress({ state: 'processing', current: snapshot.current }) : null),
    };
  }

  async function reviewReport() {
    if (!settings.root) return { counts: {}, items: [] };
    const result = await (await engine()).reviewStatus({ root: settings.root, owner: auth.claims.sub, target: settings.apiBase, collapseCopies: true });
    return { counts: result.counts, items: result.items.map(item => ({
      arrivalId: asText(item.arrivalId, 36), batchId: asText(item.batchId, 36), name: asText(item.name, 400),
      state: asText(item.state, 32), kind: asText(item.kind, 32), version: asCount(item.version), hash: asText(item.hash, 64), updatedAt: asText(item.updatedAt, 40),
      ...(item.returnToManager ? { returnToManager: true } : {}),
      ...(item.reviewParties?.length ? { reviewParties: item.reviewParties.map(party => ({
        field: asText(party.field, 10), name: safeText(party.name), inn: asText(party.inn, 12), page: asCount(party.page),
      })) } : {}),
      issues: item.issues.map(issue => ({
        code: asText(issue.code, 40), message: safeText(issue.message), action: safeText(issue.action),
        ...(issue.field ? { field: asText(issue.field, 10) } : {}),
      })),
    })) };
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
      return fail(400, 'Введите логин и пароль DataCore.');
    }
    await forgetAuth();
    const remember = canRemember(settings.apiBase);
    let response;
    try {
      response = await fetchFn(`${settings.apiBase}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, remember }), redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
    } catch { return fail(502, 'Сайт не отвечает по сохранённому адресу. Проверьте подключение и адрес.'); }
    if (response.status === 429) return fail(429, 'Слишком много попыток входа. Подождите минуту.');
    if (response.status === 401 || response.status === 403) return fail(401, 'Проверьте логин и пароль DataCore.');
    if (!response.ok) return fail(502, 'Сайт не подтвердил вход. Проверьте адрес в настройках.');
    const result = await response.json().catch(() => null);
    if (!result?.access || typeof result.access !== 'string') return fail(502, 'Сайт не подтвердил вход. Проверьте адрес в настройках.');
    const user = result.user;
    // Ответ входа содержит тот же профиль, что /auth/me. Маршруты импорта проверяют права повторно.
    if (!user?.isOwner && (!importRoles.has(user?.baseRole ?? user?.role) || user?.canMoney === false)) {
      return fail(403, 'Для разбора документов нужна учётная запись с правами менеджера и доступом к суммам.');
    }
    const claims = jwtClaims(result.access);
    if (claims && user.id && claims.sub !== user.id) return fail(502, 'Сайт не подтвердил учётную запись. Войдите снова.');
    auth = {
      access: result.access, claims, expiresAt: claims ? claims.exp * 1000 : now() + 15 * 60_000,
      refresh: refreshCookie(response, claims, remember), apiBase: settings.apiBase, remember, refreshing: null,
    };
    await saveSession(auth);
    return ok({ signedIn: loggedIn() });
  }

  function tokenProvider(session, { root, apiBase }, controller) {
    const signal = controller?.signal;
    function checkBinding() {
      signal?.throwIfAborted();
      const operationActive = controller ? active === controller : pending && !active;
      if (auth !== session || session.apiBase !== apiBase || settings.apiBase !== apiBase || settings.root !== root || !operationActive) throw authError();
    }
    async function refreshAccess() {
      try {
        Object.assign(session, await renew(session, signal, checkBinding));
        await saveSession(session);
      } catch (error) {
        signal?.throwIfAborted();
        if (error.code === 'AUTH' || !session.remember) await forgetAuth(session);
        else {
          clearAuth(session);
          restoreAfter = now() + restoreRetryMs;
        }
        throw authError();
      }
    }
    return async () => {
      checkBinding();
      const remaining = session.expiresAt - now();
      if (remaining > refreshAheadMs || (remaining > 0 && !session.refresh)) return session.access;
      if (!session.refresh || session.refresh.expiresAt <= now()) { await forgetAuth(session); throw authError(); }
      session.refreshing ??= refreshAccess().finally(() => { session.refreshing = null; });
      await session.refreshing;
      checkBinding();
      return session.access;
    };
  }

  function start(mode, arrivalIds, scope, automatic = false) {
    if (!settings.root) return fail(409, 'Сначала выберите папку документов.');
    if (!settings.apiBase || !settings.model) return fail(409, 'Сначала сохраните адрес сайта и настройки локальной модели.');
    if (!loggedIn()) return fail(401, 'Войдите в учётную запись менеджера.');
    if (automatic && !localBase(settings.apiBase, '/api')) return fail(409, 'Автоматическая отправка сейчас доступна на тестовой копии.');
    const { root, apiBase, modelBase, model } = settings;
    const session = auth;
    const controller = new AbortController();
    const token = tokenProvider(session, { root, apiBase }, controller);
    active = controller;
    if (mode === 'analyze') preparation = null;
    progress = publicProgress({ state: 'processing', message: scope === 'review' ? 'Готовим сомнительные документы к повторной проверке…' : 'Готовим входящие документы к разбору…' });
    notify();
    const onProgress = (update) => {
      if (!controller.signal.aborted) progress = publicProgress(update);
      notify();
    };
    const heartbeat = mode === 'analyze' ? setInterval(() => {
      progress = publicProgress({ ...progress, heartbeatAt: new Date(now()).toISOString() }); notify();
    }, 5_000) : null;
    heartbeat?.unref?.();
    task = Promise.resolve().then(engine).then(async (intake) => {
      controller.signal.throwIfAborted();
      if (mode === 'analyze') {
        const preparationSteps = [];
        preparation = await prepare({ root, apiBase, token, modelBase, model, signal: controller.signal,
          onStep: step => {
            const index = preparationSteps.findIndex(item => item.id === step.id);
            if (index < 0) preparationSteps.push(step); else preparationSteps[index] = step;
            preparation = { ready: false, steps: [...preparationSteps], contour: apiBase };
            onProgress({ state: 'processing', stage: 'preparing', message: step.title, lastEventAt: new Date(now()).toISOString() });
          } });
        if (!preparation.ready) return { stopped: { code: 'PREPARATION', message: 'Подготовка не завершена.',
          action: preparation.steps.filter(step => step.status === 'blocked').map(step => step.recovery).join(' ') } };
      }
      const options = { root, apiBase, token, modelBase, model, onProgress, signal: controller.signal,
        ...(arrivalIds ? { arrivalIds } : {}), ...(scope ? { scope } : {}) };
      const result = await intake[mode](mode === 'analyze' ? { ...options, automatic } : options);
      if (!automatic || result?.stopped) return result;
      controller.signal.throwIfAborted();
      onProgress({ ...progress, state: 'processing', stage: 'sending', current: '', message: 'Проверяем дубли и отправляем подтверждённые документы.' });
      const batch = await intake.prepareBatch({ ...options, automatic: true });
      if (!batch.items.length) return result;
      controller.signal.throwIfAborted();
      const sent = await intake.sendBatch({ ...options, confirmationId: batch.id });
      return { ...result, autoUploaded: sent.uploaded };

    })
      .then(async (result) => {
        if (result?.stopped?.code === 'AUTH' && !controller.signal.aborted) await forgetAuth(session);
        const message = safeStopped(result?.stopped);
        progress = publicProgress({ ...progress,
          ...(Number.isSafeInteger(result?.processed) ? { processed: result.processed } : {}),
          ...(Number.isSafeInteger(result?.total) ? { total: result.total } : {}),
          state: message || controller.signal.aborted ? 'stopped' : 'finished', current: '', message: message || (controller.signal.aborted ? errors.ABORTED : result?.autoUploaded ? 'Автоматически отправлено: ' + result.autoUploaded : '') });
      }).catch(async (err) => {
        if (err.code === 'AUTH' && !controller.signal.aborted) await forgetAuth(session);
        const message = controller.signal.aborted ? errors.ABORTED : errors[err.code] || 'Не удалось продолжить разбор. Проверьте доступ к папке, сайту и локальной модели.';
        progress = publicProgress({ ...progress, state: 'stopped', message });
      }).finally(() => { if (heartbeat) clearInterval(heartbeat); active = null; task = null; notify(); });
    return ok({ accepted: true }, 202);
  }

  async function route(method, action, readBody) {
    await initialized;
    if (action !== 'logout') await reconnect();
    if (method === 'GET' && action === 'status') return ok(await view());
    if (method === 'GET' && action === 'report') return ok(await report());
    if (method === 'GET' && action === 'reviewreport') {
      if (!loggedIn() || !auth.claims) return fail(401, 'Войдите в учётную запись менеджера.');
      return ok(await reviewReport());
    }
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
      let folders;
      if (!settings.root && action === 'inbox') {
        if (busy()) return fail(409, 'Дождитесь завершения текущего действия с документами.');
        pending = true;
        try {
          const configured = await (await engine()).configure({ root: defaultRoot, localized: true });
          folders = configured.folders;
          await save({ ...settings, root: configured.root });
        } finally { pending = false; notify(); }
      }
      if (!settings.root) return fail(409, 'Сначала откройте входящие.');
      folders ||= (await openRoot(settings.root, { create: false })).folders;
      const focused = await openFolder(folders?.[action] || path.join(settings.root, FOLDERS[action]));
      return ok({ opened: true, focused: focused !== false });
    }
    if (busy()) return fail(409, 'Дождитесь завершения текущего действия с документами.');
    pending = true;
    try {
      if (action === 'folder') {
        const selected = await pickFolder(settings.root);
        if (!selected) return ok({ cancelled: true });
        if (!path.isAbsolute(selected)) return fail(400, 'Выберите папку на компьютере.');
        const configured = await (await engine()).configure({ root: selected, localized: true });
        await save({ ...settings, root: configured.root });
        progress = null;
        return ok({ selected: true });
      }
      if (action === 'detach') {
        if (!settings.root) return ok({ detached: true });
        const body = await readBody();
        if (body?.revision !== revision) return fail(409, 'Папка уже изменена в другом окне.');
        await save({ ...settings, root: '' });
        progress = null;
        return ok({ detached: true });
      }
      if (action === 'logout') {
        if (!await forgetAuth()) return fail(409, 'Вход закрыт в этом окне. Пульт не смог удалить сохранённый вход с диска. Повторите выход.');
        return ok({ signedIn: false });
      }
      if (!['settings', 'login', 'run', 'resume', 'retry', 'analyze', 'draft', 'original', 'reviewdecision', 'prepare', 'send', 'imagesprepare', 'imagessend', 'imagescontracts', 'modelprobe'].includes(action)) return fail(404, 'Нет такого действия.');
      const body = await readBody();
      if (body?.revision !== revision) return fail(409, 'Настройки изменились в другом окне. Проверьте показанный адрес и повторите действие.');
      if (action === 'modelprobe') {
        try { await probeModel({ modelBase: body.modelBase, model: body.model }); }
        catch { return fail(409, 'Выбранная модель не ответила. Проверьте адрес и имя модели в LM Studio.'); }
        return ok({ ready: true });
      }
      if (action === 'settings') {
        const validated = serviceSettings(body);
        if (validated.status !== 200) return validated;
        await save({ ...settings, ...validated.body });
        return ok({ saved: true });
      }
      if (action === 'login') return await login(body);
      if (['imagesprepare', 'imagessend', 'imagescontracts'].includes(action)) {
        if (!settings.root || !loggedIn() || !auth.claims) return fail(401, 'Выберите папку и войдите под учётной записью менеджера.');
        if (typeof body.arrivalId !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.arrivalId)) return fail(400, 'Выберите PDF в отчёте.');
        if (body.contractId !== undefined && !/^[a-f\d]{24}$/i.test(body.contractId)) return fail(400, 'Выберите договор из списка.');
        if (action === 'imagescontracts' && (typeof body.search !== 'string' || body.search.trim().length < 2 || body.search.length > 80)) return fail(400, 'Введите номер договора: от 2 до 80 символов.');
        if (action === 'imagessend' && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(body.confirmationId || '')) return fail(400, 'Сначала проверьте рисунки и позиции.');
        const controller = new AbortController();
        const token = tokenProvider(auth, settings, controller);
        active = controller;
        try {
          const intake = await engine();
          task = intake[action === 'imagesprepare' ? 'prepareDocumentImages' : action === 'imagescontracts' ? 'searchImageContracts' : 'sendDocumentImages']({ ...settings,
            arrivalId: body.arrivalId, contractId: body.contractId, search: body.search, confirmationId: body.confirmationId, token, signal: controller.signal });
          return ok(await task);
        } catch (error) {
          return fail(error.code === 'AUTH' ? 401 : 409, safeStopped(error));
        } finally { active = null; task = null; }
      }
      if (action === 'prepare' || action === 'send') {
        if (!settings.root || !loggedIn() || !auth.claims) return fail(401, 'Выберите папку и войдите под учётной записью менеджера.');
        if (action === 'send' && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(body.confirmationId || '')) return fail(400, 'Подтвердите показанный список документов.');
        const controller = new AbortController();
        const token = tokenProvider(auth, settings, controller);
        active = controller;
        try {
          const intake = await engine();
          task = intake[action === 'prepare' ? 'prepareBatch' : 'sendBatch']({ ...settings, confirmationId: body.confirmationId, token, signal: controller.signal });
          return ok(await task);
        } catch (error) {
          return fail(error.code === 'AUTH' ? 401 : 409, safeStopped(error));
        } finally { active = null; task = null; }
      }
      if (action === 'analyze' && body.scope !== undefined) {
        if (!['incoming', 'review'].includes(body.scope)) return fail(400, 'Выберите входящие или повторную проверку.');
        const automatic = body.automatic === true && body.scope === 'incoming';
        if (settings.root && loggedIn()) {
          const { reviewCounts } = await view();
          if (reviewCounts && body.scope === 'incoming' && !reviewCounts.inbox && !reviewCounts.processing && !(automatic && reviewCounts.automatic)) {
            return fail(409, 'Во входящих нет PDF. Сомнительные файлы можно повторно проверить в отчёте.');
          }
          if (reviewCounts && body.scope === 'review' && !reviewCounts.question) return fail(409, 'Документов для повторной проверки нет.');
        }
        return start(action, undefined, body.scope, automatic);
      }
      if (['draft', 'original', 'reviewdecision'].includes(action)) {
        if (!settings.root || !loggedIn() || !auth.claims) return fail(401, 'Войдите в учётную запись менеджера.');
        if (typeof body.arrivalId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.arrivalId)) return fail(400, 'Выберите документ в отчёте.');
        const intake = await engine();
        let draft;
        try {
          const { root, apiBase } = settings;
          const { arrivalId, version, decision, field, name, inn, value } = body;
          if (action === 'reviewdecision') {
            const token = tokenProvider(auth, { root, apiBase });
            draft = await intake.reviewDecision({ root, apiBase, token, arrivalId, version, decision, field, name, inn, value });
            preparation = null;
          } else {
            draft = await intake[action === 'original' ? 'getReviewOriginal' : 'getDraft']({ root, arrivalId });
          }
        } catch (error) {
          return fail(409, safeStopped(error));
        }
        if (draft.owner !== auth.claims.sub || draft.target.replace(/\/$/, '') !== settings.apiBase) return fail(403, 'Черновик относится к другой учётной записи или контуру.');
        if (action === 'original') {
          try { if (await openOriginal(draft.original)) return ok({ opened: true }); }
          catch { /* просмотрщик недоступен */ }
          return fail(409, 'Windows не смогла открыть PDF. Проверьте программу просмотра PDF.');
        }
        // История и служебные поля не нужны для просмотра оператором.
        return ok({ arrivalId: body.arrivalId, name: draft.name, version: draft.version, state: draft.state,
          pages: draft.pages, partyColumns: draft.partyColumns, printedRows: draft.printedRows, raw: draft.evidence || draft.raw, kind: draft.kind || draft.proposal?.kind,
          reference: draft.orderReference, issues: draft.issues,
          manualParties: draft.manualParties, returnToManager: Boolean(draft.returnToManager),
          vision: draft.vision && { state: draft.vision.state, pages: draft.vision.pages, fields: draft.vision.fields },
          layoutFields: draft.layoutFields });
      }
      if (action === 'retry') {
        const ids = body.arrivalIds;
        if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) return fail(400, 'Выберите от 1 до 100 документов в отчёте.');
        return start(action, ids);
      }
      return start(action);
    } finally { pending = false; notify(); }
  }

  return { route, busy, async stop() { active?.abort(); await task; await restoring; clearAuth(); } };
}
