import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { patch } from '../core/router.js';

/**
 * Позиции заказа трёх видов: изделие / новое изделие (ждёт проектировщика) / услуга (Доставка, Монтаж).
 * Форма позиции (orders.js) берёт отсюда поля и правила; карточка заказа (salesorders.js) — метки и «Распределение».
 */

export const LINE_TYPES = [
  { value: 'product', label: 'Изделие из «Продукции»' },
  { value: 'new_product', label: 'Новое изделие (нет в «Продукции»)' },
  { value: 'service', label: 'Услуга (доставка, монтаж)' },
];

let typesP = null;
/** Виды работ «Доставка» и «Монтаж» из справочника. Создавать их отсюда нельзя. */
export const serviceTypes = () => (typesP ??= api('/dicts/worktypes')
  .then((r) => (r.items || []).filter((x) => /доставк|монтаж/i.test(x.name || '')).map((x) => ({ value: String(x.id), label: x.name })))
  .catch(() => { typesP = null; return []; }));

export const NO_TYPES = 'Нет видов работ «Доставка» и «Монтаж». Добавьте их в Справочники → Виды работ.';

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
        f.field('workTypeId')?.append(noTypes);
        const apply = () => {
          const t = f.get('lineType') || 'product';
          const show = (k, on) => { const el = f.field(k); if (el) el.hidden = !on; };
          show('productId', t === 'product');
          show('workTypeId', t === 'service');
          noTypes.hidden = t !== 'service' || types.length > 0;
          priceBox.textContent = PRICE_HINT[t] || '';
          priceBox.hidden = !PRICE_HINT[t];
        };
        f.on('lineType', apply); apply();
      } },
    { key: 'workTypeId', label: 'Услуга', type: 'select', wide: true, options: types,
      mount: (f) => {
        f.on('workTypeId', () => {
          const t = types.find((x) => x.value === f.get('workTypeId'));
          if (t && (!String(f.get('title')).trim() || types.some((x) => x.label === f.get('title')))) f.set('title', t.label);
        });
      } },
  ];
}

/** Поля формы → тело POST /incomes: тип, вид работ; лишнее убирается. Возвращает тело или бросает понятную ошибку. */
export function lineBody(body, v) {
  const t = v.lineType;
  if (!t) return body;
  const price = Number(body.unitPrice) || 0;
  if (t === 'product') {
    if (body.productId) body.lineType = 'product';
    delete body.workTypeId; return body;
  }
  delete body.productId;
  if (t === 'new_product') {
    if (!String(body.title || '').trim()) throw new Error('Впишите название нового изделия');
    if (!(price > 0)) throw new Error('Впишите цену нового изделия — без неё позиция не сохранится');
    body.lineType = 'new_product';
  } else {
    if (!v.workTypeId) throw new Error('Выберите услугу: Доставка или Монтаж');
    if (!(price > 0)) throw new Error('Впишите цену услуги — без неё позиция не сохранится');
    body.lineType = 'service'; body.workTypeId = v.workTypeId;
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
  const sel = h('select', null, h('option', { value: '' }, 'Выберите…'));
  const price = h('input', { type: 'number', min: '0', step: 'any', placeholder: 'Цена за единицу, ₽', value: l.unitPrice ? String(l.unitPrice) : '' });
  const note = h('p', { class: 'hint' }, 'Услуга не идёт в производство и не требует изделия.');
  serviceTypes().then((ts) => { sel.append(...ts.map((t) => h('option', { value: t.value }, t.label))); if (!ts.length) note.textContent = NO_TYPES; });
  return modal({
    title: 'Это услуга', okText: 'Сохранить',
    body: h('div', null, note, h('label', { class: 'field' }, h('span', null, 'Услуга'), sel), h('label', { class: 'field' }, h('span', null, 'Цена, ₽'), price)),
    onOk: async () => {
      if (!sel.value) throw new Error('Выберите услугу: Доставка или Монтаж');
      if (!(Number(price.value) > 0)) throw new Error('Впишите цену услуги');
      return api(`/incomes/${l.id}`, { method: 'PATCH', body: { lineType: 'service', workTypeId: sel.value, unitPrice: Number(price.value) } });
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
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Найти изделие в «Продукции» и связать с позицией', onclick: () => patch({ of: 'matching', open: o.id, new: undefined }, { replace: false }) }, 'Подобрать изделие'),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Изделия ещё нет: проектировщик получит заявку', onclick: (e) => { const b = e.currentTarget; b.classList.add('is-busy'); newProduct(l).then(done).catch(fail).finally(() => b.classList.remove('is-busy')); } }, 'Новое изделие'),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Доставка или монтаж — изделие не нужно', onclick: () => serviceDialog(l).then(done).catch(fail) }, 'Это услуга')));
  return h('div', { class: 'ol-box' },
    h('div', { class: 'ol-head' }, h('b', null, 'Распределение'), ' ', countBadge(open.length)),
    h('p', { class: 'hint' }, 'У этих позиций нет изделия. Выберите изделие, закажите новое у проектировщика или отметьте услугой — иначе «В производство» не включится.'),
    h('ul', { class: 'ol-list' }, ...open.map(row)));
}
