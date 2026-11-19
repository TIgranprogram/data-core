// ИИ-тестировщик: чистые функции (без браузера и сети) — их проверяет lib.test.mjs.

/** Метка всех записей, которые создаёт тестировщик. По ней их видно на стенде и убирает «Убрать тестовые записи». */
export const TAG = 'ТЕСТ-ИИ';

/** Работать можно только на этом ПК: рабочий сайт (kppdf-crm.ru и любой внешний адрес) — отказ. */
export function isLocalStand(url) {
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !['3000', '3001', '3002'].includes(u.port);
  } catch { return false; }
}

/** Модель — только LM Studio этого ПК: внешний адрес (облако, другой компьютер) — отказ. */
export function isLocalModel(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}

/** Стенд годится, только если адрес совпадает с паспортом собственного стенда этого checkout. */
export function standMatchesPassport(url, run) {
  if (!isLocalStand(url) || !run) return false;
  const u = new URL(url);
  return Number(u.port) === Number(run.apiPort);
}

/** ID запуска: время + случайный хвост. Папка запуска — tools/logs/ai-tester/<день>/runs/<id>/. */
export function newRunId(d = new Date(), rnd = Math.random) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Находка программы по сетевому ответу → вид:
 * «ошибка» — подтверждена программой (5xx); «отказ» — сайт отказал на действие модели (4xx): проверить, ошибка ли ввода;
 * «медленно» — ответ дольше 3 с. 401 (продление входа) и 409 (повтор) — не находка.
 */
export function netFinding(n) {
  const p = String(n.url || '').split('?')[0];
  const out = [];
  if (n.status >= 500) out.push({ kind: 'ошибка', text: `сервер ответил ошибкой ${n.status} на ${n.method} ${p}` });
  else if (n.status >= 400 && n.status !== 401 && n.status !== 409 && n.method !== 'GET') out.push({ kind: 'отказ', text: `сайт отказал: ${n.method} ${p} → ${n.status}${n.msg ? ` «${n.msg}»` : ''}` });
  else if (n.status === 404 && n.method === 'GET') out.push({ kind: 'отказ', text: `нет данных по адресу ${p} (404)` });
  if (n.ms > 3000) out.push({ kind: 'медленно', text: `медленно: ${n.method} ${p} — ${(n.ms / 1000).toFixed(1)} с` });
  return out;
}

/**
 * Можно ли удалить запись при уборке: в записи есть метка ТЕСТ-ИИ, либо её создал вход тестировщика
 * не раньше начала запуска. Иначе — не трогать (массового удаления по названию нет).
 */
export function cleanupAllowed(record, { userId = '', since = 0 } = {}) {
  if (!record || typeof record !== 'object') return false;
  if (JSON.stringify(record).includes(TAG)) return true;
  const author = String(record.createdBy?.id || record.createdBy?._id || record.createdBy || record.author || '');
  const at = Date.parse(record.createdAt || '');
  return Boolean(userId) && author === String(userId) && Number.isFinite(at) && at >= since;
}

/**
 * Текст, который модель вводит в поле. В поле записи (название, комментарий) — с меткой ТЕСТ-ИИ в начале;
 * поиск, числа, даты, суммы, телефоны, ИНН — как есть.
 */
export function tagText(text, field = {}) {
  const t = String(text ?? '').trim();
  if (!t) return t;
  if (field.search || field.combo) return t;
  if (['number', 'date', 'datetime-local', 'time', 'month', 'email', 'tel', 'url', 'password', 'color', 'range'].includes(field.type)) return t;
  if (/^[\d\s.,:+\-/()₽%]+$/.test(t)) return t;
  if (t.startsWith(TAG)) return t;
  return `${TAG} ${t}`;
}

/**
 * Запись о созданной записи из ответа сервера на POST. Берём только создание в корне коллекции
 * (POST /api/partners, POST /api/supply/requests), а не действие над существующей
 * (POST /api/supplyrequests/<id>/items вернёт чужую заявку — её убирать нельзя).
 */
export function createdFrom(method, url, status, body) {
  if (method !== 'POST' || status < 200 || status >= 300) return null;
  let p;
  try { p = new URL(url, 'http://x').pathname; } catch { return null; }
  if (!p.startsWith('/api/')) return null;
  const segs = p.slice(5).split('/').filter(Boolean);
  if (!segs.length || segs.length > 2) return null;
  if (segs.some((s) => /^[0-9a-f]{24}$/i.test(s))) return null;
  if (/^(auth|meta|client-errors|search|health|qr|today|my-tasks|notifications|messages|document-render|devlog|control|disk)$/.test(segs[0])) return null;
  if (segs.length === 2 && /(check|preview|print|calc|import|export|search|login|refresh|bulk|batch|render|pdf|xlsx|upload|validate|plan|suggest|match)/i.test(segs[1])) return null;
  let j = body;
  if (typeof body === 'string') { try { j = JSON.parse(body); } catch { return null; } }
  const id = j && typeof j === 'object' ? (j.id || j._id) : null;
  if (!id || typeof id !== 'string') return null;
  return { path: '/' + segs.join('/'), id };
}

/** Ключ для склейки одинаковых находок: без чисел, id и кавычек. */
export function findingKey(kind, text) {
  return kind + '|' + String(text).toLowerCase().replace(/[0-9a-f]{24}/g, '#').replace(/\d+/g, 'N').replace(/["«»'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** Склеить находки: одинаковые → одна строка со счётчиком и первым снимком. */
export function groupFindings(list) {
  const m = new Map();
  for (const f of list) {
    const k = findingKey(f.kind, f.text);
    const g = m.get(k);
    if (g) { g.count++; if (!g.tasks.includes(f.task)) g.tasks.push(f.task); }
    else m.set(k, { ...f, count: 1, tasks: [f.task] });
  }
  return [...m.values()];
}

/** Мусор на экране: служебные значения, которые человеку показывать нельзя. */
export function screenGarbage(text) {
  const m = String(text || '').match(/\bundefined\b|\[object Object\]|\bNaN\b|\bnull\b(?![-\w])|\{\{?\s*\w+\s*\}?\}/);
  return m ? m[0] : '';
}

/** Ошибка в тексте экрана: склонение после предлога, повтор слова (правило — backend/pwa/core/grammar.js, пользователь 2026-11-13). */
export { grammarSlips as screenGrammar } from '../../backend/pwa/core/grammar.js';

/** Можно ли нажать кнопку: выход и удаление чужих записей — нет. */
export function blockedClick(label, context = '') {
  const l = String(label || '').trim();
  if (/^(Выйти|Выход|Сменить пароль|Сбросить пароль)/i.test(l)) return 'выходить из сайта и менять пароль нельзя';
  if (/(Удалить|Списать|В архив|Аннулировать|Очистить)/i.test(l) && !String(context).includes(TAG)) return `удалять и списывать можно только свои записи с меткой ${TAG}`;
  return '';
}

/** Короткая сводка для отчёта: «12 мин», «2 ч 05 мин». */
export function duration(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}

/**
 * Сторож: что делать с идущим запуском. Сборка стенда (docker через spawnSync) держит процесс до 15 мин без отметок —
 * поэтому «мёртв» только после 25 мин тишины; живой, но молчащий процесс сначала снимается (13.11: 9 копий сразу).
 */
export const DEAD_MS = 25 * 60000;
/** Срок вышел 20 мин назад, а отметки идут — запуск завис: живым не считается (14.11: такой сутки не пускал Старожила). */
export const OVERDUE_MS = 20 * 60000;
export const runLive = (run, now, alive) => !!run && !!alive && now - (run.beat || 0) < DEAD_MS && !(run.until && now > run.until + OVERDUE_MS);
export function watchdogAction({ run, now, alive, stopped = false }) {
  if (!run || run.noWatchdog) return 'none';
  if (stopped || now >= run.until) return 'done';
  const quiet = now - (run.beat || 0) >= DEAD_MS;
  if (!quiet && alive) return 'none';
  return alive ? 'kill-resume' : 'resume';
}

/** Раздел закрыт для роли входа — задание не проверяет сайт, его пропускают (отчёт 13.11: 220 «провалов» из-за этого). */
export function closedForRole(text) {
  return /для вашей роли закрыт|Нет доступа к разделу/i.test(String(text || ''));
}

/** Отчёт за день — Markdown на языке пользователя. */
/** C125 скорость: путь API без id (24 hex, числа, коды заказов) — одна строка таблицы на один вид запроса. */
export const speedKey = (method, url) => `${method} ${String(url).split('?')[0].replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id').replace(/\/m:[0-9a-f]{24}/gi, '/:id').replace(/\/\d[\w-]*(?=\/|$)/g, '/:n')}`;
/** samples = [{ key, ms }] → [{ key, n, p50, p95, max }], медленные сверху; только ≥ minN замеров. */
export function speedStats(samples = [], { minN = 1, top = 15 } = {}) {
  const by = new Map();
  for (const s of samples) { if (!Number.isFinite(s.ms)) continue; if (!by.has(s.key)) by.set(s.key, []); by.get(s.key).push(s.ms); }
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return [...by.entries()].filter(([, a]) => a.length >= minN).map(([key, a]) => { a.sort((x, y) => x - y); return { key, n: a.length, p50: q(a, 0.5), p95: q(a, 0.95), max: a.at(-1) }; })
    .sort((a, b) => b.p50 - a.p50).slice(0, top);
}

export function buildReport({ day, model, base = '', startedAt, now, tasks, findings, created, removed, renewals = 0, role = '', speed = [], run = null, faults = [], left = null }) {
  const ok = tasks.filter((t) => t.result === 'получилось').length;
  const skipped = tasks.filter((t) => t.result === 'пропущено').length;
  const errs = groupFindings(findings.filter((f) => f.kind === 'ошибка'));
  const refusals = groupFindings(findings.filter((f) => f.kind === 'отказ' || f.kind === 'медленно'));
  const notes = groupFindings(findings.filter((f) => String(f.kind).startsWith('ИИ')));
  const line = (e) => `- ${e.kind !== 'ошибка' ? `[${e.kind}] ` : ''}${e.text}${e.count > 1 ? ` — ×${e.count}` : ''} · где: ${e.where || '—'} · задание: ${e.tasks.join(', ')}${e.shot ? ` · снимок: ${e.shot}` : ''}`;
  const L = [];
  L.push(`# ИИ-тестировщик — отчёт за ${day}${run?.id ? ` · запуск ${run.id}` : ''}`, '');
  if (run?.id) L.push(`- Запуск: ${run.id} · код ${run.commit || '?'} · стенд ${run.stand || '?'} · модель ${run.baseUrl || '?'} · шагов на задание ${run.stepsPerTask ?? '?'}`);
  if (run?.status) L.push(`- Итог запуска: ${run.status}${run.plannedMin ? ` · план ${run.plannedMin} мин` : ''}${run.resumes ? ` · продолжений после обрыва: ${run.resumes}` : ''}`);
  L.push(`- Работал: ${duration(now - startedAt)}, модель: ${model}`);
  if (role) L.push(`- Роль: ${role}${role === 'manager' ? ' (проверен менеджерский UX)' : ' — НЕ manager, менеджерская приёмка не засчитывается'}`);
  if (base) L.push(`- База стенда: ${base}`);
  L.push(`- Заданий: ${tasks.length} (получилось ${ok}, не получилось ${tasks.length - ok - skipped}${skipped ? `, пропущено — раздел закрыт для роли: ${skipped}` : ''}) — итог модели, это не приёмка`);
  L.push(`- Ошибок сайта: ${errs.length}, замечаний ИИ: ${notes.length}`);
  L.push(`- Отказов и медленных ответов (проверить): ${refusals.length} · сбоев тестировщика: ${faults.length}`);
  L.push(`- Создано тестовых записей: ${created.length}${removed != null ? `, убрано: ${removed}` : ''}${left?.length ? `, оставлено: ${left.length}` : ''}`);
  L.push(`- Токен доступа обновлён автоматически: ${renewals} раз`);
  L.push('');
  L.push('## Ошибки сайта (подтвердила программа: 5xx, сбой страницы, служебный текст на экране)', '');
  if (!errs.length) L.push('Нет.');
  for (const e of errs) L.push(`- ${e.text}${e.count > 1 ? ` — ×${e.count}` : ''} · где: ${e.where || '—'} · задание: ${e.tasks.join(', ')}${e.shot ? ` · снимок: ${e.shot}` : ''}`);
  // C125: скорость — главное для владельца; медленнее 1,5 с — уже ошибка сайта выше
  const sp = speedStats(speed);
  const all = speed.map((x) => x.ms).filter(Number.isFinite).sort((a, b) => a - b);
  L.push('', '## Скорость (ответы сервера стенда)', '');
  if (!all.length) L.push('Замеров нет.');
  else {
    L.push(`Запросов: ${all.length} · медиана ${all[Math.floor(all.length / 2)]} мс · 95% быстрее ${all[Math.min(all.length - 1, Math.floor(all.length * 0.95))]} мс · медленнее 1,5 с: ${all.filter((x) => x > 1500).length}`, '');
    L.push('| Запрос | Раз | Медиана, мс | 95%, мс | Худший, мс |', '|--|--|--|--|--|');
    for (const r of sp) L.push(`| ${r.key} | ${r.n} | ${r.p50} | ${r.p95} | ${r.max} |`);
  }
  L.push('', '## Отказы сайта и медленные ответы (не обязательно ошибка: модель могла ввести не то)', '');
  if (!refusals.length) L.push('Нет.');
  for (const e of refusals) L.push(line(e));
  L.push('', '## Замечания ИИ — гипотезы (проверить глазами — бывают ложные)', '');
  if (!notes.length) L.push('Нет.');
  for (const e of notes) L.push(line(e));
  L.push('', '## Сбои тестировщика (не ошибки сайта)', '');
  if (!faults.length) L.push('Нет.');
  for (const f of faults) L.push(`- ${f.at || ''} ${f.text}`);
  if (left?.length) { L.push('', '## Не убрано (проверить вручную, ничего не удалено без проверки)', ''); for (const c of left) L.push(`- ${c.path}/${c.id}: ${c.reason || 'нет связи'}`); }
  L.push('', '## Задания', '', '| Время | Задание | Итог | Шагов | Что сказал ИИ |', '|--|--|--|--|--|');
  for (const t of tasks) L.push(`| ${t.at} | ${t.title} | ${t.result} | ${t.steps} | ${String(t.summary || '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 200)} |`);
  L.push('');
  return L.join('\n');
}

/** Что поменялось на экране после действия — подсказка модели, чтобы она не нажимала то же самое ещё раз. */
export function screenChange(a, b) {
  if (!a || !b) return '';
  if (b.layer && b.layer !== a.layer) return `Открылась панель «${b.layer}» — её вкладки и кнопки в списке первыми, помечены «(в панели)». Не нажимай строку списка снова.`;
  if (a.layer && !b.layer) return 'Панель закрылась.';
  if (a.hash !== b.hash) return 'Открылся другой экран.';
  if (a.text === b.text && String(a.els) === String(b.els)) return 'Экран не изменился. Это действие ничего не дало — выбери другое (или report_problem, если сайт мешает).';
  return 'Экран обновился.';
}

/**
 * C136: выбор варианта списка. Модель часто шлёт длинную подпись («Объект — № 907 · …»),
 * а в списке короткий текст — и наоборот. Берём взаимное вхождение; при нескольких — самый длинный.
 * options: строки или { text|label, … }.
 */
export function pickOption(want, options) {
  const w = String(want || '').toLowerCase().trim();
  if (!w || !Array.isArray(options) || !options.length) return null;
  const rows = options.map((o) => {
    const t = String(typeof o === 'string' ? o : (o?.text ?? o?.label ?? '')).toLowerCase().trim();
    return t ? { o, t } : null;
  }).filter(Boolean);
  const hits = rows.filter((x) => x.t.includes(w) || w.includes(x.t));
  if (!hits.length) return null;
  hits.sort((a, b) => b.t.length - a.t.length || a.t.localeCompare(b.t, 'ru'));
  return hits[0].o;
}

/**
 * C129: следующий шаг задания с записью — с номером элемента. Нужен, когда модель ответила текстом вместо вызова:
 * панель открыта → первое пустое поле (или список), потом кнопка сохранения; панели нет → кнопка «+ …».
 */
export function nextHint(o) {
  const els = o?.els || [];
  const num = (line) => line.match(/^\[(\d+)\]/)?.[1];
  if (o?.layer) {
    const bad = (o.bad || [])[0];
    const empty = els.find((l) => bad && l.includes(`«${bad}»`) && /^\[\d+\] (поле|список)/.test(l)) || els.find((l) => /^\[\d+\] (поле|список) «[^»]+»[^=]*= «»/.test(l) && !/поиск/i.test(l));
    if (empty) {
      const n = num(empty); const name = empty.match(/«([^»]*)»/)?.[1] || '';
      return /^\[\d+\] список/.test(empty) ? `Следующий шаг: choose с n=${n} — выбери вариант в списке «${name}».` : `Следующий шаг: fill с n=${n} — заполни поле «${name}».`;
    }
    const save = els.find((l) => /^\[\d+\] кнопка «(Сохранить|Создать|Добавить|Готово)[^»]*» \(в панели\)/.test(l));
    if (save) return `Все поля заполнены. Следующий шаг: click с n=${num(save)} — кнопка сохранения. После сохранения вызови finish.`;
    return '';
  }
  const add = els.find((l) => /^\[\d+\] кнопка «\+/.test(l));
  return add ? `Следующий шаг: click с n=${num(add)} — открой форму новой записи.` : '';
}
