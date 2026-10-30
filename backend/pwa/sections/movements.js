import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, dateTime, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { confirmDlg, modal } from '../ui/dialog.js';
import { targetNote, targetShort } from '../ui/target-picker.js';
import { toast, toastError } from '../ui/toast.js';

/** Раздел «Движения» (PRODUCT §2): журнал приходов/списаний по всем позициям, отмена ошибочного движения. */
const TYPE_LABEL = { in: 'Приход', out: 'Списание', adjust: 'Корректировка', transfer: 'Перемещение' };
const TYPE_TONE = { in: 'ok', out: 'warn', adjust: 'info', transfer: 'dim' };

/** Подпись дня: «Сегодня», «Вчера», «14 октября», в другом году — с годом. */
export function dayLabel(d) {
  const x = new Date(d); const now = new Date();
  const key = (v) => v.toISOString().slice(0, 10);
  if (key(x) === key(now)) return 'Сегодня';
  if (key(x) === key(new Date(now.getTime() - 86400000))) return 'Вчера';
  return x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(x.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export const moveLabel = (m) => (m.cancelOf ? 'Отмена' : TYPE_LABEL[m.type] || m.type);
const typeBadge = (m) => h('span', { class: 'badge ' + (m.cancelOf ? 'dim' : TYPE_TONE[m.type] || 'dim') }, moveLabel(m));
const deltaCell = (m) => h('span', { class: 'num ' + (m.delta > 0 ? 'pos' : m.delta < 0 ? 'neg' : '') }, `${m.delta > 0 ? '+' : ''}${qty(m.delta)} ${m.unit || ''}`.trim());

/** Исправить списание (СМ.5): верное количество; старое отменяется, новое проводится с теми же «кому» и «под что». */
export async function correctMovement(m) {
  const input = h('input', { inputmode: 'decimal', value: String(Math.abs(m.delta ?? m.qty)) });
  const qtyNow = () => Number(input.value.replace(',', '.'));
  const ok = await modal({ title: 'Исправить списание', okText: 'Исправить', body: h('div', null, h('p', { class: 'hint' }, `${m.materialName || m.name || ''}. Укажите, сколько выдано на самом деле.`), h('label', { class: 'field' }, h('span', null, `Количество${m.unit ? ', ' + m.unit : ''}`), input)), onOk: () => { if (!(qtyNow() > 0)) throw new Error('Укажите количество больше нуля'); return true; } });
  if (!ok) return null;
  try { const item = await api(`/stock/movements/${m.id}/correct`, { method: 'POST', body: { qty: qtyNow() } }); toast('Списание исправлено'); return item; } catch (e) { toastError(e); return null; }
}

/** Отменить движение (подтверждение → обратное движение). Возвращает позицию склада после отмены или null. */
export async function cancelMovement(m) {
  const what = `${moveLabel(m)} ${qty(Math.abs(m.delta))} ${m.unit || ''} «${m.materialName}» от ${date(m.date)}`;
  if (!(await confirmDlg('Отменить движение?', `${what}. Будет проведено обратное движение, остаток вернётся как было. Запись останется в журнале с пометкой «отменено».`, { okText: 'Отменить движение', danger: true }))) return null;
  try {
    const item = await api(`/stock/movements/${m.id}/cancel`, { method: 'POST' });
    toast('Движение отменено');
    return item;
  } catch (e) { toastError(e); return null; }
}

export const movements = {
  id: 'movements',
  title: 'Движения',
  entityType: 'StockMovement',
  historyLabels: { 'stock.movement.cancelled': 'Отменено' },
  get: async (id) => {
    const r = await api('/stock/movements', { query: { id, limit: 1 } });
    if (!r.items[0]) throw new Error('Движение не найдено');
    return r.items[0];
  },

  list: {
    path: '/stock/movements',
    sortDefault: '-date',
    createLabel: false,
    searchPlaceholder: 'Поиск: позиция или примечание…',
    emptyText: 'Движений пока нет. Приход и списание делаются в карточке позиции на «Складе».',
    filters: [
      { key: 'type', label: 'Операция', type: 'chips', options: () => [{ value: 'in', label: 'Приход' }, { value: 'out', label: 'Списание' }, { value: 'adjust', label: 'Корректировка' }] },
      { key: 'from', label: 'С даты', short: 'с', type: 'date' },
      { key: 'to', label: 'По дату', short: 'по', type: 'date' },
      { key: 'materialId', label: 'Позиция', type: 'hidden' },
    ],
    hints: {
      '': 'Все приходы и списания по дням. Ошибочное движение — «Отменить» в строке: проведётся обратное, история сохранится.',
      in: 'Поступления на склад.', out: 'Выдача и расход.', adjust: 'Инвентаризация и ручные исправления остатка.',
    },
    groupBy: (m) => dayLabel(m.date),
    groupTotal: (ms) => {
      const plus = ms.filter((m) => m.delta > 0 && !m.cancelledAt).length, minus = ms.filter((m) => m.delta < 0 && !m.cancelledAt).length;
      return h('span', { class: 'g-tot' }, plus ? h('span', { class: 'pos' }, `приход ${plus}`) : null, minus ? h('span', { class: 'neg' }, `расход ${minus}`) : null);
    },
    rowAction: (m) => (m.canCancel ? [...(m.type === 'out' && !m.reservationId ? [{ label: 'Исправить', title: 'Указать верное количество', run: (row) => correctMovement(row) }] : []), { label: 'Отменить', title: 'Провести обратное движение', run: (row) => cancelMovement(row) }] : null),
    columns: [
      { key: 'date', label: 'Дата', sort: 'date', cls: 'num md-hide', render: (m) => date(m.date) },
      { key: 'materialName', label: 'Позиция', cls: 'clip', render: (m) => h('span', { title: m.materialName }, m.materialName) },
      { key: 'type', label: 'Операция', sort: 'type', cls: 'nowrap', render: (m) => h('span', null, typeBadge(m), m.cancelledAt ? h('span', { class: 'badge dim', style: { marginLeft: '4px' } }, 'отменено') : null) },
      { key: 'delta', label: 'Кол-во', cls: 'right', render: deltaCell },
      { key: 'issuedTo', label: 'Кому / под что', cls: 'clip md-hide', render: (m) => { const tn = targetNote(m); return h('span', { title: m.issuedTo || '' }, tn, tn && m.issuedTo ? ' · ' : '', m.issuedTo || ''); } },
      { key: 'note', label: 'Примечание', cls: 'clip md-hide', render: (m) => h('span', { title: m.note || '' }, m.note || '') },
      { key: 'createdBy', label: 'Кто', cls: 'nowrap', render: (m) => m.createdBy || (m.fromSheet ? 'из таблицы' : '') },
    ],
    card: {
      title: (m) => m.materialName,
      sub: (m) => [date(m.date), moveLabel(m), targetShort(m), m.issuedTo && 'кому: ' + m.issuedTo, m.note].filter(Boolean).join(' · '),
      side: (m) => [deltaCell(m), m.cancelledAt ? h('span', { class: 'badge dim' }, 'отменено') : null],
    },
  },

  card: {
    heading: (m) => `${moveLabel(m)}: ${m.materialName}`,
    subheading: (m) => dateTime(m.date),
    view: (m) => [
      ['Операция', typeBadge(m)],
      ['Количество', deltaCell(m)],
      ['Остаток', m.qtyBefore != null ? `${qty(m.qtyBefore)} → ${qty(m.qtyAfter)}` : ''], // ФИ.5: было → стало
      ['Позиция', h('a', { href: '#stock?open=' + m.materialId, title: 'Открыть позицию склада' }, m.materialName + ' →')],
      ['Под что', targetNote(m)],
      ['Кому выдано', m.issuedTo],
      ['По брони', m.reservationId ? h('a', { href: '#ops?mode=reserve' }, 'выдано по брони — брони →') : ''],
      ['Под заказ', m.salesOrderId ? h('a', { href: '#salesorders?open=' + m.salesOrderId }, 'открыть заказ →') : ''],
      ['Все движения позиции', h('a', { href: '#movements?materialId=' + m.materialId }, 'показать →')],
      ['Операция', m.batchId ? 'часть операции склада (несколько позиций разом)' : ''],
      ['Примечание', m.note],
      ['Кто провёл', m.createdBy],
      ['Источник', m.fromSheet ? 'Google-таблица (история; остаток по ней не менялся)' : ''],
      ['Отменено', m.cancelledAt ? dateTime(m.cancelledAt) : ''],
    ],
    actions: (m) => [
      m.canCancel && m.type === 'out' && !m.reservationId && { label: 'Исправить списание', primary: true, run: async (row, ctx) => { if (await correctMovement(row)) { ctx.changed(); ctx.reload(); } } },
      m.canCancel && { label: 'Отменить движение', run: async (row, ctx) => { if (await cancelMovement(row)) { ctx.changed(); ctx.reload(); } } },
      m.batchId && !m.cancelledAt && { label: 'Отменить всю операцию', run: async (row, ctx) => { await api(`/stock/batch/${row.batchId}/cancel`, { method: 'POST' }); toast('Операция отменена целиком'); ctx.changed(); ctx.reload(); } },
      { label: 'Открыть позицию', run: (row) => go('stock', { open: row.materialId }) },
    ],
  },

  searchRow: (m) => ({ title: m.materialName, sub: [date(m.date), moveLabel(m)].join(' · '), side: deltaCell(m) }),
  open: (id) => go('movements', { open: id }),
};
