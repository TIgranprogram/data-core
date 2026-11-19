/** Диагностика без данных форм: только ограниченный след действий и технических маршрутов в памяти. */
export const scrubDiagnostic = (value) => String(value ?? '')
  .replace(/Bearer\s+[\w\-.~+/=]+/gi, 'Bearer ***')
  .replace(/kppd_[\w-]+/g, 'kppd_***')
  .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '***')
  .replace(/\?[^\s'"?]*=[^\n'"]*?((?::\d+){1,2}\)?)?(?=['"\n]|$)/g, '$1')
  .replace(/\?[^\s'"<>()]*/g, (q) => q.includes('=') ? '' : q);

/** Ожидаемый ответ формы тоже нужен для диагностики; auth и отправка журнала не порождают новый отчёт. */
export function reportableHttpError(err, path) {
  if (err?.viewAs) return false;
  const status = Number(err?.status);
  return status >= 400 && status <= 599 && !!path
    && !/(?:^|\/)auth(?:\/|$|\?)/.test(path)
    && !/(?:^|\/)client-errors(?:\/|$|\?)/.test(path);
}

const word = (value) => /^[a-z][a-z0-9_-]{0,59}$/i.test(value || '') && !/kppd_|bearer|^eyJ/i.test(value) ? value : '';
const technicalId = (value) => {
  if (!value) return '';
  if (/^[a-f0-9]{24}$/i.test(value) || /^\d{1,12}$/.test(value)) return value;
  if (/^(?:undefined|null|\[object Object\])$/.test(value)) return value;
  if (/^c(?::|%3a|%253a)/i.test(value)) return 'customer-name-hidden';
  return `invalid-id(length=${String(value).length})`;
};

export function diagnosticRoute(hash = '') {
  const [section, query = ''] = String(hash).replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  return [word(section) || 'home', ...['of', 'tab'].flatMap((key) => word(params.get(key)) ? [`${key}=${word(params.get(key))}`] : []),
    technicalId(params.get('open')) ? `open=${technicalId(params.get('open'))}` : ''].filter(Boolean).join(' ');
}

/** Путь сохраняется без query; текстовый ключ заказчика не раскрывает его имя. */
export function diagnosticPath(value = '') {
  return scrubDiagnostic(String(value).split(/[?#]/)[0]).replace(/(\/partners\/)([^/]+)/, (_, prefix, id) => {
    let decoded = id;
    try { decoded = decodeURIComponent(id); } catch { /* некорректный URL тоже диагностируется по форме ключа */ }
    return prefix + technicalId(decoded);
  });
}

export function diagnosticHttpMessage(err) {
  const status = Number(err?.status);
  if (!(status >= 400 && status < 500)) return scrubDiagnostic(err?.message ?? err ?? '');
  // Сервер может повторить значение поля в тексте 4xx. Сохраняем только известную безопасную причину.
  const message = String(err?.message || '');
  return /^Некорректный id (?:контрагента|изделия|позиции|заказа)$/.test(message)
    ? message : `Запрос отклонён: HTTP ${status}`;
}

export const CONTEXT_MARK = '\nКонтекст действий:\n';
export function withoutActionTrace(body) {
  const stack = body.stack?.split(CONTEXT_MARK)[0];
  return { ...body, stack: stack || undefined };
}

/** Сохраняется только название стандартного действия, а не подпись записи/ссылки или введённый текст. */
export function diagnosticClick(target) {
  if (!target?.closest || target.closest('input,textarea,select,option,[role="option"],[role="combobox"],[contenteditable]')) return '';
  const control = target.closest('button,a,summary,[role="tab"]');
  if (!control) return '';
  const href = control.getAttribute('href');
  if (href?.startsWith('#')) return `ссылка → ${diagnosticRoute(href)}`;
  const label = control.getAttribute('aria-label') || control.textContent || '';
  const known = /^(Выбрать из каталога|Выбрать изделие|Сменить изделие|Привязать изделие|Сохранить|Отмена|Закрыть|Назад|Вперёд|Повторить|Обновить каталог|Да, верно|Договор|Позиция|Заказ|Паспорт|Документы|Сопоставление|Состав и работы|Файлы|Ещё)(?:\b|\s|$)/u;
  // В JS \b не разделяет кириллицу; пробел/конец также допускают обычную подпись и счётчик секции.
  const action = label.trim().match(known)?.[1];
  return action || (control.tagName === 'SUMMARY' ? 'раскрыть раздел' : control.getAttribute('role') === 'tab' ? 'выбрать вкладку' : control.tagName === 'A' ? 'ссылка' : 'кнопка');
}

export function createErrorContext(limit = 12) {
  const rows = [];
  const resets = new Set();
  let generation = 0;
  return {
    get generation() { return generation; },
    onClear(fn) { resets.add(fn); return () => resets.delete(fn); },
    add(action, hash) {
      const line = `${String(action).slice(0, 100)} · ${diagnosticRoute(hash)}`;
      if (rows.at(-1) !== line) rows.push(line);
      if (rows.length > limit) rows.splice(0, rows.length - limit);
    },
    text(hash) { return [...rows, `сбой · ${diagnosticRoute(hash)}`].join('\n').slice(-1800); },
    clear() { rows.length = 0; generation++; resets.forEach((fn) => fn()); },
  };
}

export const errorContext = createErrorContext();
let installed = false;
export function startErrorContext() {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined') return;
  installed = true;
  document.addEventListener('click', (event) => {
    const action = diagnosticClick(event.target);
    if (action) errorContext.add(action, location.hash);
  }, true);
  window.addEventListener('hashchange', () => errorContext.add('переход', location.hash));
}
