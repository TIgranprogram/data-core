import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum, plural } from '../core/format.js';
import { sideForm, openSide } from '../ui/kit/side-form.js';
import { table, hint, qtyInput } from '../ui/kit/index.js';
import { toast } from '../ui/kit/toast.js';
import { go } from '../core/router.js';
import { suggestQty } from './item-orders.js';

/**
 * Заявки пачкой (C036 Ш4–Ш5): одна правая панель `of=orderbulk` для склада и каталога.
 *   openOrderBulk(rows) — rows: [{ materialId, name, unit?, qty?, supplierId?, supplierName? }].
 * «Создать заявки» → POST /supply/requests/bulk {clientUid, items}. clientUid один на открытие панели:
 * повторное нажатие после сбоя не плодит дублей. Поставщик и цена без supplierId подставляются сервером.
 */
let pending = null; // { uid, rows } — строки открытой панели

const newUid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
const nPos = (n) => `${n} ${plural(n, 'позицию', 'позиции', 'позиций')}`;

export function openOrderBulk(rows) {
  const list = (rows || []).filter((r) => r && r.materialId);
  if (!list.length) { toast('Нет позиций склада для заявки', { error: true }); return false; }
  pending = { uid: newUid(), rows: list.map((r) => ({ ...r, qty: Number(r.qty) > 0 ? Number(r.qty) : 1 })) };
  openSide('orderbulk', pending.uid);
  return true;
}

export const orderBulk = sideForm({
  id: 'orderbulk', title: 'Заявки пачкой', noun: 'заявки',
  get: async () => {
    if (!pending) throw new Error('Отметьте позиции заново и нажмите «В заявку»');
    return { rows: pending.rows, uid: pending.uid };
  },
  heading: (r) => `Заявки на ${nPos(r.rows.length)}`,
  saveLabel: 'Создать заявки',
  fields: (r) => {
    const inputs = r.rows.map((x) => qtyInput({ value: String(x.qty), label: `Количество: ${x.name}` }));
    r.inputs = inputs;
    const grid = table({
      columns: [{ label: 'Позиция' }, { label: 'Количество', num: true }, { label: 'Поставщик' }],
      rows: r.rows.map((x, i) => ({ cells: [
        h('span', { title: x.name }, x.name, x.unit ? h('span', { class: 'muted' }, ' · ' + x.unit) : null),
        inputs[i],
        x.supplierName ? x.supplierName : { v: 'подставится по прошлым закупкам', cls: 'muted' },
      ] })),
    });
    const el = h('div', null, hint('Поставите количество — по каждой позиции будет создана своя заявка. Поставщик и цена возьмутся из прошлых закупок.'), grid);
    return [{ key: 'rows', label: '', type: 'widget', wide: true, widget: () => ({ el, get value() { return ''; }, set value(_) { /* только показ */ } }) }];
  },
  toInitial: () => ({}),
  toBody: (_v, r) => {
    const items = r.rows.map((x, i) => {
      const n = parseNum(r.inputs[i].input.value);
      if (!(n > 0)) throw new Error(`Укажите количество: ${x.name}`);
      const it = { materialId: x.materialId, qty: n };
      if (x.supplierId) it.supplierId = x.supplierId;
      return it;
    });
    return { clientUid: r.uid, items };
  },
  save: async (body) => {
    const res = await api('/supply/requests/bulk', { method: 'POST', body });
    const n = res?.total ?? res?.items?.length ?? body.items.length;
    pending = null;
    toast(`Создано ${n} ${plural(n, 'заявка', 'заявки', 'заявок')}`, { actions: [{ label: 'Открыть заявки', run: () => go('requests') }] });
    return {};
  },
});

/** Действие «В заявку» над отмеченными строками склада (bulk.extra). */
export const stockOrderAction = { label: 'В заявку', run: (_ids, rows) => openOrderBulk((rows || []).map((r) => ({ materialId: r.id, name: r.name, unit: r.unit, qty: suggestQty(r) }))) };
