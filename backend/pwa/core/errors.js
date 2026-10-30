/**
 * Сборщик ошибок приложения (ОШ2): сбой → POST /client-errors, чтобы причины находить по данным, а не по жалобам.
 *   reportError(err, { kind, action, status, url }) — молча, без повторов при сбое отправки;
 *   одинаковая ошибка (sig) — не чаще 1 раза в 30 с; без связи — до 20 в очереди (в localStorage, переживает закрытие вкладки),
 *   уходят при появлении сети, при возвращении на вкладку и раз в минуту, пока очередь не пуста.
 * Отправляется только описание сбоя (текст, имя, стек, раздел, действие, путь API без query) — **данные форм никогда**.
 * Ответы сервера (400/401/403/404/409 с текстом) — не сбой, не отправляются (isFailure). Старый сервер (404) — больше не слать.
 */
import { apiQuiet, session } from './api.js';
import { isFailure } from '../ui/errors.js';
import { currentVersion } from './update-check.js';

const SAME_MS = 30000;
const QUEUE_MAX = 20;
let off = false;            // сервер без /client-errors — молчим до перезагрузки
const last = new Map();     // sig → когда отправлена
const queue = [];

const cut = (s, n) => (s == null || s === '' ? undefined : String(s).slice(0, n));
const norm = (s) => String(s || '').replace(/[0-9a-f]{24}/gi, '#').replace(/\d+/g, '#');
// раздел — только имя из адреса, без «?…» (поиск, фильтры, id записи не уходят): #stock?search=… → stock
const sectionNow = () => location.hash.replace(/^#\/?/, '').split('?')[0].replace(/[^\w-]/g, '') || 'home';
/** Требование пользователя: из текста и стека — query-часть адресов и ключи/токены (Bearer, kppd_, JWT) → «***». */
const scrub = (s) => String(s)
  .replace(/Bearer\s+[\w\-.~+/=]+/gi, 'Bearer ***')
  .replace(/kppd_[\w-]+/g, 'kppd_***')
  .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '***')
  .replace(/\?[^\s'"?]*=[^\n'"]*?((?::\d+){1,2}\)?)?(?=['"\n]|$)/g, '$1') // ?search=мой секрет — до конца строки, номер строки стека — оставить
  .replace(/\?[^\s'"<>()]*/g, (q) => (q.includes('=') ? '' : q)); // ?a=1&b=2 — прочь; одиночный «?» в тексте — оставить

export function reportError(err, { kind = 'action', action, status, url } = {}) {
  if (off || !session.access || !isFailure(err)) return;
  if (err && typeof err === 'object') { if (err.reported) return; try { err.reported = true; } catch { /* замороженный объект */ } }
  const st = Number(status ?? err?.status);
  const body = {
    message: cut(scrub(err?.message ?? err ?? ''), 500) || '(без текста)',
    name: cut(err?.name, 100),
    stack: err?.stack ? cut(scrub(err.stack), 4000) : undefined,
    section: cut(sectionNow(), 60),
    action: cut(action, 120),
    kind,
    status: Number.isFinite(st) && st > 0 ? st : undefined,
    url: url ? cut(scrub(String(url).split('?')[0]), 200) : undefined,
    version: cut(currentVersion(), 40),
    ua: cut(navigator.userAgent, 300),
  }; // тело запроса и значения полей — никогда (ОШ2, «Нельзя»)
  const sig = [body.name, norm(body.message), body.section, body.url].join('|');
  const now = Date.now();
  if (now - (last.get(sig) || 0) < SAME_MS) return;
  last.set(sig, now);
  if (navigator.onLine === false) { keep(body); return; }
  send(body);
}

/** Медленный экран (SPEED-2): первая отрисовка списка дольше 2 с → запись «Медленно: <раздел> <мс> мс», kind=slow. Не чаще раза в 5 минут на раздел. */
const slowAt = new Map();
export function reportSlow(ms) {
  if (off || !session.access) return;
  const section = sectionNow();
  const now = Date.now();
  if (now - (slowAt.get(section) || 0) < 300000) return;
  slowAt.set(section, now);
  const body = { message: `Медленно: ${section} ${Math.round(ms)} мс`, name: 'SlowScreen', section: cut(section, 60), action: 'открыть экран', kind: 'slow', version: cut(currentVersion(), 40), ua: cut(navigator.userAgent, 300) };
  if (navigator.onLine === false) { keep(body); return; }
  send(body);
}

function send(body) {
  apiQuiet('/client-errors', body)
    .then((st) => { if (st === 404) { off = true; queue.length = 0; save(); } })
    .catch(() => { if (!off) keep(body); }); // нет связи — остаётся в очереди, уйдёт при следующей попытке
}

/** Отправить накопленное: после входа, при сети, при возвращении на вкладку, раз в минуту. */
function flush() {
  if (off || !session.access || !queue.length || navigator.onLine === false) return;
  queue.splice(0).forEach(send);
  save();
}
window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
setInterval(flush, 60000);
