import { api, apiFile } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, parseNum } from '../core/format.js';
import { go } from '../core/router.js';
import { badge } from '../ui/badges.js';
import { confirmDlg } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { incomeLookups } from './orders.js';

/**
 * Раздел «КП» (KP-1): коммерческие предложения хранятся на сервере (/offers), у каждого номер, статус и PDF с фоном.
 * Список → карточка в правой панели; форма: шапка, строки, условия, фоны страниц. Статусы меняются словами («Отправлено клиенту»…).
 * Корзина «В КП» живёт в sections/kp.js: «Сформировать» создаёт здесь запись.
 */
export const STATUS = {
  draft: { label: 'Черновик', tone: 'dim' },
  sent: { label: 'Отправлено', tone: 'info' },
  accepted: { label: 'Принято', tone: 'primary' },
  paid: { label: 'Оплачено', tone: 'ok' },
  rejected: { label: 'Отклонено', tone: 'danger' },
  cancelled: { label: 'Отменено', tone: 'dim' },
};
const ORDER = ['draft', 'sent', 'accepted', 'paid', 'rejected', 'cancelled'];
const day = (v) => String(v || '').slice(0, 10);
const num = (v) => { const n = parseNum(String(v ?? '')); return Number.isFinite(n) ? n : 0; };
const lineSum = (l) => Math.round(num(l.quantity) * num(l.unitPrice) * 100) / 100;

// ---------- фоны страниц ----------
let bgP = null;
const backgrounds = () => (bgP ||= api('/offers/backgrounds').then((r) => (Array.isArray(r) ? r : r?.items || [])).catch(() => { bgP = null; return []; }));

/** Выбор фона страницы + «Загрузить свой». Значение — id фона (пусто — встроенный). */
function bgWidget(page, initial) {
  const sel = h('select', { 'aria-label': page === 1 ? 'Фон первой страницы' : 'Фон второй и следующих страниц' });
  const fill = async (keep) => {
    const all = (await backgrounds()).filter((b) => Number(b.page) === page);
    sel.replaceChildren(h('option', { value: '' }, 'Встроенный (по умолчанию)'), ...all.map((b) => h('option', { value: b.id }, b.name + (b.isDefault ? ' · по умолчанию' : ''))));
    sel.value = all.some((b) => b.id === keep) ? keep : '';
  };
  fill(initial);
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true });
  const up = h('button', { type: 'button', class: 'btn btn-sm', title: 'PNG или JPG до 5 МБ, размер страницы А4' }, '+ Загрузить свой фон');
  up.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    up.disabled = true; up.classList.add('is-busy');
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('name', f.name.replace(/\.[^.]+$/, '').slice(0, 80)); fd.append('page', String(page));
      const saved = await api('/offers/backgrounds', { method: 'POST', body: fd });
      bgP = null; await fill(saved?.id); toast('Фон загружен');
    } catch (e) { toastError(e, 'загрузить фон'); } finally { up.disabled = false; up.classList.remove('is-busy'); file.value = ''; }
  });
  return { el: h('div', { class: 'of-bg' }, sel, up, file), get value() { return sel.value; }, set value(_) { /* только показ */ } };
}

// ---------- строки ----------
/** Таблица строк КП: название*, кол-во*, ед., цена, цвет, размер. Значение — JSON списка. */
function itemsWidget(initial) {
  const rows = (Array.isArray(initial) ? initial : []).map((l) => ({ ...l }));
  const box = h('div', { class: 'of-lines' });
  const total = h('div', { class: 'of-total num' });
  const sum = () => { total.textContent = `Итого: ${money(rows.reduce((s, l) => s + lineSum(l), 0))}`; };
  let dlSeed = 0;
  const paint = () => {
    sum();
    box.replaceChildren(...rows.map((l, i) => {
      const inp = (key, label, extra = {}) => {
        const el = h('input', { value: l[key] ?? '', 'aria-label': label, placeholder: extra.ph || label, inputmode: extra.dec ? 'decimal' : undefined, maxlength: extra.max || 200 });
        el.addEventListener('input', () => { l[key] = el.value; el.classList.remove('has-error'); if (extra.dec) sumRow(); });
        return el;
      };
      const sumEl = h('span', { class: 'of-sum num' });
      const sumRow = () => { sumEl.textContent = lineSum(l) ? money(lineSum(l)) : ''; sum(); };
      const name = inp('productName', 'Название *', { max: 300 });
      const q = inp('quantity', 'Кол-во', { dec: true, ph: 'Кол' });
      const price = inp('unitPrice', 'Цена, ₽', { dec: true, ph: 'Цена' });
      const unitInp = inp('unit', 'Ед.', { ph: 'шт', max: 20 });
      const uid = `of-u-${++dlSeed}`;
      unitInp.setAttribute('list', uid);
      const unitDl = h('datalist', { id: uid }, ...['шт', 'компл.', 'пар', 'м', 'м²', 'кг'].map((u) => h('option', { value: u })));
      l._name = name; l._qty = q;
      sumRow();
      return h('div', { class: 'of-line' },
        h('div', { class: 'of-l1' },
          h('b', { class: 'of-n' }, String(i + 1)), name,
          q, unitInp, price, sumEl,
          h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', title: 'Убрать строку', 'aria-label': 'Убрать строку', onclick: () => { rows.splice(i, 1); paint(); } }, '×'),
          unitDl),
        h('div', { class: 'of-l3' }, inp('color', 'Цвет', { max: 80 }), inp('size', 'Размер', { max: 80 })));
    }), h('div', { class: 'of-add' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { rows.push({ productName: '', quantity: '1', unit: 'шт', unitPrice: '' }); paint(); rows.at(-1)._name.focus(); } }, '+ Строка'), total));
  };
  if (!rows.length) rows.push({ productName: '', quantity: '1', unit: 'шт', unitPrice: '' });
  paint();
  return {
    el: box,
    get value() {
      return JSON.stringify(rows.map((l) => {
        const o = { productName: String(l.productName || '').trim(), quantity: num(l.quantity), unit: String(l.unit || '').trim() || 'шт' };
        if (String(l.unitPrice ?? '') !== '' && num(l.unitPrice) > 0) o.unitPrice = num(l.unitPrice);
        for (const k of ['productId', 'productSku', 'description', 'color', 'size', 'photoUrl']) if (l[k]) o[k] = String(l[k]).trim();
        return o;
      }));
    },
    set value(_) { /* только показ */ },
    /** Подсветить незаполненное; true — всё в порядке. */
    check() {
      let ok = true;
      rows.forEach((l) => { if (!String(l.productName || '').trim()) { l._name.classList.add('has-error'); ok = false; } if (!(num(l.quantity) > 0)) { l._qty.classList.add('has-error'); ok = false; } });
      return ok;
    },
  };
}

// ---------- форма ----------
let formItems = null; // виджет строк открытой формы — для подсветки при сохранении
const fields = async () => {
  const il = await incomeLookups().catch(() => ({ companies: [], customers: [] }));
  return [
    { section: 'Предложение', tone: 'main', fixed: true },
    { key: 'companyId', label: 'Наша компания', type: 'select', required: true, choose: true, options: (il.companies || []).map((c) => ({ value: c.id, label: c.name })) },
    { key: 'customer', label: 'Заказчик', type: 'combo', required: true, max: 300, options: (il.customers || []).map((x) => ({ value: x, label: x })), hint: 'Кому адресовано предложение' },
    { key: 'date', label: 'Дата', type: 'date', required: true },
    { key: 'validUntil', label: 'Действительно до', type: 'date', required: true },
    { key: 'title', label: 'Тема', max: 200, wide: true, hint: 'Необязательно — для себя, в PDF не попадает' },
    { section: 'Изделия', tone: 'money', fixed: true },
    { key: 'items', label: 'Строки', type: 'widget', wide: true, widget: (v) => (formItems = itemsWidget(v)) },
    { section: 'Условия', tone: 'info' },
    { key: 'prepaymentPercent', label: 'Предоплата, %', type: 'number', min: 0 },
    { key: 'productionDays', label: 'Срок изготовления, дн.', type: 'number', min: 0 },
    { key: 'deliveryDays', label: 'Срок доставки, дн.', type: 'number', min: 0 },
    { key: 'terms', label: 'Условия', type: 'textarea', wide: true, hint: 'Оплата, гарантия, монтаж — попадёт в PDF' },
    { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
    { section: 'Фон PDF', tone: 'who', collapsed: true },
    { key: 'bg1Id', label: 'Фон 1-й страницы', type: 'widget', wide: true, widget: (v) => bgWidget(1, v) },
    { key: 'bg2Id', label: 'Фон 2-й и следующих', type: 'widget', wide: true, widget: (v) => bgWidget(2, v), hint: 'Подпись и печать — часть фона: текст в них не заходит' },
  ];
};
const numOrNull = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const toBody = (v) => {
  if (formItems && !formItems.check()) throw new Error('В строках укажите название и количество');
  const items = Array.isArray(v.items) ? v.items : [];
  if (!items.length) throw new Error('Добавьте хотя бы одну строку');
  const clean = (s) => (s === null || s === undefined ? '' : String(s).trim());
  return {
    companyId: v.companyId, customer: clean(v.customer), date: v.date, validUntil: v.validUntil, title: clean(v.title),
    items,
    prepaymentPercent: numOrNull(v.prepaymentPercent), productionDays: numOrNull(v.productionDays), deliveryDays: numOrNull(v.deliveryDays),
    terms: clean(v.terms), notes: clean(v.notes), bg1Id: v.bg1Id || '', bg2Id: v.bg2Id || '',
  };
};
const strip = (b) => Object.fromEntries(Object.entries(b).filter(([, x]) => x !== undefined && x !== ''));

// ---------- карточка ----------
const pdf = async (r) => { const name = await apiFile(`/offers/${r.id}/pdf`, { fallback: `КП-${r.number || 'без-номера'}.pdf` }); toast(`Скачан: ${name}`); };
const setStatus = async (r, ctx, status) => {
  const res = await api(`/offers/${r.id}/status`, { method: 'POST', body: { status } });
  toast(`КП ${r.number}: ${STATUS[status].label}`);
  ctx.setRow(res?.id && res.items ? res : await api(`/offers/${r.id}`));
};
const actions = (r) => {
  const to = (status, label, extra = {}) => ({ label, run: (row, ctx) => setStatus(row, ctx, status), ...extra });
  const out = [{ label: '⇩ Скачать PDF', run: (row) => pdf(row), primary: r.status === 'paid' || r.status === 'rejected' || r.status === 'cancelled' }];
  if (r.status === 'draft') out.push(to('sent', 'Отметить: отправлено клиенту', { primary: true }));
  if (r.status === 'sent') out.push(to('accepted', 'Отметить: принято клиентом', { primary: true }));
  if (r.status === 'accepted') out.push(to('paid', 'Отметить: оплачено', { primary: true }));
  if (['draft', 'sent', 'accepted'].includes(r.status)) out.push(to('rejected', 'Отметить: отклонено клиентом', { more: true }));
  if (!['paid', 'cancelled'].includes(r.status)) {
    out.push({ label: 'Отменить КП', more: true, run: async (row, ctx) => {
      if (!(await confirmDlg(`Отменить КП ${row.number}?`, 'КП останется в списке со статусом «Отменено».', { okText: 'Да, отменить' }))) return;
      await setStatus(row, ctx, 'cancelled');
    } });
  }
  return out;
};

const cell = (v) => v || h('span', { class: 'muted' }, '—');
const totalOf = (r) => (r.total ? money(r.total) : h('span', { class: 'muted' }, 'без цены'));

export const offers = {
  id: 'offers',
  title: 'КП',
  newTitle: 'Новое КП',
  noun: 'КП',
  entityType: 'CommercialOffer',
  get: (id) => api(`/offers/${id}`),
  list: {
    path: '/offers',
    viewKey: 'offers',
    sortDefault: '-date',
    export: false,
    createLabel: 'КП',
    searchPlaceholder: 'Поиск: номер, заказчик…',
    emptyText: 'КП ещё нет.',
    emptyHint: 'Добавьте изделия из «Продукции» кнопкой «В КП» или нажмите «+ КП».',
    filters: [
      { key: 'status', label: 'Статус', type: 'chips', options: () => ORDER.map((k) => ({ value: k, label: STATUS[k].label })),
        count: (resp, v) => (v === '' ? Object.values(resp.counts || {}).reduce((s, n) => s + (Number(n) || 0), 0) : resp.counts?.[v] || 0) },
    ],
    columns: [
      { key: 'number', label: '№ КП', sort: 'number', cls: 'nowrap', render: (r) => h('b', null, r.number || '—') },
      { key: 'date', label: 'Дата', sort: 'date', cls: 'nowrap', render: (r) => date(r.date) },
      { key: 'customer', label: 'Заказчик', cls: 'clip', render: (r) => cell(r.customer) },
      { key: 'total', label: 'Сумма', sort: 'total', cls: 'num right nowrap', render: totalOf },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => badge(STATUS, r.status) },
    ],
    card: {
      title: (r) => [r.number || 'КП', r.customer].filter(Boolean).join(' · '),
      sub: (r) => [date(r.date), r.total ? money(r.total) : 'без цены'].filter(Boolean).join(' · '),
      side: (r) => [badge(STATUS, r.status)],
    },
  },
  card: {
    heading: (r) => `${r.number || 'КП'}`,
    subheading: (r) => [r.customer, STATUS[r.status]?.label].filter(Boolean).join(' · '),
    view: (r) => [
      ['Заказчик', r.customer], ['Дата', date(r.date)], ['Действительно до', r.validUntil ? date(r.validUntil) : ''],
      ['Сумма', r.total ? money(r.total) : 'цены не указаны'],
      ['Предоплата', r.prepaymentPercent ? `${r.prepaymentPercent} %` : ''], ['Срок изготовления', r.productionDays ? `${r.productionDays} дн.` : ''], ['Срок доставки', r.deliveryDays ? `${r.deliveryDays} дн.` : ''],
      ['Условия', r.terms], ['Примечание', r.notes],
      ['Статус', badge(STATUS, r.status)],
    ],
    extra: (r) => h('div', { class: 'of-view' },
      h('div', { class: 'section-title' }, `Изделия: ${(r.items || []).length}`),
      r.status === 'paid' ? h('p', { class: 'hint' }, 'КП оплачено — править его нельзя.') : null,
      r.status === 'draft' && (r.items || []).some((l) => !l.unitPrice) ? h('p', { class: 'hint' }, 'Чтобы отметить «отправлено клиенту», укажите цену у каждой строки.') : null,
      r.status === 'accepted' ? h('p', { class: 'hint' }, 'После отметки «оплачено» КП нельзя править.') : null,
      h('ol', { class: 'of-items' }, ...(r.items || []).map((l) => h('li', null,
        h('b', null, l.productName), h('span', { class: 'muted' }, [l.color, l.size].filter(Boolean).map((x) => ' · ' + x).join('')),
        h('div', { class: 'muted small' }, `${l.quantity} ${l.unit || 'шт'}${l.unitPrice ? ` × ${money(l.unitPrice)} = ${money(l.total ?? lineSum(l))}` : ' · цена не указана'}`))))),
    actions,
  },
  form: {
    fields,
    initial: () => ({ date: isoDay(), items: [] }),
    toInitial: (r) => ({ ...r, companyId: r.companyId ? String(r.companyId) : '', date: day(r.date), validUntil: day(r.validUntil), bg1Id: r.bg1Id ? String(r.bg1Id) : '', bg2Id: r.bg2Id ? String(r.bg2Id) : '', items: r.items || [] }),
    toBody,
    create: (b) => api('/offers', { method: 'POST', body: strip(b) }),
    update: (id, b) => api(`/offers/${id}`, { method: 'PATCH', body: { ...strip(b), bg1Id: b.bg1Id || null, bg2Id: b.bg2Id || null } }),
  },
  remove: {
    text: (r) => `Удалить КП ${r.number}?`,
    run: (r) => api(`/offers/${r.id}`, { method: 'DELETE' }),
  },
  open: (id) => go('offers', { open: id }),
  searchRow: (r) => ({ title: [r.number, r.customer].filter(Boolean).join(' · '), sub: date(r.date), side: badge(STATUS, r.status) }),
};

/** Создать КП из корзины (sections/kp.js). 404 — сервер старый: вернуть null, вызвавший печатает по-старому. */
export async function createOffer(body) {
  try { return await api('/offers', { method: 'POST', body }); }
  catch (e) { if (e?.status === 404) return null; throw e; }
}
