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
export function buildReport({ day, model, base = '', startedAt, now, tasks, findings, created, removed, renewals = 0, role = '' }) {
  const ok = tasks.filter((t) => t.result === 'получилось').length;
  const skipped = tasks.filter((t) => t.result === 'пропущено').length;
  const errs = groupFindings(findings.filter((f) => f.kind === 'ошибка'));
  const notes = groupFindings(findings.filter((f) => f.kind !== 'ошибка'));
  const L = [];
  L.push(`# ИИ-тестировщик — отчёт за ${day}`, '');
  L.push(`- Работал: ${duration(now - startedAt)}, модель: ${model}`);
  if (role) L.push(`- Роль: ${role} (что тестируется — менеджерский UX)`);
  if (base) L.push(`- База стенда: ${base}`);
  L.push(`- Заданий: ${tasks.length} (получилось ${ok}, не получилось ${tasks.length - ok - skipped}${skipped ? `, пропущено — раздел закрыт для роли: ${skipped}` : ''})`);
  L.push(`- Ошибок сайта: ${errs.length}, замечаний ИИ: ${notes.length}`);
  L.push(`- Создано тестовых записей: ${created.length}${removed != null ? `, убрано: ${removed}` : ''}`);
  if (renewals > 0) L.push(`- Токен доступа обновлён автоматически: ${renewals} раз (сессия не прерывалась)`);
  L.push('');
  L.push('## Ошибки сайта (нашла программа, без догадок ИИ)', '');
  if (!errs.length) L.push('Нет.');
  for (const e of errs) L.push(`- ${e.text}${e.count > 1 ? ` — ×${e.count}` : ''} · где: ${e.where || '—'} · задание: ${e.tasks.join(', ')}${e.shot ? ` · снимок: ${e.shot}` : ''}`);
  L.push('', '## Замечания ИИ (проверить глазами — бывают ложные)', '');
  if (!notes.length) L.push('Нет.');
  for (const e of notes) L.push(`- [${e.kind}] ${e.text}${e.count > 1 ? ` — ×${e.count}` : ''} · где: ${e.where || '—'} · задание: ${e.tasks.join(', ')}${e.shot ? ` · снимок: ${e.shot}` : ''}`);
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
