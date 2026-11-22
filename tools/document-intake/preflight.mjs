import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statfs } from 'node:fs/promises';
import { apiAddress, connectApi } from './api.mjs';

const exec = promisify(execFile);
const MIN_FREE = 512 * 1024 * 1024;
const PROBE_SCHEMA = { type: 'object', properties: { ready: { type: 'boolean', const: true } }, required: ['ready'], additionalProperties: false };

function localModel(value) {
  // Проверяем строку до URL-нормализации: альтернативные записи IP не допускаются.
  if (typeof value !== 'string' || !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:\/v1)?\/?$/.test(value)) return null;
  try { return new URL('/v1/chat/completions', value); } catch { return null; }
}

async function pdfProbe(run, signal) {
  // Проверяем именно извлечение текста, а не наличие установленного пакета.
  const script = "import json\ntry:\n import pymupdf as fitz\nexcept ImportError:\n import fitz\nd=fitz.open(); p=d.new_page(); p.insert_text((72,72),'DataCore PDF probe'); b=d.tobytes(); d.close(); r=fitz.open(stream=b,filetype='pdf'); print(json.dumps({'ready':'DataCore PDF probe' in r[0].get_text()})); r.close()";
  const { stdout } = await run('python', ['-c', script], { timeout: 20_000, maxBuffer: 4096, windowsHide: true, signal });
  if (JSON.parse(stdout)?.ready !== true) throw new Error();
}

/** Проверка перед анализом. Не устанавливает программы и не меняет данные DataCore. */
export async function preflight(options, dependencies = {}) {
  const { root, modelBase, model, apiBase, token, signal, onStep } = options;
  const runtime = { platform: process.platform, statfs, exec, fetchFn: fetch, connectApi, now: Date.now, ...dependencies };
  const steps = [];
  let actor = null;
  let contour = '';
  const publish = (step) => {
    try { onStep?.({ ...step }); } catch { /* Закрытое окно не прерывает проверку. */ }
  };
  async function check(id, title, recovery, task) {
    signal?.throwIfAborted();
    publish({ id, title, status: 'checking' });
    let detail;
    try {
      detail = await task();
      signal?.throwIfAborted();
      steps.push({ id, title, status: 'ready', ...(detail ?? {}) });
    } catch {
      signal?.throwIfAborted();
      // Сырые ошибки могут содержать адреса, JWT и вывод внешней программы.
      steps.push({ id, title, status: 'blocked', recovery });
    }
    publish(steps.at(-1));
  }

  await check('windows', 'Windows', 'Откройте Пульт на компьютере с Windows.', async () => {
    if (runtime.platform !== 'win32') throw new Error();
  });
  await check('disk', 'Место для оригиналов и черновиков', 'Выберите доступную папку и освободите не менее 512 МБ на её диске.', async () => {
    if (typeof root !== 'string' || !root) throw new Error();
    const disk = await runtime.statfs(root);
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    if (!Number.isSafeInteger(freeBytes) || freeBytes < MIN_FREE) throw new Error();
    return { freeBytes, requiredBytes: MIN_FREE };
  });
  await check('pdf', 'Чтение текстового PDF', 'Для чтения текста PDF на этом компьютере нужен Python с PyMuPDF.', () => pdfProbe(runtime.exec, signal));
  await check('model', 'Ответ локальной модели по схеме', 'Запустите локальный сервер LM Studio, загрузите выбранную модель и проверьте её имя и локальный адрес.', async () => {
    const endpoint = localModel(modelBase);
    if (!endpoint || typeof model !== 'string' || !model.trim() || model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) throw new Error();
    const response = await runtime.fetchFn(endpoint, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
      // Рассуждающая модель расходует бюджет до JSON; усечённый ответ всё равно запрещён.
      body: JSON.stringify({ model, temperature: 0, max_tokens: 1024,
        response_format: { type: 'json_schema', json_schema: { name: 'document_intake_probe', strict: true, schema: PROBE_SCHEMA } },
        messages: [{ role: 'user', content: 'Проверка готовности. Верни JSON строго по схеме: {"ready":true}.' }],
      }),
    });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(); }
    const result = await response.json();
    const choice = result?.choices?.[0];
    const content = choice?.message?.content;
    if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || content.length > 1024) throw new Error();
    const value = JSON.parse(content);
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || value.ready !== true) throw new Error();
    return { model };
  });
  await check('datacore', 'Контур DataCore и права', 'Проверьте выбранный контур и войдите с правами менеджера и доступом к суммам.', async () => {
    contour = apiAddress(apiBase).replace(/\/$/, '');
    const api = runtime.connectApi({ apiBase, token, signal });
    const user = await api.get('/auth/me');
    const roles = [user?.baseRole, user?.role];
    if (!user?.id || !user.canMoney || !roles.some(role => ['admin', 'manager'].includes(role))) throw new Error();
    actor = { role: user.baseRole ?? user.role };
    return { role: actor.role };
  });
  return { ready: steps.every(step => step.status === 'ready'), checkedAt: new Date(runtime.now()).toISOString(), steps,
    contour, actor };
}
