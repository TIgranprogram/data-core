import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { plural, qty } from '../core/format.js';
import { confirmDlg, modal } from '../ui/dialog.js';
import { errText } from '../ui/errors.js';
import { toast, toastError } from '../ui/toast.js';
import { issueToFields } from './issue.js';
import { editReservation } from './reservations.js';

/*
 * «Брони заказа» в карточке заказа (SK-6b): активные брони по позициям, «изменить» (правая панель), «снять» и «Выдать по заказу» —
 * одной операцией (пачка: «Отменить» во всплывашке возвращает всё). Что можно выдать, отмечено галочкой; чего на складе не хватает — без галочки.
 * Подтверждение выдачи — окно (1–2 поля: «Кому выдано» необязательно).
 */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

/** Элемент-блок; сам догружает данные. onChanged — перечитать всю карточку заказа (выдано по позициям и т. д.). */
export function orderReservations(order, onChanged) {
  const box = h('div', { class: 'so-sec', hidden: true });
  // после правки — перечитать всю карточку заказа (она заново соберёт и этот блок); без неё — только блок
  const refresh = async () => { window.dispatchEvent(new CustomEvent('data-changed')); if (onChanged) onChanged(); else await load(); };

  async function load() {
    let d;
    try { d = await api(`/stock/reservations/order/${order.id}`); } catch (e) { box.hidden = false; box.replaceChildren(h('div', { class: 'section-title' }, 'Брони заказа'), h('p', { class: 'muted' }, 'Не загрузились: ' + errText(e))); return; }
    const items = d.items || [];
    box.hidden = !items.length && !d.hanging;
    if (box.hidden) return;
    const chosen = new Set(items.filter((x) => x.canIssue).map((x) => x.id));
    const act = h('button', { type: 'button', class: 'btn btn-primary btn-sm' });
    const sync = () => { act.textContent = `Выдать по заказу (${chosen.size})`; act.disabled = !chosen.size; };
    const lineLabel = (x) => (x.salesOrderLineId ? `${order.orderNo || ''}${x.lineNo ? '-' + x.lineNo : ''} · ${x.lineTitle || 'позиция заказа'}` : 'весь заказ');
    const rows = items.map((x) => {
      const cb = session.canEdit && x.canIssue ? h('input', { type: 'checkbox', checked: true, 'aria-label': 'Выдать', onchange: () => { if (cb.checked) chosen.add(x.id); else chosen.delete(x.id); sync(); } }) : h('span');
      return h('li', { class: 'spec-row res-order-row' }, cb,
        h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: x.name }, x.name),
          h('small', { class: x.canIssue ? 'muted' : 'neg' }, lineLabel(x) + (x.canIssue ? '' : ` · на складе только ${qty(x.onHand)} ${x.unit}`))),
        h('span', { class: 'num nowrap' }, `${qty(x.qty)} ${x.unit}`),
        session.canEdit ? h('span', { class: 'res-acts' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => editReservation(x.id) }, 'изменить'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async (e) => { const btn = e.currentTarget; if (!(await confirmDlg('Снять бронь?', `«${x.name}» — ${qty(x.qty)} ${x.unit || ''} снова станет свободным.`, { okText: 'Снять бронь', danger: true }))) return; btn.disabled = true; try { await api(`/stock/reservations/${x.id}/release`, { method: 'POST' }); toast('Бронь снята'); await refresh(); } catch (er) { toastError(er); btn.disabled = false; } } }, 'снять')) : null);
    });
    act.onclick = () => issue(items.filter((x) => chosen.has(x.id)));
    sync();
    box.replaceChildren(
      h('div', { class: 'section-title' }, `Брони заказа (${items.length})`),
      d.hanging ? h('div', { class: 'res-hang', role: 'note' }, `Висящая бронь: ${d.hanging.toLowerCase()}, а материал всё ещё отложен. Снимите брони, если он не нужен.`) : null,
      items.length ? h('ul', { class: 'spec-list' }, ...rows) : null,
      session.canEdit && items.some((x) => x.canIssue) ? h('div', { class: 'spec-acts' }, act) : null);
  }

  async function issue(list) {
    if (!list.length) return;
    const to = issueToFields('');
    const clientUid = uid(); // одно окно — один ключ: повторное нажатие не задвоит выдачу
    const r = await modal({
      title: `Выдать по заказу № ${order.orderNo || ''}`, okText: 'Выдать',
      body: h('div', null,
        h('p', { class: 'hint' }, `Со склада будет выдано ${list.length} ${plural(list.length, 'позиция', 'позиции', 'позиций')} из броней заказа — одной операцией; её можно отменить сразу после.`),
        h('ul', { class: 'spec-list' }, ...list.map((x) => h('li', { class: 'spec-row' }, h('span'), h('div', { class: 'spec-main' }, h('div', { class: 'clip' }, x.name), h('small', { class: 'muted' }, x.salesOrderLineId ? `${order.orderNo || ''}${x.lineNo ? '-' + x.lineNo : ''}` : 'весь заказ')), h('span', { class: 'num nowrap' }, `${qty(x.qty)} ${x.unit}`)))),
        h('div', { class: 'form-grid' }, to.el)),
      onOk: () => api('/stock/reservations/issue-order', { method: 'POST', body: { salesOrderId: order.id, reservationIds: list.map((x) => x.id), ...to.value(), clientUid } }),
    }).catch((e) => { toastError(e); return null; });
    if (!r) return;
    toast(`Выдано по заказу: ${r.issued ?? list.length} ${plural(r.issued ?? list.length, 'позиция', 'позиции', 'позиций')}`, {
      undo: async () => { await api(`/stock/batch/${r.batchId}/cancel`, { method: 'POST' }); toast('Выдача отменена, брони вернулись'); await refresh(); },
    });
    await refresh();
  }

  load();
  return box;
}
