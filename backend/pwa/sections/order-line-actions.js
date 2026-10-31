import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { toast } from '../ui/toast.js';
import { modal } from '../ui/dialog.js';
import { STAGE } from './order-stage.js';

/**
 * Этап 3 заказов: отмена и перенос позиции, перенос договора в другой заказ, возврат на прежний этап.
 * Все окна — до трёх полей. Зависимости (брони, задачи) показываются списком, снять их — галочкой.
 * Менеджер меняет позиции до «Готово к отгрузке», дальше только админ (сервер проверяет сам).
 */

const changed = () => window.dispatchEvent(new CustomEvent('data-changed'));
const reasonField = (hint) => {
  const ta = h('textarea', { rows: 2, maxlength: 500, required: true, placeholder: hint });
  return { ta, el: h('label', { class: 'field' }, h('span', null, 'Причина'), ta) };
};
const list = (title, items) => items.length ? h('div', { class: 'so-sec' }, h('div', { class: 'section-title' }, `${title} (${items.length})`), h('ul', { class: 'timeline' }, ...items.map((x) => h('li', null, x.label, x.status ? h('span', { class: 'muted' }, ' · ' + x.status) : null)))) : null;

/** Можно ли менять позиции договора этому пользователю: админ всегда, менеджер — до «Готово к отгрузке». */
export const canChangeLines = (o) => session.role === 'admin' || (session.canEditOrders && ['new', 'production'].includes(o.stage || 'new'));

async function depsOf(o, l) {
  const d = await api(`/salesorders/${o.id}/dependencies`);
  return (d.lines || []).find((x) => String(x.id) === String(l.id)) || { blockers: [], reservations: [], designTasks: [], workTasks: [], supplyRequests: [], passports: [] };
}

/** «Отменить позицию»: причина + список зависимостей с галочкой «снять». */
export async function cancelLine(l, o) {
  const d = await depsOf(o, l);
  if (d.blockers?.length) {
    await modal({ title: 'Позицию нельзя отменить', okText: 'Понятно', cancelText: 'Закрыть', body: h('div', null, h('p', null, `«${l.title}»`), h('ul', null, ...d.blockers.map((b) => h('li', null, b)))) });
    return null;
  }
  const hasDeps = d.reservations.length || d.designTasks.length || d.workTasks.length;
  const why = reasonField('Например: загрузилась не в тот договор');
  const cascade = h('input', { type: 'checkbox', checked: true });
  const saved = await modal({
    title: 'Отменить позицию', okText: 'Отменить позицию', danger: true, wide: true,
    body: h('div', null,
      h('p', null, `«${l.title}» останется в договоре серой строкой с причиной. В суммы и производство она не пойдёт.`),
      why.el,
      hasDeps ? h('div', null,
        list('Брони', d.reservations), list('Задачи проектирования', d.designTasks), list('Задания «В работе»', d.workTasks),
        h('label', { class: 'check' }, cascade, ' Снять брони и закрыть задачи')) : null,
      list('Заявки снабжения (останутся, проверьте вручную)', d.supplyRequests), list('Паспорта (останутся)', d.passports)),
    onOk: async () => {
      if (why.ta.value.trim().length < 3) throw new Error('Укажите причину отмены');
      return api(`/incomes/${l.id}/cancel`, { method: 'POST', body: { reason: why.ta.value.trim(), cascade: hasDeps ? cascade.checked : false } });
    },
  });
  if (saved) { toast('Позиция отменена'); changed(); }
  return saved;
}

export async function restoreLine(l) {
  const r = await api(`/incomes/${l.id}/restore-cancelled`, { method: 'POST' });
  toast('Позиция возвращена'); changed();
  return r;
}

/** «Перенести в другой договор»: выбор договора; брони, задачи, заявки и паспорта переезжают вместе с позицией. */
export async function moveLine(l, o) {
  const d = await depsOf(o, l);
  if (d.blockers?.length) {
    await modal({ title: 'Позицию нельзя перенести', okText: 'Понятно', cancelText: 'Закрыть', body: h('ul', null, ...d.blockers.map((b) => h('li', null, b))) });
    return null;
  }
  const res = await api('/salesorders/lookup', { query: { filter: 'active' } });
  const items = (res.items || []).filter((x) => String(x.id) !== String(o.id));
  if (!items.length) { toast('Других договоров в работе нет'); return null; }
  const sel = h('select', null, ...items.map((x) => h('option', { value: x.id }, `Договор ${x.orderNo || '—'}${x.customer ? ' · ' + x.customer : ''}${x.productionNo ? ' · заказ ' + x.productionNo : ''}`)));
  const saved = await modal({
    title: 'Перенести в другой договор', okText: 'Перенести', wide: true,
    body: h('div', null,
      h('p', null, `«${l.title}»: вместе с позицией переедут брони, задачи проектирования и работы, заявки и паспорта.`),
      h('label', { class: 'field' }, h('span', null, 'В какой договор'), sel),
      list('Что поедет', [...d.reservations, ...d.designTasks, ...d.workTasks, ...d.supplyRequests, ...d.passports])),
    onOk: () => api(`/incomes/${l.id}/move`, { method: 'POST', body: { toOrderId: sel.value } }),
  });
  if (saved) { toast('Позиция перенесена'); changed(); }
  return saved;
}

/** «Перенести в другой заказ»: договор из заказа производства в другой существующий. */
export async function moveContract(o) {
  const res = await api('/production-orders', { query: { filter: 'active', limit: 100 } });
  const items = (res.items || []).filter((x) => String(x.key) !== String(o.productionNo));
  if (!items.length) { toast('Других заказов в работе нет'); return null; }
  const sel = h('select', null, ...items.map((x) => h('option', { value: x.key }, `Заказ ${x.key}${(x.customers || []).length ? ' · ' + x.customers.join(', ') : ''}`)));
  const saved = await modal({
    title: 'Перенести в другой заказ', okText: 'Перенести', wide: true,
    body: h('div', null,
      h('p', null, `Договор ${o.orderNo || ''} уйдёт из заказа ${o.productionNo} вместе с позициями. Если по нему уже были выдачи со склада или отгрузки, перенос не получится.`),
      h('label', { class: 'field' }, h('span', null, 'В какой заказ'), sel)),
    onOk: () => api(`/production-orders/${encodeURIComponent(o.productionNo)}/move-contract`, { method: 'POST', body: { contractId: o.id, toProductionNo: sel.value } }),
  });
  if (saved) { toast('Договор перенесён'); changed(); }
  return saved;
}

/** «Вернуть на этап…» — только админ, с причиной (шаг назад по воронке). */
export async function stageBack(o) {
  const order = ['new', 'production', 'ready', 'partly', 'shipped', 'closed'];
  const from = order.indexOf(o.stage);
  const opts = o.stage === 'cancelled' ? order : order.slice(0, Math.max(0, from));
  if (!opts.length) { toast('Назад возвращать некуда'); return null; }
  const sel = h('select', null, ...opts.map((k) => h('option', { value: k }, STAGE[k]?.label || k)));
  const why = reasonField('Почему возвращаем');
  const saved = await modal({
    title: 'Вернуть на прежний этап', okText: 'Вернуть',
    body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Этап'), sel), why.el),
    onOk: () => {
      if (why.ta.value.trim().length < 3) throw new Error('Укажите причину возврата');
      return api(`/salesorders/${o.id}`, { method: 'PATCH', body: { stage: sel.value, stageReason: why.ta.value.trim() } });
    },
  });
  if (saved) { toast('Этап изменён'); changed(); }
  return saved;
}
