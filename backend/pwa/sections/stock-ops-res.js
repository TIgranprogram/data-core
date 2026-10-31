import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum, qty } from '../core/format.js';
import { confirmDlg } from '../ui/dialog.js';
import { errText } from '../ui/errors.js';
import { toast } from '../ui/toast.js';
import { issueToFields } from './issue.js';
import { editReservation } from './reservations.js';

/*
 * «Выдать из брони» и «Снять бронь» по одной позиции склада — в правой панели (SK-9, вместо окон карточки позиции).
 * Адрес: ?of=stockop&new=1&op=fromres|unreserve&materialId=<id>. Брони позиции берутся с сервера при открытии панели.
 */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const stub = (text) => ({ el: h('p', { class: 'muted' }, text), dirty: () => false, focus: () => {}, readonly: true, read: () => ({ values: {} }) });

/** Активные брони позиции: [{ id, qty, unit, group, order, hanging }]. */
async function reservesOf(materialId, unitFallback) {
  const res = await api('/stock/reservations');
  return (res.items || []).flatMap((g) => g.lines.filter((l) => l.materialId === materialId && l.qty > 0).map((l) => ({ id: l.id, qty: l.qty, unit: l.unit || unitFallback || '', group: g.name, order: g.salesOrder, hanging: g.hanging })));
}
const where = (r) => [r.group && r.group !== 'Бронь' ? r.group : 'Бронь', r.order && !String(r.group).includes(r.order) ? 'заказ ' + r.order : ''].filter(Boolean).join(' · ');

/** «Выдать из брони»: количество и объект — из брони, можно поменять; несколько броней — отметить, какие. */
export async function buildFromReserve(materialId) {
  if (!materialId) return stub('Откройте «Выдать из брони» из карточки позиции склада.');
  let it; let rows;
  try { it = await api('/stock/items/' + materialId); rows = await reservesOf(materialId, it.unit); } catch (e) { return stub('Не удалось открыть: ' + errText(e)); }
  if (!rows.length) return stub('Активной брони у позиции нет — выдавать нечего.');
  const clientUid = uid(); // повторное нажатие после сбоя связи не задвоит выдачу
  let touched = false;
  const chosen = new Set(rows.length === 1 ? [rows[0].id] : []);
  const inputs = new Map();
  const to = issueToFields(rows.length === 1 && rows[0].group && rows[0].group !== 'Бронь' ? rows[0].group : '');
  const list = h('ul', { class: 'spec-list' }, ...rows.map((r) => {
    const q = h('input', { inputmode: 'decimal', value: String(r.qty), class: 'rs-qty', 'aria-label': 'Сколько выдать' });
    inputs.set(r.id, q);
    q.addEventListener('input', () => { touched = true; });
    const cb = h('input', { type: 'checkbox', checked: chosen.has(r.id), 'aria-label': 'Выдать из этой брони', onchange: () => { touched = true; if (cb.checked) chosen.add(r.id); else chosen.delete(r.id); } });
    return h('li', { class: 'spec-row' }, cb,
      h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: where(r) }, where(r)), h('small', { class: r.hanging ? 'neg' : 'muted' }, r.hanging ? `висящая: ${r.hanging.toLowerCase()}` : `в брони ${qty(r.qty)} ${r.unit}`)),
      q, h('span', { class: 'muted' }, r.unit));
  }));
  const el = h('div', null,
    h('p', { class: 'hint' }, `${it.name}: на складе ${qty(it.quantity)} ${it.unit || ''}, в брони ${qty(it.reservedQty)}. Количество и «кому» взяты из брони; меньше — остаток брони останется.`),
    rows.length > 1 ? h('div', { class: 'section-title' }, 'Из каких броней выдать') : null,
    list,
    h('div', { class: 'form-grid sop-foot' }, to.el));

  async function save() {
    const lines = [];
    for (const r of rows) {
      if (!chosen.has(r.id)) continue;
      const n = parseNum(inputs.get(r.id).value);
      if (n === undefined || Number.isNaN(n) || !(n > 0)) throw new Error('Впишите, сколько выдать, — число больше нуля');
      if (n > r.qty) throw new Error(`В брони «${where(r)}» только ${qty(r.qty)} ${r.unit}`);
      lines.push({ reservationId: r.id, qty: n });
    }
    if (!lines.length) throw new Error('Отметьте, из какой брони выдавать');
    const r = await api('/stock/reservations/issue', { method: 'POST', body: { lines, ...to.value(), clientUid } });
    const changed = () => window.dispatchEvent(new CustomEvent('data-changed'));
    toast(`Выдано из брони: ${it.name}`, { undo: async () => { await api(`/stock/batch/${r.batchId}/cancel`, { method: 'POST' }); changed(); toast('Выдача отменена, бронь вернулась'); } });
    return r;
  }
  return { el, dirty: () => touched, focus: () => inputs.values().next().value?.focus(), read: () => ({ values: { save } }) };
}

/** «Снять бронь»: сколько вернуть в свободный остаток; ниже — брони позиции, каждую можно снять целиком или изменить. */
export async function buildUnreserve(materialId) {
  if (!materialId) return stub('Откройте «Снять бронь» из карточки позиции склада.');
  let it; let rows;
  try { it = await api('/stock/items/' + materialId); rows = await reservesOf(materialId, it.unit); } catch (e) { return stub('Не удалось открыть: ' + errText(e)); }
  if (!(it.reservedQty > 0)) return stub('В брони у позиции ничего нет.');
  let touched = false;
  const unit = it.unit || '';
  const qIn = h('input', { inputmode: 'decimal', value: String(it.reservedQty), 'aria-label': 'Сколько снять с брони' });
  qIn.addEventListener('focus', () => qIn.select());
  const note = h('input', { maxlength: 300, placeholder: 'основание, необязательно' });
  for (const i of [qIn, note]) i.addEventListener('input', () => { touched = true; });
  const box = h('div');
  const draw = () => box.replaceChildren(...(rows.length ? [h('div', { class: 'section-title' }, `Брони позиции (${rows.length})`),
    h('ul', { class: 'spec-list' }, ...rows.map((r) => h('li', { class: 'spec-row' }, h('span'),
      h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: where(r) }, where(r)), r.hanging ? h('small', { class: 'neg' }, `висящая: ${r.hanging.toLowerCase()}`) : null),
      h('span', { class: 'num nowrap' }, `${qty(r.qty)} ${r.unit}`),
      h('span', { class: 'res-acts' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => editReservation(r.id) }, 'Изменить'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async (e) => {
          const btn = e.currentTarget; // после await в событии currentTarget уже null
          if (!(await confirmDlg('Снять бронь?', `«${where(r)}» — ${qty(r.qty)} ${r.unit} снова станет свободным.`, { okText: 'Снять бронь', danger: true }))) return;
          btn.disabled = true;
          try { await api(`/stock/reservations/${r.id}/release`, { method: 'POST' }); toast('Бронь снята'); window.dispatchEvent(new CustomEvent('data-changed')); rows = rows.filter((x) => x !== r); draw(); } catch (er) { toast(errText(er), { error: true }); btn.disabled = false; }
        } }, 'Снять')))))] : []));
  draw();
  const el = h('div', null,
    h('p', { class: 'hint' }, `${it.name}: в брони ${qty(it.reservedQty)} ${unit}. Снятое возвращается в свободный остаток; на складе ничего не списывается. Конкретную бронь можно снять кнопкой в списке ниже.`),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', null, `Сколько снять с брони${unit ? ', ' + unit : ''}`), qIn),
      h('label', { class: 'field wide' }, h('span', null, 'Основание'), note)),
    box);

  async function save() {
    const n = parseNum(qIn.value);
    if (n === undefined || Number.isNaN(n) || !(n > 0)) throw new Error('Впишите, сколько снять, — число больше нуля');
    if (n > it.reservedQty) throw new Error(`В брони только ${qty(it.reservedQty)} ${unit}`);
    const r = await api(`/stock/items/${it.id}/move`, { method: 'POST', body: { type: 'unreserve', qty: n, note: note.value.trim() || undefined } });
    toast(`Снято с брони: ${qty(n)} ${unit}`);
    return r;
  }
  return { el, dirty: () => touched, focus: () => qIn.focus(), read: () => ({ values: { save } }) };
}

