import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { patch } from '../core/router.js';
import { confirmDlg } from '../ui/dialog.js';
import { failBlock } from '../ui/busy.js';

import { toast, toastError } from '../ui/toast.js';
import { editReservation } from './reservations.js';

/*
 * «Брони заказа» в карточке заказа (SK-6b): активные брони по позициям, «изменить» (правая панель), «снять» и «Выдать по заказу…».
 * Выдача — правая панель (SK-6c, sections/order-issue.js): какие строки и сколько; одной операцией, «Отменить» во всплывашке возвращает всё.
 * После «Отменить» панель уже закрыта — блок перечитывается по событию 'order-res-changed'.
 */

/** Элемент-блок; сам догружает данные. onChanged — перечитать всю карточку заказа (выдано по позициям и т. д.). */
export function orderReservations(order, onChanged) {
  const box = h('div', { class: 'so-sec', hidden: true });
  // после правки — перечитать всю карточку заказа (она заново соберёт и этот блок); без неё — только блок
  const refresh = async () => { window.dispatchEvent(new CustomEvent('data-changed')); if (onChanged) onChanged(); else await load(); };
  const onExt = () => { if (!box.isConnected) { window.removeEventListener('order-res-changed', onExt); return; } if (onChanged) onChanged(); else load(); };
  window.addEventListener('order-res-changed', onExt);

  async function load() {
    let d;
    try { d = await api(`/stock/reservations/order/${order.id}`); } catch (e) { box.hidden = false; box.replaceChildren(h('div', { class: 'section-title' }, 'Брони заказа'), failBlock(e, load, { text: 'Не загрузились' })); return; }
    const items = d.items || [];
    box.hidden = !items.length && !d.hanging;
    if (box.hidden) return;
    // что выдавать и сколько — в правой панели (SK-6c); здесь только список и кнопка
    const can = items.filter((x) => x.onHand > 0 && x.qty > 0).length;
    const act = h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: !can, onclick: () => patch({ of: 'resedit', new: '1', op: 'issueorder', orderId: order.id, open: undefined }, { replace: false }) }, 'Выдать по заказу…');
    const lineLabel = (x) => (x.salesOrderLineId ? `${order.orderNo || ''}${x.lineNo ? '-' + x.lineNo : ''} · ${x.lineTitle || 'позиция заказа'}` : 'весь заказ');
    const rows = items.map((x) => {
      return h('li', { class: 'spec-row res-order-row' }, h('span'),
        h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: x.name }, x.name),
          h('small', { class: x.canIssue ? 'muted' : 'neg' }, lineLabel(x) + (x.issued ? ` · уже выдано ${qty(x.issued)} ${x.unit}` : '') + (x.canIssue ? '' : x.onHand > 0 ? ` · на складе только ${qty(x.onHand)} ${x.unit}` : ' · на складе нет'))),
        h('span', { class: 'num nowrap', title: 'Осталось в брони' }, `${qty(x.qty)} ${x.unit}`),
        session.canEdit ? h('span', { class: 'res-acts' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => editReservation(x.id) }, 'изменить'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async (e) => { const btn = e.currentTarget; if (!(await confirmDlg('Снять бронь?', `«${x.name}» — ${qty(x.qty)} ${x.unit || ''} снова станет свободным.`, { okText: 'Снять бронь', danger: true }))) return; btn.disabled = true; try { await api(`/stock/reservations/${x.id}/release`, { method: 'POST' }); toast('Бронь снята'); await refresh(); } catch (er) { toastError(er); btn.disabled = false; } } }, 'снять')) : null);
    });
    box.replaceChildren(
      h('div', { class: 'section-title' }, `Брони заказа (${items.length})`),
      d.hanging ? h('div', { class: 'res-hang', role: 'note' }, `Висящая бронь: ${d.hanging.toLowerCase()}, а материал всё ещё отложен. Снимите брони, если он не нужен.`) : null,
      items.length ? h('ul', { class: 'spec-list' }, ...rows) : null,
      session.canEdit && items.length ? h('div', { class: 'spec-acts' }, act, can ? null : h('span', { class: 'muted' }, 'На складе нет ничего из броней — выдавать нечего.')) : null);
  }

  load();
  return box;
}
