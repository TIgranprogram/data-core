import { h } from '../core/dom.js';

/** Единый набор бейджей статусов (CANON §2). Разделы используют только его. */
export const SUPPLY_STATUS = {
  in_progress: { label: 'Ожидает', tone: 'dim' },
  requested: { label: 'Заказать', tone: 'primary' },
  ordered: { label: 'В работе', tone: 'info' },
  paid: { label: 'Оплачено', tone: 'warn' },
  received: { label: 'Получено', tone: 'ok' },
  cancelled: { label: 'Отменено', tone: 'danger' },
};
/** Ключ статуса заявки с учётом «оплачено» (status=ordered + paid). */
export const supplyKey = (r) => (r.status === 'ordered' && r.paid ? 'paid' : r.status || 'requested');

export const STOCK_STATUS = {
  ok: { label: 'В норме', tone: 'ok' },
  low: { label: 'К закупке', tone: 'warn' },
  none: { label: 'Нет', tone: 'danger' },
};

export const PRIORITY = { urgent: { label: 'Срочно', tone: 'danger' }, normal: { label: 'Обычный', tone: 'dim' }, low: { label: 'Низко', tone: 'dim' } };

export function badge(map, key) {
  const s = map[key] || { label: key || '—', tone: 'dim' };
  return h('span', { class: 'badge ' + s.tone }, s.label);
}

/** Статус в спокойном виде (точка + текст) — для строк списков и очередей. */
export const status = badge;
