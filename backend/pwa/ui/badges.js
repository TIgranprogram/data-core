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

/** Направление затрат (backend supply/cost-center.ts): куда пошла закупка — для «Денег». */
export const COST_CENTER = { workshop: 'Цех', office: 'Офис', smr: 'СМР', order: 'Под заказ' };
export const PRIORITY = { urgent: { label: 'Срочно', tone: 'danger' }, normal: { label: 'Обычный', tone: 'dim' }, low: { label: 'Низко', tone: 'dim' } };

/** Стадии задачи проектирования (ПРЖ-5). */
export const DESIGN_STATUS = { queue: { label: 'На распределении', tone: 'dim' }, work: { label: 'В работе', tone: 'info' }, done: { label: 'Завершены', tone: 'ok' }, paused: { label: 'Приостановлены', tone: 'warn' }, cancelled: { label: 'Отменены', tone: 'dim' } };
/** Приоритет заказа и задачи проектирования (ПРЖ): обычный на экране не показываем. */
export const ORDER_PRIORITY = { urgent: { label: 'Срочно', tone: 'danger' }, high: { label: 'Высокий', tone: 'warn' }, normal: { label: 'Обычный', tone: 'dim' }, low: { label: 'Низкий', tone: 'dim' } };

export function badge(map, key) {
  const s = map[key] || { label: key || '—', tone: 'dim' };
  return h('span', { class: 'badge ' + s.tone }, s.label);
}

/** Статус в спокойном виде (точка + текст) — для строк списков и очередей. */
export const status = badge;
