import { api, apiFile } from '../core/api.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { modal, toast, toastError } from '../ui/kit/index.js';

/*
 * QR-коды позиций склада (S) и изделий (P): печать наклеек и разбор считанного кода.
 * Сервер: POST /qr/print {items:[{type,id}], skip}, GET /qr/:code. Ссылка в коде: …/db/q/<КОД> → #q=<КОД>.
 */
const MAX_LABELS = 350;
const CODE_RE = /\b([SMP]-[0-9A-Z]{8})\b/i;

/** Из считанного текста (ссылка или сам код) → код вида S-7K3QX9TD или null. */
export function parseCode(text) {
  const m = CODE_RE.exec(String(text || '').toUpperCase());
  return m ? m[1] : null;
}

/** Окно «Распечатать QR»: сколько ячеек начатого листа пропустить → PDF. type: 'S' | 'P', ids — id позиций/изделий. */
export async function printQr(type, ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) { toast('Сначала отметьте строки.'); return null; }
  if (list.length > MAX_LABELS) { toast(`За раз можно напечатать не больше ${MAX_LABELS} наклеек — отметьте меньше строк.`); return null; }
  const skip = h('input', { type: 'number', min: 0, max: 34, step: 1, value: 0, inputmode: 'numeric', 'aria-label': 'Пропустить ячеек на начатом листе' });
  return modal({
    title: 'Распечатать QR',
    okText: 'Скачать PDF',
    body: h('div', null,
      h('p', null, `Наклеек: ${list.length}. Лист А4 — 35 наклеек (5×7).`),
      h('label', { class: 'field' }, h('span', null, 'Пропустить ячеек на начатом листе'), skip),
      h('p', { class: 'hint' }, 'Если лист уже начат, впишите, сколько ячеек занято. На чистом листе — 0.')),
    onOk: async () => {
      const n = Math.floor(Number(skip.value) || 0);
      if (n < 0 || n > 34) throw new Error('Ячеек можно пропустить от 0 до 34.');
      await apiFile('/qr/print', { method: 'POST', body: { items: list.map((id) => ({ type, id })), skip: n }, fallback: 'QR-наклейки.pdf' });
      return true;
    },
  });
}

/** Кнопка «Распечатать QR» для карточки. */
export const qrPrintAction = (type) => ({ label: 'Распечатать QR', more: true, title: 'Наклейка с QR-кодом этой записи (PDF)', run: async (row) => { await printQr(type, [row.id]); return false; } });

/** Действие для панели над отмеченными строками (list.js bulk.extra). */
export const qrBulkAction = (type) => ({ label: 'Распечатать QR', run: (ids) => { printQr(type, ids); } });

/** Разбор кода на сервере. Результат: { ok, data } | { ok:false, reason: 'bad'|'notfound'|'deleted'|'net', message }. */
export async function lookupCode(text) {
  const code = parseCode(text);
  if (!code) return { ok: false, reason: 'bad', message: 'Это не наш код. Наведите на наклейку data-core.' };
  try {
    const data = await api('/qr/' + encodeURIComponent(code));
    if (data.deleted) return { ok: false, reason: 'deleted', message: 'Позиция удалена', data };
    return { ok: true, data, code };
  } catch (e) {
    if (e?.status === 404 || e?.status === 400) return { ok: false, reason: 'notfound', message: 'Код не найден' };
    return { ok: false, reason: 'net', message: 'Нет связи. Повторите, когда появится связь.', error: e };
  }
}

/** Маршрут #q=<код> (не мобильный склад): позиция → карточка склада, изделие → карточка изделия. */
export async function routeCode(text, fallbackSection) {
  const r = await lookupCode(text);
  if (!r.ok) {
    if (r.reason === 'net') toastError(r.error, 'открыть код'); else toast(r.message);
    go(fallbackSection, {}, { replace: true });
    return;
  }
  if (r.data.entityType === 'P') go('products', { open: r.data.id }, { replace: true });
  else go('stock', { open: r.data.id }, { replace: true });
}
