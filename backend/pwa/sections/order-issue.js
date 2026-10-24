import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum, plural, qty } from '../core/format.js';
import { current } from '../core/router.js';
import { errText } from '../ui/errors.js';
import { toast } from '../ui/toast.js';
import { issueToFields } from './issue.js';

/*
 * «Выдать по заказу» в правой панели (SK-6c): брони заказа строками — галочка «выдать» и узкое поле «сколько»
 * (по умолчанию — остаток брони, но не больше, чем есть на складе). Меньше брони — остаток брони остаётся активным.
 * Уходит одна операция `lines: [{ reservationId, qty }]`; одна панель — один clientUid (повтор не задвоит).
 * Адрес: ?of=resedit&new=1&op=issueorder&orderId=<id заказа>.
 */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const pos = (n) => plural(n, 'позицию', 'позиции', 'позиций');
const stub = (text) => ({ el: h('p', { class: 'muted' }, text), dirty: () => false, focus: () => {}, read: () => ({ errors: { stub: 1 } }), bindSave: (set) => set(false) });

export async function buildIssueOrder() {
  const orderId = current().params.orderId;
  let d;
  try { d = await api(`/stock/reservations/order/${orderId}`); } catch (e) { return stub('Не удалось открыть: ' + errText(e)); }
  const items = d.items || [];
  if (!items.length) return stub('Активных броней по заказу нет — закройте панель.');

  let touched = false;
  let setSave = () => {};
  const to = issueToFields('');
  const clientUid = uid();

  const rows = items.map((x) => {
    const max = Math.min(x.qty, x.onHand > 0 ? x.onHand : 0);
    const can = max > 0;
    const cb = h('input', { type: 'checkbox', checked: can, disabled: !can, 'aria-label': 'Выдать «' + x.name + '»' });
    const n = h('input', { class: 'oi-qty', inputmode: 'decimal', value: can ? String(max) : '', disabled: !can, 'aria-label': `Сколько выдать, ${x.unit || ''}` });
    const msg = h('small', { class: 'oi-msg' });
    const r = { x, cb, n, msg };
    const line = x.salesOrderLineId ? `поз. ${x.lineNo ?? '?'} · ${x.lineTitle || 'позиция заказа'}` : 'весь заказ';
    const stockNote = !can ? ' · на складе нет — выдать нечего' : x.onHand < x.qty ? ` · на складе только ${qty(x.onHand)} ${x.unit}` : '';
    r.el = h('li', { class: 'spec-row oi-row' }, cb,
      h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: x.name }, x.name),
        h('small', { class: can && x.onHand >= x.qty ? 'muted' : 'neg' }, line + stockNote), msg),
      h('label', { class: 'oi-n' }, n, h('span', { class: 'muted nowrap' }, `из ${qty(x.qty)} ${x.unit || ''}`)));
    cb.addEventListener('change', () => { touched = true; n.disabled = !cb.checked; sync(); });
    n.addEventListener('input', () => {
      touched = true;
      const v = parseNum(n.value);
      if (v > x.qty) n.value = String(x.qty); // больше брони ввести нельзя
      sync();
    });
    return r;
  });

  /** Ошибка строки или '' (показывается под названием). */
  const check = (r) => {
    if (!r.cb.checked) return '';
    const v = parseNum(r.n.value);
    if (v === undefined || Number.isNaN(v) || !(v > 0)) return 'Впишите, сколько выдать, — больше нуля, или снимите галочку';
    if (v > r.x.qty) return `В брони только ${qty(r.x.qty)} ${r.x.unit}`;
    if (v > r.x.onHand) return `На складе только ${qty(r.x.onHand)} ${r.x.unit}`;
    return '';
  };
  const chosen = () => rows.filter((r) => r.cb.checked);
  const sum = h('p', { class: 'oi-sum' });
  function sync() {
    let bad = 0;
    for (const r of rows) { const e = check(r); r.msg.textContent = e; r.msg.className = 'oi-msg' + (e ? ' neg' : ''); r.n.classList.toggle('invalid', !!e); r.n.setAttribute('aria-invalid', e ? 'true' : 'false'); if (e) bad++; }
    const k = chosen().length;
    const part = chosen().filter((r) => !check(r) && parseNum(r.n.value) < r.x.qty).length;
    sum.textContent = k ? `Будет выдано ${k} ${pos(k)}${part ? `, из них ${part} — частично (остаток брони останется)` : ''}.` : 'Ничего не выбрано — отметьте, что выдать.';
    setSave(k > 0 && !bad, k ? `Выдать ${k} ${pos(k)}` : 'Выдать');
  }

  const el = h('div', null,
    h('p', { class: 'hint' }, `Заказ ${d.order?.label || ''}. Что не выдаёте — снимите галочку; меньше брони — остаток брони останется в заказе. Всё уходит одной операцией, её можно отменить сразу после.`),
    h('ul', { class: 'spec-list' }, ...rows.map((r) => r.el)),
    sum,
    h('div', { class: 'form-grid' }, to.el));

  async function save() {
    const list = chosen();
    const bad = list.map(check).find(Boolean);
    if (bad) throw new Error(bad);
    if (!list.length) throw new Error('Отметьте, что выдать');
    const res = await api('/stock/reservations/issue-order', { method: 'POST', body: {
      salesOrderId: orderId, lines: list.map((r) => ({ reservationId: r.x.id, qty: parseNum(r.n.value) })), ...to.value(), clientUid } });
    const k = res.issued ?? list.length;
    toast(`Выдано по заказу: ${k} ${plural(k, 'позиция', 'позиции', 'позиций')}`, {
      undo: async () => { await api(`/stock/batch/${res.batchId}/cancel`, { method: 'POST' }); toast('Выдача отменена, брони вернулись'); window.dispatchEvent(new CustomEvent('data-changed')); window.dispatchEvent(new CustomEvent('order-res-changed')); },
    });
    return res;
  }

  return {
    el, dirty: () => touched,
    focus: () => rows.find((r) => !r.n.disabled)?.n.focus(),
    read: () => ({ values: { save } }),
    bindSave: (set) => { setSave = set; sync(); },
  };
}
