/**
 * Р1 (C112): общий помощник записи для скриптов правки данных через API.
 * Сервер на время переключения отдаёт `503 READ_ONLY` с `retryAfter` (сек) — запись не теряется, а повторяется
 * по этому сроку (до 5 повторов). Итог честный: written (с первого раза) | retried (записано после повторов) | failed.
 *
 * Из скрипта на bash (вместо `bash deploy/synology/api.sh prod PUT …`):
 *   node backend/scripts/lib/write-retry.js prod PUT /api/showcase/<id>/passport-defaults <файл-с-телом.json>
 * Ответ сервера — в stdout как есть; итог при повторах/неудаче — одной строкой в stderr: «[запись: повторено N, записано]»
 * или «[запись: не записано после N повторов]». Код выхода: 0 — записано, 1 — не записано.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const MAX_RETRIES = 5;
const DEFAULT_WAIT = 30;
const MAX_WAIT = 120;

/** Разбор ответа: ok — записано; retry — повторить через wait сек; fail — ошибка, повтор не поможет. */
function judge(text) {
  const t = String(text ?? '');
  let j = null;
  try { j = JSON.parse(t); } catch { /* не JSON — ниже */ }
  if (j && typeof j === 'object') {
    if (Number(j.statusCode) === 503 || j.code === 'READ_ONLY') {
      const w = Number(j.retryAfter);
      return { kind: 'retry', wait: Math.min(MAX_WAIT, w > 0 ? w : DEFAULT_WAIT) };
    }
    if (Number(j.statusCode) >= 400) return { kind: 'fail' };
    return { kind: 'ok' };
  }
  if (/^curl: \((7|28|52|56)\)/m.test(t)) return { kind: 'retry', wait: 5 }; // обрыв связи, нет ответа
  if (/вход не удался|^curl:|нет пароля/m.test(t)) return { kind: 'fail' };
  return { kind: 'ok' };
}

/**
 * Записать с повторами. `send()` → Promise<string> (тело ответа); `sleep(sec)` — ожидание (в тесте подменяется).
 * Возвращает { out, state, retries }.
 */
async function writeWithRetry(send, { sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)), max = MAX_RETRIES } = {}) {
  let out = '';
  for (let retries = 0; ; retries++) {
    out = await send();
    const v = judge(out);
    if (v.kind === 'ok') return { out, state: retries ? 'retried' : 'written', retries };
    if (v.kind === 'fail' || retries >= max) return { out, state: 'failed', retries };
    await sleep(v.wait);
  }
}

/** Итог словами для строки в stderr. */
function summary(r) {
  if (r.state === 'failed') return `[запись: не записано после ${r.retries} повторов]`;
  if (r.state === 'retried') return `[запись: повторено ${r.retries}, записано]`;
  return '';
}

module.exports = { judge, writeWithRetry, summary, MAX_RETRIES };

if (require.main === module) {
  const [env, method, apiPath, body] = process.argv.slice(2);
  if (!env || !method || !apiPath) { console.error('нужно: <local|prod|stand> <PUT|POST|PATCH|DELETE> </api/…> [файл-тела.json]'); process.exit(2); }
  const api = path.resolve(__dirname, '../../../deploy/synology/api.sh');
  const send = async () => {
    const r = spawnSync('bash', [api, env, method, apiPath, ...(body ? [body] : [])], { encoding: 'utf8' });
    return `${r.stdout || ''}${r.stderr || ''}`;
  };
  writeWithRetry(send).then((r) => {
    process.stdout.write(r.out);
    const s = summary(r);
    if (s) process.stderr.write(`\n${s}\n`);
    process.exit(r.state === 'failed' ? 1 : 0);
  });
}
