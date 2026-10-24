import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum, qty } from '../core/format.js';
import { current, patch } from '../core/router.js';
import { confirmDlg } from '../ui/dialog.js';
import { errText } from '../ui/errors.js';
import { targetPicker } from '../ui/target-picker.js';
import { toast } from '../ui/toast.js';
import { buildIssueOrder } from './order-issue.js';

/*
 * Правка брони в правой панели (SK-6b): сколько в брони, под какой заказ и позицию, примечание.
 * Адрес: ?of=resedit&new=1&rid=<id строки брони>. Больше свободного — сервер откажет с понятным текстом (он показывается в панели).
 * «Снять бронь» — кнопка в панели (с подтверждением и «Отменить» не нужна: бронь можно поставить заново).
 */
async function build() {
  if (current().params.op === 'issueorder') return buildIssueOrder(); // «Выдать по заказу» (SK-6c) — та же панель «Бронь»
  const rid = current().params.rid;
  const res = await api('/stock/reservations');
  let group = null; let line = null;
  for (const g of res.items || []) { const l = g.lines.find((x) => x.id === rid); if (l) { group = g; line = l; break; } }
  if (!line) return { el: h('p', { class: 'muted' }, 'Эта бронь уже выдана или снята — закройте панель и обновите страницу.'), dirty: () => false, read: () => ({ errors: { rid: 1 } }) };

  let touched = false;
  const unit = line.unit || '';
  const qIn = h('input', { inputmode: 'decimal', value: String(line.qty), 'aria-label': 'Сколько в брони' });
  const tp = targetPicker({ mode: 'reserve' });
  if (line.salesOrderId) tp.preset({ id: line.salesOrderId, label: group.salesOrder ? '№ ' + group.salesOrder : 'Заказ' }, line.salesOrderLineId);
  const note = h('input', { maxlength: 300, placeholder: 'необязательно — допишется в примечание брони' });
  for (const i of [qIn, note]) i.addEventListener('input', () => { touched = true; });

  const release = h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
    if (!(await confirmDlg('Снять бронь?', `«${line.name}» — ${qty(line.qty)} ${unit} снова станет свободным.`, { okText: 'Снять бронь', danger: true }))) return;
    release.disabled = true;
    try { await api(`/stock/reservations/${line.id}/release`, { method: 'POST' }); toast('Бронь снята'); window.dispatchEvent(new CustomEvent('data-changed')); touched = false; patch({ of: undefined, new: undefined, rid: undefined }); }
    catch (e) { toast(errText(e), { error: true }); release.disabled = false; }
  } }, 'Снять бронь');

  const el = h('div', null,
    group.hanging ? h('div', { class: 'res-hang', role: 'note' }, `Висящая бронь: ${group.hanging.toLowerCase()}, а материал всё ещё отложен. Если он не нужен — снимите бронь.`) : null,
    h('p', { class: 'hint' }, `Позиция склада: ${line.name}. Бронь «${group.name}»${line.issued ? ` · уже выдано ${qty(line.issued)} ${unit}` : ''}. Больше свободного поставить нельзя.`),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', null, `В брони${unit ? ', ' + unit : ''}`), qIn),
      tp.el,
      h('label', { class: 'field wide' }, h('span', null, 'Примечание'), note)),
    h('div', { class: 'res-edit-foot' }, release));

  async function save() {
    const n = parseNum(qIn.value);
    if (n === undefined || Number.isNaN(n) || !(n > 0)) throw new Error('Впишите, сколько в брони, — число больше нуля. Чтобы убрать бронь совсем, нажмите «Снять бронь».');
    const why = tp.check(); if (why) throw new Error(why);
    const r = await api(`/stock/reservations/${line.id}`, { method: 'PATCH', body: {
      qty: n, salesOrderId: tp.orderId() || null, salesOrderLineId: tp.line()?.id || null, ...(note.value.trim() ? { note: note.value.trim() } : {}) } });
    toast(`Бронь изменена: ${qty(r.qty ?? n)} ${unit}`);
    return r;
  }
  return { el, dirty: () => touched || tp.dirty() !== !!line.salesOrderId, focus: () => qIn.focus(), read: () => ({ values: { save } }) };
}

export const resEdit = {
  id: 'resedit', title: 'Бронь', get newTitle() { return current().params.op === 'issueorder' ? 'Выдать по заказу' : 'Изменить бронь'; }, card: { heading: () => 'Бронь' }, get: async () => ({}),
  form: { build, toBody: (v) => v, create: (v) => v.save(), get saveLabel() { return current().params.op === 'issueorder' ? 'Выдать' : 'Сохранить'; }, closeAfterCreate: true },
};
