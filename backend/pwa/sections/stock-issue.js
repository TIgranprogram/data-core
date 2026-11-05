import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum, plural, qty } from '../core/format.js';
import { patch } from '../core/router.js';
import { loadZones } from '../core/zone.js';
import { busyBtn } from '../ui/kit/busy.js';
import { actions, badge, busyBlock, button, empty, iconButton, modal, row, section, sideNote, table, toast, toastError } from '../ui/kit/index.js';
import { targetPicker } from '../ui/kit/target-picker.js';
import { peopleByWork } from './issue.js';
import { warehouseCard } from './stock-issue-card.js';

/*
 * «Выдать материалы» (СКЛ-1c, ВЫД.1): одна правая панель `of=stockissue&new=1`, кнопка — на экране «Склад».
 * Сверху «Кому» (заказ / сотрудник / вписать; targetPicker помнит получателя 2 часа). Ниже каскад: выбрали склад — карточка склада
 * с таблицей позиций (stock-issue-card.js), можно добавить ещё склад. В конце «Что выдаём» и две кнопки:
 * «Забронировать всё» → POST /stock/reserve-list, «Выдать всё» → POST /stock/batch type:'out'. Нехватка (400 + details) — таблицей.
 */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const changed = () => window.dispatchEvent(new CustomEvent('data-changed'));
const word = (n) => `${n} ${plural(n, 'позиция', 'позиции', 'позиций')}`;

/** Открыть панель выдачи (кнопка «Выдать материалы» на экране «Склад»). */
export function openStockIssue() { patch({ of: 'stockissue', new: '1', open: undefined, op: undefined, materialId: undefined }); }

/** Таблица нехватки для менеджера: что нужно, сколько на складе и свободно, сколько не хватает. */
function lackTable(list, nameOf) {
  const other = list.some((d) => d.reservedOther > 0);
  return h('div', null,
    table({ label: 'Нехватка материалов', columns: [{ label: 'Позиция' }, { label: 'Нужно', num: true }, { label: 'На складе', num: true }, { label: 'Свободно', num: true }, { label: 'Не хватает', num: true }],
      rows: list.map((d) => ({ cells: [d.name || nameOf(d.materialId), qty(d.need), qty(d.have ?? 0), qty(d.free ?? 0), qty(d.lack ?? 0)] })) }),
    other ? sideNote('Часть материала — в брони других заказов, поэтому свободно меньше, чем на складе.') : null);
}

function build() {
  const cart = new Map(); // materialId → { it, qty }
  const cards = []; // { zone, c }
  let zones = [];
  let sid = uid();
  const tp = targetPicker({ mode: 'out' });
  const nameOf = (id) => cart.get(id)?.it.name || 'позиция';
  const personName = async (id) => (await peopleByWork()).flatMap((g) => g.people).find((p) => p.id === id)?.name || '';

  // ---------- Что выдаём ----------
  const cartBox = h('div', null);
  const btns = [
    button({ label: 'Забронировать всё', disabled: true, onClick: (e) => run('reserve', e.currentTarget) }),
    button({ label: 'Выдать всё', kind: 'primary', disabled: true, onClick: (e) => run('out', e.currentTarget) }),
  ];
  const lines = () => [...cart.values()].map(({ it, qty: q }) => ({ materialId: it.id, qty: parseNum(q) })).filter((l) => l.qty > 0);
  const cartSec = section({ title: 'Что выдаём', count: 0, open: true, body: [cartBox, actions(...btns)] });
  function paintCart() {
    cartSec.querySelector('.k-sec-head .k-sec-n')?.replaceChildren(String(cart.size));
    btns.forEach((b) => { b.disabled = !cart.size; });
    if (!cart.size) { cartBox.replaceChildren(empty({ title: 'Пока ничего не выбрано', hint: 'Выберите склад и впишите количество в таблице.' })); return; }
    cartBox.replaceChildren(...[...cart.values()].map(({ it, qty: q }) => {
      const free = it.free ?? it.quantity;
      const over = parseNum(q) > free;
      return row({ data: it.id, title: it.name, meta: `свободно ${qty(free)} ${it.unit || ''}`.trim(), tone: over ? 'danger' : 'neutral',
        qty: h('b', null, `${qty(parseNum(q))} ${it.unit || ''}`.trim()),
        action: iconButton({ icon: '×', label: 'Убрать из списка', size: 'S', onClick: () => { cart.delete(it.id); cards.forEach((x) => x.c.sync()); touch(); } }),
        warn: over ? badge(`Свободно только ${qty(free)} — выдать столько нельзя, можно забронировать`, 'danger') : null });
    }));
  }
  function touch() { sid = uid(); paintCart(); }

  async function run(kind, btn) {
    const ls = lines();
    if (!ls.length) { toast('Впишите количество хотя бы у одной позиции', { error: true }); return; }
    const why = tp.check();
    if (why) { toast(why, { error: true }); return; }
    const to = tp.value();
    if (kind === 'out' && !to.salesOrderId && !to.personId && !to.issuedTo) { toast('Выберите, кому выдаём: заказ, сотрудника — или впишите получателя', { error: true }); return; }
    let body;
    if (kind === 'out') body = { type: 'out', lines: ls, ...to };
    else {
      const groupName = to.salesOrderId ? undefined : to.issuedTo || (to.personId ? await personName(to.personId) : '');
      if (!to.salesOrderId && !groupName) { toast('Для брони выберите заказ или впишите, для чего бронь', { error: true }); return; }
      body = { lines: ls, groupName, ...(to.salesOrderId ? { salesOrderId: to.salesOrderId, ...(to.salesOrderLineId ? { salesOrderLineId: to.salesOrderLineId } : {}) } : {}) };
    }
    const free = busyBtn(btn, kind === 'out' ? 'Выдаю…' : 'Бронирую…');
    let lack = null;
    try {
      const r = await api(kind === 'out' ? '/stock/batch' : '/stock/reserve-list', { method: 'POST', body: { ...body, clientUid: `${sid}-${kind}` } });
      const n = kind === 'out' ? r.lines : r.lines.length;
      const short = kind === 'reserve' ? (r.short || []).map((s) => ({ name: nameOf(s.materialId), need: s.need, have: s.reserved, free: s.reserved, lack: s.need - s.reserved })) : [];
      const undoPath = kind === 'out' ? `/stock/batch/${r.batchId}/cancel` : `/stock/reservations/group/${r.batchId}/release`;
      toast(`${kind === 'out' ? 'Выдано' : 'Забронировано'}: ${word(n)}`, { undo: async () => { await api(undoPath, { method: 'POST' }); changed(); cards.forEach((x) => x.c.reload()); toast(kind === 'out' ? 'Выдача отменена' : 'Бронь снята'); } });
      cart.clear(); cards.forEach((x) => { x.c.sync(); x.c.reload(); }); touch(); changed();
      if (short.length) await modal({ title: 'Забронировано не всё', wide: true, okText: 'Понятно', cancelText: 'Закрыть', body: lackTable(short, nameOf) });
    } catch (e) {
      const details = e.status === 400 && e.data?.details;
      if (kind === 'out' && Array.isArray(details) && details.length) lack = details;
      else toastError(e, kind === 'out' ? 'выдать материалы' : 'забронировать материалы');
    } finally { free(); }
    // нехватка: таблица и «Забронировать, что есть»
    if (lack && (await modal({ title: 'Не хватает на складе', wide: true, okText: 'Забронировать, что есть', cancelText: 'Закрыть',
      body: h('div', null, sideNote('Выдача не проведена. Уменьшите количество — или забронируйте то, что есть: бронь возьмёт сколько свободно.'), lackTable(lack, nameOf)) }))) await run('reserve', btns[0]);
  }

  // ---------- Каскад складов ----------
  const cascade = h('div', null);
  const pickBox = h('div', null);
  function addZone(z) {
    if (cards.some((x) => x.zone.id === z.id)) return;
    const c = warehouseCard({ zone: z, cart, onChange: touch, onRemove: () => { cards.splice(cards.findIndex((x) => x.c === c), 1); c.el.remove(); paintZones(); } });
    cards.push({ zone: z, c });
    cascade.append(c.el);
    paintZones();
  }
  function paintZones() {
    const left = zones.filter((z) => !cards.some((x) => x.zone.id === z.id));
    pickBox.replaceChildren(...[
      cards.length ? null : empty({ title: 'Выберите склад', hint: 'Откроется таблица его позиций — впишите, сколько нужно.' }),
      left.length ? actions(...left.map((z) => button({ label: (cards.length ? '+ ' : '') + z.name, onClick: () => addZone(z) }))) : null,
    ].filter(Boolean));
  }
  const zonesNote = h('div', null, busyBlock('склады'));
  const initZones = () => loadZones().then((zs) => {
    zones = zs.length ? zs : [{ id: '', name: 'Склад' }]; // склады не заведены — один общий
    zonesNote.remove();
    if (zones.length === 1) addZone(zones[0]); else paintZones();
  }).catch((e) => { zonesNote.replaceChildren(sideNote('Склады не загрузились: ' + (e.message || '')), button({ label: 'Повторить', size: 'S', onClick: () => { zonesNote.replaceChildren(busyBlock('склады')); initZones(); } })); });
  initZones();
  paintCart();

  const el = h('div', null,
    sideNote('Выберите, кому выдаём, затем склад и количество. Получатель запоминается на 2 часа.'),
    section({ title: 'Кому', open: true, body: tp.el }),
    section({ title: 'Откуда', open: true, body: [zonesNote, cascade, pickBox] }),
    cartSec);

  return { el, readonly: true, dirty: () => cart.size > 0 || !!tp.dirty(), focus: () => {}, read: () => ({ values: {} }) };
}

export const stockIssue = {
  id: 'stockissue', title: 'Склад',
  newTitle: 'Выдать материалы',
  card: { heading: () => 'Выдать материалы' },
  get: async () => ({}),
  form: { build, toBody: (v) => v, create: () => ({}), closeAfterCreate: true },
};
