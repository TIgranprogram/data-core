import { api, apiFile, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, parseNum, qty } from '../core/format.js';
import { patch } from '../core/router.js';
import { confirmDlg } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { failBlock } from '../ui/busy.js';
import { emptyState } from '../ui/empty.js';

/**
 * Отгрузки заказа и история (ТЗ ОТГ/ИСТ). Блоки в карточке заказа + правая панель «Отгрузить» (`of=shipdo&open=<orderId>`).
 * Сервер: GET/POST /salesorders/:id/shipments, DELETE /shipments/:id, GET /shipments/:id/pdf, GET /salesorders/:id/history.
 */
export const canShip = () => ['admin', 'manager'].includes(session.role) || session.user?.isOwner === true;
const changed = () => window.dispatchEvent(new CustomEvent('data-changed'));
const pdf = (s) => apiFile(`/shipments/${s.id}/pdf`, { fallback: `${s.number || 'otgruzka'}.pdf` }).catch((e) => toastError(e, 'открыть накладную'));

/** Блок «Отгрузки» в карточке заказа. */
export function shipmentsBlock(order, onChange) {
  const body = h('div', null, h('div', { class: 'muted' }, 'Загрузка…'));
  const load = () => api(`/salesorders/${order.id}/shipments`).then((d) => {
    const items = d.items || [];
    const open = ['closed', 'cancelled'].includes(order.stage) ? false : canShip();
    body.replaceChildren(
      d.legacyShipped ? h('p', { class: 'hint' }, 'Отгружено до учёта — остаток по позициям не считается.') : null,
      items.length ? h('ul', { class: 'timeline' }, ...items.map((s) => h('li', null,
        h('span', { class: 'when' }, date(s.date)), h('b', null, s.number || ''),
        h('span', null, `${qty(s.qtyTotal)} шт. · ${(s.lines || []).map((l) => `${l.title} ×${qty(l.qty)}`).join(', ')}`),
        h('span', { class: 'muted' }, [s.who?.name, s.receiver && 'принял: ' + s.receiver, s.docNo && '№ ' + s.docNo, s.reason && 'причина: ' + s.reason, s.note].filter(Boolean).join(' · ')),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => pdf(s) }, 'Накладная'),
        canShip() ? h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: async (e) => {
          if (!(await confirmDlg(`Отменить ${s.number || 'отгрузку'}?`, 'Остаток по позициям вернётся, этап заказа пересчитается.', { okText: 'Да, отменить', danger: true }))) return;
          const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
          try { await api(`/shipments/${s.id}`, { method: 'DELETE' }); toast('Отгрузка отменена'); changed(); onChange?.(); } catch (er) { toastError(er, 'отменить отгрузку'); b.classList.remove('is-busy'); b.disabled = false; }
        } }, 'Отменить') : null)))
        : (d.legacyShipped ? null : emptyState({ title: 'Отгрузок пока нет', hint: open ? 'Нажмите «Отгрузить» — выберите позиции и количество.' : '' })),
      open ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => patch({ of: 'shipdo', open: order.id }, { replace: false }) }, 'Отгрузить')) : null);
  }).catch((e) => body.replaceChildren(failBlock(e)));
  load();
  return h('div', { class: 'so-sec' }, h('div', { class: 'section-title' }, 'Отгрузки'), body);
}

const TYPES = [['', 'Все'], ['change', 'Изменения'], ['line', 'Позиции'], ['design', 'Проектирование'], ['passport', 'Паспорта'], ['shipment', 'Отгрузки'], ['stock', 'Склад'], ['payment', 'Оплаты']];

/** Блок «История» заказа: лента с фильтром по типу и поиском. Грузится по раскрытию. */
export function historyBlock(order) {
  let type = '', search = '', t = null, loaded = false;
  const list = h('div', null);
  const chips = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Тип событий' });
  const q = h('input', { type: 'search', placeholder: 'Поиск по истории…', 'aria-label': 'Поиск по истории', oninput: (e) => { search = e.target.value.trim(); clearTimeout(t); t = setTimeout(load, 300); } });
  const drawChips = () => chips.replaceChildren(...TYPES.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(type === k), class: type === k ? 'active' : '', onclick: () => { type = k; drawChips(); load(); } }, label)));
  function load() {
    list.replaceChildren(h('div', { class: 'muted' }, 'Загрузка…'));
    api(`/salesorders/${order.id}/history`, { query: { type, search } }).then((d) => {
      const items = d.items || [];
      list.replaceChildren(items.length ? h('ul', { class: 'timeline' }, ...items.map((x) => h('li', null,
        h('span', { class: 'when' }, date(x.at)), h('b', null, x.title || ''), x.text ? h('span', null, x.text) : null, h('span', { class: 'muted' }, x.who || '')))) :
        emptyState({ title: 'Событий нет', hint: type || search ? 'Смените тип или очистите поиск.' : 'Здесь появятся изменения, отгрузки, паспорта и выдачи со склада.' }));
    }).catch((e) => list.replaceChildren(failBlock(e)));
  }
  drawChips();
  const det = h('details', { class: 'so-sec', ontoggle: () => { if (det.open && !loaded) { loaded = true; load(); } } },
    h('summary', { class: 'section-title' }, 'История заказа'), chips, h('div', { class: 'field' }, q), list);
  return det;
}

/** Правая панель «Отгрузить». */
function form(order, ctx) {
  const root = h('div', null, h('div', { class: 'muted' }, 'Загрузка…'));
  api(`/salesorders/${order.id}/shipments`).then((d) => {
    const rem = new Map((d.remaining || []).map((x) => [String(x.incomeId), x]));
    const lines = (order.lines || []).filter((l) => (rem.get(String(l.id))?.left ?? l.left ?? 0) > 0);
    if (!lines.length) { root.replaceChildren(emptyState({ title: 'Отгружать нечего', hint: 'Остаток по всем позициям нулевой или у позиций не указано количество — укажите его в позиции.' })); return; }
    const rows = lines.map((l) => {
      const left = rem.get(String(l.id))?.left ?? l.left;
      const inp = h('input', { type: 'text', inputmode: 'decimal', value: String(left), 'aria-label': 'Сколько: ' + l.title });
      const on = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Отгрузить: ' + l.title });
      return { l, left, inp, on };
    });
    const date0 = h('input', { type: 'date', value: isoDay() });
    const recv = h('input', { maxlength: 200, placeholder: 'Кто принял' });
    const docNo = h('input', { maxlength: 100, placeholder: 'УПД, ТН…' });
    const reason = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Почему не весь остаток' });
    const reasonBox = h('label', { class: 'field' }, h('span', null, 'Причина (обязательна, если отгружен не весь остаток)'), reason);
    const note = h('input', { maxlength: 500, placeholder: 'Примечание' });
    const picked = () => rows.filter((r) => r.on.checked).map((r) => ({ incomeId: r.l.id, qty: parseNum(r.inp.value) || 0, left: r.left }));
    const partial = () => rows.some((r) => !r.on.checked || (parseNum(r.inp.value) || 0) < r.left);
    const sync = () => { reasonBox.hidden = !partial(); };
    rows.forEach((r) => { r.inp.addEventListener('input', sync); r.on.addEventListener('change', sync); });
    sync();
    const send = h('button', { type: 'button', class: 'btn btn-primary', onclick: async (e) => {
      const ls = picked().filter((x) => x.qty > 0);
      if (!ls.length) { toastError(new Error('Выберите позиции и впишите «Сколько».')); return; }
      if (ls.some((x) => x.qty > x.left)) { toastError(new Error('Больше остатка отгрузить нельзя.')); return; }
      if (partial() && !reason.value.trim()) { toastError(new Error('Впишите причину: отгружается не весь остаток.')); reason.focus(); return; }
      const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
      try {
        const s = await api(`/salesorders/${order.id}/shipments`, { method: 'POST', body: { date: date0.value || isoDay(), lines: ls.map(({ incomeId, qty: q }) => ({ incomeId, qty: q })),
          ...(reason.value.trim() ? { reason: reason.value.trim() } : {}), ...(note.value.trim() ? { note: note.value.trim() } : {}), ...(docNo.value.trim() ? { docNo: docNo.value.trim() } : {}), ...(recv.value.trim() ? { receiver: recv.value.trim() } : {}) } });
        toast('Отгрузка записана'); changed();
        if (s?.id) pdf(s);
        ctx.close();
      } catch (er) { toastError(er, 'отгрузить'); b.classList.remove('is-busy'); b.disabled = false; }
    } }, 'Отгрузить');
    root.replaceChildren(
      h('table', { class: 'so-lines' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Позиция'), h('th', { class: 'num' }, 'Осталось'), h('th', null, 'Сколько'))),
        h('tbody', null, ...rows.map((r) => h('tr', null, h('td', null, r.on), h('td', null, r.l.title), h('td', { class: 'num nowrap' }, `${qty(r.left)} ${r.l.unit || ''}`), h('td', null, r.inp))))),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, 'Дата'), date0), h('label', { class: 'field' }, h('span', null, 'Получатель'), recv),
        h('label', { class: 'field' }, h('span', null, '№ документа'), docNo), h('label', { class: 'field' }, h('span', null, 'Примечание'), note), reasonBox),
      h('div', { class: 'actions' }, send, h('button', { type: 'button', class: 'btn', onclick: () => ctx.close() }, 'Отмена')));
  }).catch((e) => root.replaceChildren(failBlock(e)));
  return root;
}

export const shipdo = {
  id: 'shipdo',
  title: 'Отгрузка',
  get: async (id) => {
    if (!canShip()) throw new Error('Отгрузку записывают администратор и менеджер.');
    return api(`/salesorders/${id}`);
  },
  card: {
    heading: (r) => `Отгрузка · заказ № ${r.orderNo || '—'}`,
    subheading: (r) => r.customer || '',
    noHistory: true,
    view: () => [],
    extra: (r, ctx) => form(r, ctx),
  },
};
