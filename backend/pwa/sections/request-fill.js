import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money } from '../core/format.js';
import { ordersLookup } from '../core/orders-lookup.js';

/**
 * Автозаполнение формы заявки (CHAIN-AUDIT З1–З4 + C009 фаза 1).
 *  З1: materialId → GET /materials/:id/price-default: поставщик всегда; сумма с НДС не копируется слепо
 *      (закупка без НДС) — подсказка + чип «Подставить сумму без НДС — проверьте».
 *  З2: история цен ≥ 2 поставщиков → чипы (явная подстановка, цены без НДС).
 *  З3: поставщик без позиции → подсказка из каталога поставщика.
 *  C009: по materialId — read-only «В каталоге сейчас …»; нет закупки — «Ещё не закупали…».
 *  З4: заказ → заказчик / кол-во + строка «Заказ № N поз M».
 * Руками правленное (api.manual) не перетираем.
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
  const catHint = h('div', { class: 'hint rq-note', hidden: true });
  fapi.field('supplierName')?.append(note, chips, cat);
  fapi.field('priceHint')?.append(catHint);
  const orderNote = h('div', { class: 'hint rq-note', hidden: true });
  fapi.field('salesOrderRef')?.append(orderNote);
  let last = null; // { price } — цена за единицу из последней закупки (без НДС); в сумму — только по чипу
  let applied = false; // пользователь нажал чип подстановки суммы
  let token = 0;

  const chip = (text, onclick, title) => h('button', { type: 'button', class: 'tag rq-chip', title, onclick }, text);
  const sum = (price) => round(price * (Number(fapi.get('qty')) || 1));
  const putSum = (price, auto) => { if (money$) fapi.set('priceHint', sum(price), { auto }); };

  // ---- З1 + З2 + C009 каталог ----
  async function onMaterial() {
    const id = fapi.get('materialId'); const my = ++token;
    last = null; applied = false;
    note.hidden = true; chips.hidden = true; chips.replaceChildren();
    catHint.hidden = true; catHint.textContent = '';
    if (!id) return;
    const [def, hist, catalog] = await Promise.all([
      api(`/materials/${id}/price-default`).catch(() => null),
      api(`/materials/${id}/prices`, { query: { limit: 20 } }).catch(() => null),
      api('/supply/catalog/items', { query: { materialId: id, limit: 5 } }).catch(() => null),
    ]);
    if (my !== token) return;

    const price = def && def.price != null ? Number(def.price) : NaN;
    const hasPrice = Number.isFinite(price) && price > 0;
    const hasSup = !!(def && def.supplierName);

    if (hasSup && !fapi.manual('supplierName')) fapi.set('supplierName', def.supplierName, { auto: true });

    if (hasPrice || hasSup) {
      if (hasPrice) last = { price };
      if (money$ && hasPrice) {
        note.textContent = `Последняя закупка${def.date ? ' от ' + date(def.date) : ''}: ${money(def.price)} ₽ за ед. без НДС${def.supplierName ? ' · ' + def.supplierName : ''}. В заявке — сумма с НДС.`;
        note.hidden = false;
      } else if (hasSup) {
        note.textContent = `Последний поставщик${def.date ? ' (от ' + date(def.date) + ')' : ''}: ${def.supplierName}.`;
        note.hidden = false;
      }
    } else {
      note.textContent = 'Ещё не закупали — укажите поставщика и цену сами.';
      note.hidden = false;
    }

    const parts = [];
    if (money$ && hasPrice) {
      parts.push(chip('Подставить сумму без НДС — проверьте', () => {
        applied = true; putSum(last.price, true);
      }, 'Закупка без НДС; в заявке нужна сумма с НДС — проверьте перед сохранением'));
    }

    const rows = (hist?.items || hist || []).filter((x) => x && x.price > 0 && (x.supplierName || x.supplierId));
    const seen = new Map();
    for (const x of [...rows].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))) {
      const k = String(x.supplierId || x.supplierName); if (!seen.has(k)) seen.set(k, x);
    }
    if (seen.size >= 2 && money$) {
      for (const x of [...seen.values()].slice(0, 3)) {
        parts.push(chip(`${x.supplierName || 'поставщик'} · ${money(x.price)} ₽ · ${date(x.date)}`, () => {
          fapi.set('supplierName', x.supplierName || '');
          last = { price: Number(x.price) };
          applied = true;
          putSum(last.price, true);
        }, 'Подставить поставщика и сумму без НДС — в заявке нужна сумма с НДС'));
      }
    }
    if (parts.length) { chips.replaceChildren(...parts); chips.hidden = false; }

    // Подсказка каталога — только показ, поля заявки не трогаем (ЕН-1 / СКЕ-1)
    if (money$) {
      const catItems = (catalog?.items || []).filter((it) => it && it.priceHint != null);
      if (catItems.length) {
        const bits = catItems.slice(0, 3).map((it) => [
          it.supplierName || 'поставщик',
          money(it.priceHint) + ' ₽',
        ].filter(Boolean).join(' · '));
        catHint.textContent = 'В каталоге сейчас: ' + bits.join('; ') + ' — заявка не меняется.';
        catHint.hidden = false;
      }
    }
  }
  fapi.on('materialId', onMaterial);
  // Пересчёт суммы при смене qty — только после явного чипа (не при автовыборе позиции)
  fapi.on('qty', () => { if (applied && last && money$ && !fapi.manual('priceHint')) putSum(last.price, true); });

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
    cat.append(h('span', { class: 'hint' }, 'Из каталога поставщика: '), ...items.map((it) => chip(`${it.name}${money$ && it.priceHint != null ? ' · ' + money(it.priceHint) + ' ₽' : ''}`, () => {
      fapi.set('title', it.name);
      if (it.article && !String(it.article).startsWith('manual:')) fapi.set('article', it.article);
      if (it.unit && !fapi.manual('unit')) fapi.set('unit', it.unit);
      if (it.materialId) fapi.set('materialId', it.materialId);
      else if (money$ && it.priceHint != null) { last = { price: Number(it.priceHint) }; applied = true; putSum(last.price, true); }
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
