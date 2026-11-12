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

/** Отчёт за день — Markdown на языке пользователя. */
export function buildReport({ day, model, base = '', startedAt, now, tasks, findings, created, removed, renewals = 0, role = '', run = null, faults = [], left = null }) {
  const ok = tasks.filter((t) => t.result === 'получилось').length;
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
  L.push(`- Заданий: ${tasks.length} (получилось ${ok}, не получилось ${tasks.length - ok}) — итог «получилось» сообщает модель, это не приёмка`);
  L.push(`- Ошибок сайта: ${errs.length}, замечаний ИИ: ${notes.length}`);
  L.push(`- Отказов и медленных ответов (проверить): ${refusals.length} · сбоев тестировщика: ${faults.length}`);
  L.push(`- Создано тестовых записей: ${created.length}${removed != null ? `, убрано: ${removed}` : ''}${left?.length ? `, оставлено: ${left.length}` : ''}`);
  L.push(`- Токен доступа обновлён автоматически: ${renewals} раз`);
  L.push('');
  L.push('## Ошибки сайта (подтвердила программа: 5xx, сбой страницы, служебный текст на экране)', '');
  if (!errs.length) L.push('Нет.');
  for (const e of errs) L.push(line(e));
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
