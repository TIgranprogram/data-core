import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money } from '../core/format.js';
import { ordersLookup } from '../core/orders-lookup.js';

/**
 * Автозаполнение формы заявки (CHAIN-AUDIT З1–З4). Подключается как `mount` поля «Наименование».
 *  З1: выбрана позиция склада (скрытое materialId) -> цена, поставщик из GET /materials/:id/price-default, серая строка «последняя цена от …».
 *  З2: в истории (GET /materials/:id/prices) >= 2 поставщиков -> до 3 кнопок «Поставщик · цена · дата».
 *  З3: выбран поставщик, а позиции нет -> подсказка позиций из его каталога (GET /supply/catalog/items).
 *  З4: заказ выбран/пришёл из заказа -> заказчик подставляется, под полем «Заказ № N поз M».
 * Руками правленное (api.manual) не перетираем. Цена в истории — за единицу; в заявке «сумма по строке» = цена × количество.
 */
const round = (x) => Math.round(x * 100) / 100;
let partners = null;
const supplierId = async (name) => {
  partners ??= api('/partners', { query: { limit: 500, type: 'supplier' } }).then((r) => r.items || []).catch(() => { partners = null; return []; });
  const n = String(name || '').trim().toLowerCase();
  return (await partners).find((p) => [p.shortName, p.name].some((x) => String(x || '').trim().toLowerCase() === n))?.id || '';
};

export function wireFill(fapi) {
  const money$ = session.canMoney && !!fapi.input('priceHint');
  const note = h('div', { class: 'hint rq-note', hidden: true });
  const chips = h('div', { class: 'rq-chips', hidden: true });
  const cat = h('div', { class: 'rq-chips', hidden: true });
  fapi.field('supplierName')?.append(note, chips, cat);
  const orderNote = h('div', { class: 'hint rq-note', hidden: true });
  fapi.field('salesOrderRef')?.append(orderNote);
  let last = null; // { price } — цена за единицу из последней закупки
  let token = 0;

  const chip = (text, onclick, title) => h('button', { type: 'button', class: 'tag rq-chip', title, onclick }, text);
  const sum = (price) => round(price * (Number(fapi.get('qty')) || 1));
  const putSum = (price, auto) => { if (money$) fapi.set('priceHint', sum(price), { auto }); };

  // ---- З1 + З2 ----
  async function onMaterial() {
    const id = fapi.get('materialId'); const my = ++token;
    last = null; note.hidden = true; chips.hidden = true; chips.replaceChildren();
    if (!id) return;
    const [def, hist] = await Promise.all([
      api(`/materials/${id}/price-default`).catch(() => null),
      api(`/materials/${id}/prices`, { query: { limit: 20 } }).catch(() => null),
    ]);
    if (my !== token) return;
    if (def && def.price > 0) {
      last = { price: Number(def.price) };
      if (def.supplierName && !fapi.manual('supplierName')) fapi.set('supplierName', def.supplierName, { auto: true });
      if (!fapi.manual('priceHint')) putSum(last.price, true);
      note.textContent = `Последняя цена${def.date ? ' от ' + date(def.date) : ''}: ${money(def.price)} ₽ за единицу${def.supplierName ? ', ' + def.supplierName : ''}. Можно поправить.`;
      note.hidden = !money$ && !def.supplierName;
      if (!money$) note.textContent = `Последний поставщик${def.date ? ' (от ' + date(def.date) + ')' : ''}: ${def.supplierName}.`;
    }
    const rows = (hist?.items || hist || []).filter((x) => x && x.price > 0 && (x.supplierName || x.supplierId));
    const seen = new Map();
    for (const x of [...rows].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))) {
      const k = String(x.supplierId || x.supplierName); if (!seen.has(k)) seen.set(k, x);
    }
    if (seen.size >= 2 && money$) {
      chips.replaceChildren(...[...seen.values()].slice(0, 3).map((x) => chip(`${x.supplierName || 'поставщик'} · ${money(x.price)} ₽ · ${date(x.date)}`, () => {
        fapi.set('supplierName', x.supplierName || ''); last = { price: Number(x.price) }; putSum(last.price, false);
      }, 'Подставить поставщика и цену')));
      chips.hidden = false;
    }
  }
  fapi.on('materialId', onMaterial);
  fapi.on('qty', () => { if (last && money$ && !fapi.manual('priceHint')) putSum(last.price, true); });

  // ---- З3 ----
  let tcat = 0;
  async function onSupplier() {
    const my = ++tcat; cat.hidden = true; cat.replaceChildren();
    const name = fapi.get('supplierName');
    if (!name || fapi.get('title').trim() || fapi.get('materialId')) return;
    const sid = await supplierId(name);
    if (!sid || my !== tcat) return;
    const res = await api('/supply/catalog/items', { query: { supplierId: sid, limit: 6 } }).catch(() => null);
    if (!res || my !== tcat || fapi.get('title').trim()) return;
    const items = (res.items || []).slice(0, 6);
    if (!items.length) return;
    cat.append(h('span', { class: 'hint' }, 'Из каталога поставщика: '), ...items.map((it) => chip(`${it.name}${money$ && it.price != null ? ' · ' + money(it.price) + ' ₽' : ''}`, () => {
      fapi.set('title', it.name);
      if (it.article && !String(it.article).startsWith('manual:')) fapi.set('article', it.article);
      if (it.unit && !fapi.manual('unit')) fapi.set('unit', it.unit);
      if (it.materialId) fapi.set('materialId', it.materialId);
      else if (money$ && it.price != null) { last = { price: Number(it.price) }; putSum(last.price, false); }
      cat.hidden = true;
    }, 'Подставить позицию из каталога')));
    cat.hidden = false;
  }
  fapi.on('supplierName', onSupplier);

  // ---- З4 ----
  async function onOrder(fill = true) {
    const ref = fapi.get('salesOrderRef'); orderNote.hidden = true;
    if (!ref) return;
    const [oid, lid] = String(ref).split(':');
    const o = (await ordersLookup({ filter: 'all', lines: true }).catch(() => [])).find((x) => String(x.id) === oid);
    if (!o) return;
    const li = lid ? (o.lines || []).findIndex((l) => String(l.id) === lid) : -1;
    if (fill && o.customer && !fapi.manual('orderLabel') && !fapi.get('orderLabel')) fapi.set('orderLabel', o.customer, { auto: true });
    if (fill && !fapi.get('costCenter')) fapi.set('costCenter', 'order', { auto: true });
    if (li >= 0) {
      const l = o.lines[li];
      if (fill && l.qty && !fapi.manual('qty') && Number(fapi.get('qty')) <= 1) fapi.set('qty', l.qty, { auto: true });
    }
    orderNote.textContent = `Заказ № ${o.productionNo || o.orderNo || '—'}${li >= 0 ? ' поз. ' + (o.lines[li].lineNo || li + 1) : ' (весь заказ)'}${o.customer ? ' · ' + o.customer : ''}`;
    orderNote.hidden = false;
  }
  fapi.on('salesOrderRef', () => onOrder(true));
  setTimeout(() => { onOrder(!fapi.get('num')); if (fapi.get('materialId') && !fapi.get('num')) onMaterial(); }, 0);
}
