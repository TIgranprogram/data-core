import { api, patchVersioned } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { modal } from '../ui/kit/dialog.js';
import { toast } from '../ui/kit/toast.js';
import { patch } from '../core/router.js';
import { button, select } from '../ui/kit/index.js';

/**
 * Позиции заказа трёх видов: изделие / новое изделие (ждёт проектировщика) / услуга (справочник «Услуги»).
 * Форма позиции (orders.js) берёт отсюда поля и правила; карточка заказа (salesorders.js) — метки и «Распределение».
 */

export const LINE_TYPES = [
  { value: 'product', label: 'Изделие из «Продукции»' },
  { value: 'new_product', label: 'Новое изделие (нет в «Продукции»)' },
  { value: 'service', label: 'Услуга' },
];

let typesP = null;
/** Услуги из справочника «Услуги». Создавать отсюда нельзя — только Справочники → Услуги. */
export const serviceTypes = () => (typesP ??= api('/dicts/services')
  .then((r) => (r.items || []).map((x) => ({ value: String(x.id), label: x.name })))
  .catch(() => { typesP = null; return []; }));

export const NO_TYPES = 'Нет услуг в справочнике. Добавьте их в Справочники → Услуги.';

/**
 * «Есть варианты» (ВР) под выбором изделия: у выбранного изделия есть основное или варианты — ссылки «арт. … · размеры · цвет»;
 * нажатие ставит этот вариант. `load(id)` — показать для изделия, `onPick(id, label)` — выбрать.
 */
export function variantsHint(onPick) {
  const box = h('div', { class: 'hint', hidden: true });
  let seq = 0;
  const load = (id) => {
    const my = ++seq; box.hidden = true; box.replaceChildren();
    if (!id) return;
    api(`/showcase/${id}/variants`).then((r) => {
      const items = r?.items || [];
      if (my !== seq || !items.length) return;
      const label = (v) => [`арт. ${v.sku}`, v.isBase ? 'основное' : '', v.dimensions ? ['length', 'width', 'height'].map((k) => v.dimensions[k] || '—').join('×') : '', (v.colors || []).join(', ')].filter(Boolean).join(' · ');
      box.append('Есть варианты: ', ...items.flatMap((v, i) => [i ? ', ' : '', h('a', { href: '#', onclick: (e) => { e.preventDefault(); onPick(v.id, `${v.name} (${v.sku})`); } }, label(v))]));
      box.hidden = false;
    }).catch(() => {});
  };
  return { box, load };
}

const PRICE_HINT = {
  product: '',
  new_product: 'Цена обязательна: без неё новое изделие не сохранится.',
  service: 'Цена услуги обязательна.',
};

/** Поля «что добавляем» для новой позиции (вставляются первыми в раздел «Позиция заказа»). */
export async function lineTypeFields() {
  const types = await serviceTypes();
  return [
    { key: 'lineType', label: 'Что добавляем', type: 'select', required: true, wide: true, options: LINE_TYPES,
      hint: 'Сначала поищите изделие в «Продукции». Не нашли — «Новое изделие»: проектировщик получит заявку.',
      mount: (f) => {
        const priceBox = h('div', { class: 'hint' });
        f.field('unitPrice')?.append(priceBox);
        const noTypes = h('div', { class: 'hint', hidden: true }, NO_TYPES);
        f.field('serviceId')?.append(noTypes);
        const apply = () => {
          const t = f.get('lineType') || 'product';
          const show = (k, on) => { const el = f.field(k); if (el) el.hidden = !on; };
          show('productId', t === 'product');
          show('serviceId', t === 'service');
          noTypes.hidden = t !== 'service' || types.length > 0;
          priceBox.textContent = PRICE_HINT[t] || '';
          priceBox.hidden = !PRICE_HINT[t];
        };
        f.on('lineType', apply); apply();
      } },
    { key: 'serviceId', label: 'Услуга', type: 'select', wide: true, options: types,
      mount: (f) => {
        f.on('serviceId', () => {
          const t = types.find((x) => x.value === f.get('serviceId'));
          if (t && (!String(f.get('title')).trim() || types.some((x) => x.label === f.get('title')))) f.set('title', t.label);
        });
      } },
  ];
}

/** Поля формы → тело POST /incomes: тип, услуга; лишнее убирается. Возвращает тело или бросает понятную ошибку. */
export function lineBody(body, v) {
  const t = v.lineType;
  if (!t) return body;
  const price = Number(body.unitPrice) || 0;
  if (t === 'product') {
    if (body.productId) body.lineType = 'product';
    delete body.serviceId; return body;
  }
  delete body.productId;
  if (t === 'new_product') {
    if (!String(body.title || '').trim()) throw new Error('Впишите название нового изделия');
    if (!(price > 0)) throw new Error('Впишите цену нового изделия — без неё позиция не сохранится');
    body.lineType = 'new_product';
    delete body.serviceId;
  } else {
    if (!v.serviceId) throw new Error('Выберите услугу из справочника');
    if (!(price > 0)) throw new Error('Впишите цену услуги — без неё позиция не сохранится');
    body.lineType = 'service'; body.serviceId = v.serviceId;
  }
  return body;
}

/** Состояние позиции словами менеджера (null — обычная распределённая). */
export function lineMark(l) {
  if (l.lineType === 'service') return h('span', { class: 'badge info', title: 'Услуга: в производство не идёт' }, 'Услуга');
  if (l.lineType === 'new_product' && l.unassigned !== false && !l.productId) return h('span', { class: 'badge warn', title: 'Заявка ушла проектировщику. Пока изделие не подтверждено, «В производство» недоступно.' }, 'Новое изделие, ждёт проектировщика');
  if (l.unassigned) return h('span', { class: 'badge warn', title: 'Позиция не связана с изделием и не услуга: распределите её ниже.' }, 'Не распределена');
  return null;
}

export const countOf = (o) => Number(o?.unassignedCount ?? (o?.orders ? o.orders.reduce((s, x) => s + countOf(x), 0) : (o?.lines || []).filter((l) => l.unassigned && !l.cancelledAt).length)) || 0;

/** Плашка-счётчик «не распределено: N». */
export const countBadge = (n) => (n > 0 ? h('span', { class: 'badge warn', title: 'Позиции без изделия и не услуги. Пока они есть, «В производство» недоступно.' }, `Не распределено: ${qty(n)}`) : null);

/** «Это услуга»: 2 поля в окне — услуга и цена. */
function serviceDialog(l) {
  const sel = select({ label: 'Услуга', options: [['', 'Выберите…']] });
  const price = h('input', { type: 'number', min: '0', step: 'any', placeholder: 'Цена за единицу, ₽', value: l.unitPrice ? String(l.unitPrice) : '' });
  const note = h('p', { class: 'hint' }, 'Услуга не идёт в производство и не требует изделия. Список — из Справочники → Услуги.');
  serviceTypes().then((ts) => { sel.append(...ts.map((t) => h('option', { value: t.value }, t.label))); if (!ts.length) note.textContent = NO_TYPES; });
  return modal({
    title: 'Это услуга', okText: 'Сохранить',
    body: h('div', null, note, h('label', { class: 'field' }, h('span', null, 'Услуга'), sel), h('label', { class: 'field' }, h('span', null, 'Цена, ₽'), price)),
    onOk: async () => {
      if (!sel.value) throw new Error('Выберите услугу из справочника');
      if (!(Number(price.value) > 0)) throw new Error('Впишите цену услуги');
      return patchVersioned(`/incomes/${l.id}`, l, { lineType: 'service', serviceId: sel.value, unitPrice: Number(price.value) });
    },
  });
}

async function newProduct(l) {
  await api('/product-requests', { method: 'POST', body: { incomeId: l.id } });
  toast('Заявка ушла проектировщику. Позиция ждёт нового изделия.');
  return true;
}

/** Блок «Распределение» в договоре: позиции без изделия, у каждой три выхода. Нет таких — null. */
export function distribBlock(o, reload) {
  const open = (o.lines || []).filter((l) => l.unassigned && !l.cancelledAt && !(l.lineType === 'new_product' && l.productRequestId));
  if (!open.length) return null;
  const done = (r) => { if (r) { window.dispatchEvent(new CustomEvent('data-changed')); reload?.(); } };
  const fail = (e) => toast(e?.message || 'Не получилось');
  const row = (l) => h('li', { class: 'ol-row' },
    h('div', { class: 'ol-name' }, h('b', null, l.title || 'Без названия'), h('span', { class: 'muted' }, ` · ${qty(l.qty)} ${l.unit || ''}`.trimEnd())),
    h('div', { class: 'ol-acts' },
      button({ label: 'Подобрать изделие', size: 'S', title: 'Найти изделие в «Продукции» и связать с позицией', onClick: () => patch({ of: 'matching', open: o.id, new: undefined }, { replace: false }) }),
      button({ label: 'Новое изделие', size: 'S', title: 'Изделия ещё нет: проектировщик получит заявку', onClick: (e) => { const b = e.currentTarget; b.classList.add('is-busy'); newProduct(l).then(done).catch(fail).finally(() => b.classList.remove('is-busy')); } }),
      button({ label: 'Это услуга', size: 'S', title: 'Услуга из справочника — изделие не нужно', onClick: () => serviceDialog(l).then(done).catch(fail) })));
  return h('div', { class: 'ol-box' },
    h('div', { class: 'ol-head' }, h('b', null, 'Распределение'), ' ', countBadge(open.length)),
    h('p', { class: 'hint' }, 'У этих позиций нет изделия. Выберите изделие, закажите новое у проектировщика или отметьте услугой — иначе «В производство» не включится.'),
    h('ul', { class: 'ol-list' }, ...open.map(row)));
}
