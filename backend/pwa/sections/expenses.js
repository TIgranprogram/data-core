import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, plural } from '../core/format.js';
import { patch } from '../core/router.js';
import { grp, link, photoField } from '../ui/kit/index.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { incomeLookups } from './orders.js';

/**
 * «Прочие расходы» (C027): расходы без заявки — аренда, налоги, коммуналка. Только факт.
 * Сервер: GET/POST /expenses, GET/PATCH/DELETE /expenses/:id. Статьи — GET /expense-articles (дерево «Статья → Подстатья»).
 * Панель справа: `of=expense&open=<id>` (из «Денег») или своя панель раздела «Прочие расходы».
 * Тут же общий выбор статьи (articleTree / articleField) — его берут «Деньги» и форма заявки.
 */
let treeP = null; let treeAt = 0;
/** Дерево статей расходов (кэш 60 с). */
export function articleTree() {
  if (!treeP || Date.now() - treeAt > 60000) {
    treeAt = Date.now();
    const p = api('/expense-articles').then((r) => r.items || []);
    p.catch(() => { if (treeP === p) treeP = null; });
    treeP = p;
  }
  return treeP;
}
/** Подстатьи списком «Статья → Подстатья» для выбора. */
export const articleOptions = (tree, empty) => [{ value: '', label: empty }, ...tree.flatMap((a) => (a.children || []).map((c) => ({ value: String(c.id), label: `${a.name} → ${c.name}` })))];
/** Подстатья, привязанная к категории заявки (id подстатьи или ''). */
export const articleByCategory = (tree, categoryId) => String(tree.flatMap((a) => a.children || []).find((c) => (c.categoryIds || []).map(String).includes(String(categoryId)))?.id || '');

const orderText = (o) => ['№ ' + (o.orderNo || '—'), o.customer, o.title].filter(Boolean).join(' · ');
/** Заказы заказчиков для выбора объекта. */
export const orderChoices = async (empty) => [{ value: '', label: empty }, ...(await ordersLookup({ filter: 'all' }).catch(() => [])).map((o) => ({ value: String(o.id), label: orderText(o) }))];

const clean = (v) => String(v ?? '').trim();
const filesWidget = (known = []) => {
  const pf = photoField(known, { pdf: true }); // счёт — PDF или фото
  return { el: pf.el, get value() { return JSON.stringify(pf.ids()); }, set value(_) { /* файлы уже показаны */ } };
};
const bodyOf = (v) => ({
  date: String(v.date || ''), amount: Number(v.amount) || 0, companyId: String(v.companyId || ''), articleId: String(v.articleId || ''),
  title: clean(v.title), salesOrderId: v.salesOrderId ? String(v.salesOrderId) : null, counterpartyName: clean(v.counterpartyName),
  docNo: clean(v.docNo), fileIds: Array.isArray(v.fileIds) ? v.fileIds : [], comment: clean(v.comment),
});
const check = (b) => {
  if (!b.date) throw new Error('Укажите дату');
  if (!(b.amount > 0)) throw new Error('Сумма больше нуля');
  if (!b.companyId) throw new Error('Выберите компанию');
  if (!b.articleId) throw new Error('Выберите статью');
  if (!b.title) throw new Error('Впишите название');
  return b;
};
const articleName = (r) => (r.parentArticleName ? `${r.parentArticleName} → ${r.articleName}` : r.articleName);

export const expense = {
  id: 'expense',
  title: 'Прочий расход',
  newTitle: 'Новый расход',
  noun: 'расход',
  entityType: 'Expense',
  canEdit: () => session.canMoney,
  get: (id) => api(`/expenses/${id}`),
  card: {
    heading: (r) => r.title,
    subheading: (r) => [date(r.date), r.companyName].filter(Boolean).join(' · '),
    noHistory: true,
    view: (r) => [
      grp('Расход'),
      ['Сумма', money(r.amount)],
      ['Статья', articleName(r)],
      ['Компания', r.companyName],
      ['Объект', r.salesOrderNo ? 'Заказ № ' + r.salesOrderNo : ''],
      ['Контрагент', r.counterpartyName],
      ['№ документа', r.docNo],
      ['Комментарий', r.comment],
      ['Файл счёта', (r.files || []).length ? h('span', null, ...r.files.flatMap((f, i) => [i ? ', ' : '', link({ label: f.name || 'Файл', href: PREFIX + f.url, target: '_blank' })])) : ''],
    ],
    actions: () => [{ label: 'Добавить ещё расход', run: () => patch({ new: '1', open: undefined }) }],
  },
  form: {
    fields: async (r) => {
      const [tree, lk, orders] = await Promise.all([articleTree().catch(() => []), incomeLookups().catch(() => ({ companies: [] })), orderChoices('Без объекта')]);
      return [
        { section: 'Расход', tone: 'money', fixed: true },
        { key: 'date', label: 'Дата', type: 'date', required: true, span: 1 },
        { key: 'amount', label: 'Сумма, ₽', type: 'money', min: 0, required: true, span: 1 },
        { key: 'companyId', label: 'Компания', type: 'select', required: true, choose: true, options: (lk.companies || []).map((c) => ({ value: String(c.id), label: c.name })) },
        { key: 'articleId', label: 'Статья', type: 'select', required: true, choose: true, wide: true, options: articleOptions(tree, 'Выберите статью'), hint: 'Статья → подстатья. Начните печатать — список сузится' },
        { key: 'title', label: 'Название', required: true, max: 300, wide: true, placeholder: 'За что платим' },
        { section: 'Подробности', tone: 'info' },
        { key: 'salesOrderId', label: 'Объект', type: 'select', options: orders, wide: true, hint: 'Заказ заказчика. Не нужно, если расход общий' },
        { key: 'counterpartyName', label: 'Контрагент', max: 200 },
        { key: 'docNo', label: '№ документа', max: 100 },
        { key: 'fileIds', label: 'Файл счёта', type: 'widget', wide: true, hint: 'Перетащите файл сюда или выберите', widget: () => filesWidget(r?.files || []) },
        { key: 'comment', label: 'Комментарий', type: 'textarea', wide: true },
      ];
    },
    initial: () => ({ date: isoDay() }),
    toInitial: (r) => ({
      date: String(r.date || '').slice(0, 10), amount: r.amount ?? null, companyId: String(r.companyId || ''), articleId: String(r.articleId || ''), title: r.title || '',
      salesOrderId: r.salesOrderId ? String(r.salesOrderId) : '', counterpartyName: r.counterpartyName || '', docNo: r.docNo || '', comment: r.comment || '',
    }),
    toBody: (v) => check(bodyOf(v)),
    create: (body) => api('/expenses', { method: 'POST', body }),
    update: (id, body) => api(`/expenses/${id}`, { method: 'PATCH', body }),
  },
  remove: {
    text: (r) => `Удалить расход «${r.title}» на ${money(r.amount)}?`,
    run: (r) => api(`/expenses/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api('/expenses', { method: 'POST', body: { ...bodyOf({ ...r, fileIds: (r.files || []).map((f) => f.id), date: String(r.date || '').slice(0, 10) }) } }),
  },
};

const cell = (v) => v || '—';

/** Раздел меню «Деньги → Прочие расходы»: список, фильтры, «+ Расход». */
export const expenses = {
  ...expense,
  id: 'expenses',
  title: 'Прочие расходы',
  list: {
    path: '/expenses',
    sortDefault: '-date',
    export: false,
    createLabel: 'Расход',
    searchPlaceholder: 'Название, контрагент, № документа…',
    emptyText: 'Прочих расходов пока нет.',
    emptyHint: 'Нажмите «+ Расход»: впишите сумму и название, выберите статью, приложите файл счёта.',
    filters: [
      { key: 'from', label: 'С даты', short: 'с', type: 'date' },
      { key: 'to', label: 'До даты', short: 'до', type: 'date' },
      { key: 'companyId', label: 'Компания', allLabel: 'Все компании', type: 'select', options: async () => ((await incomeLookups().catch(() => ({ companies: [] }))).companies || []).map((c) => ({ value: String(c.id), label: c.name })) },
      { key: 'articleId', label: 'Статья', allLabel: 'Все статьи', type: 'select', options: async () => articleOptions(await articleTree().catch(() => []), '').slice(1) },
    ],
    columns: [
      { key: 'date', label: 'Дата', sort: 'date', cls: 'nowrap', render: (r) => date(r.date) },
      { key: 'title', label: 'Название', sort: 'title', cls: 'clip', render: (r) => h('b', { title: r.title }, r.title) },
      { key: 'articleName', label: 'Статья', cls: 'clip md-hide', render: (r) => cell(articleName(r)) },
      { key: 'companyName', label: 'Компания', cls: 'nowrap md-hide', render: (r) => cell(r.companyName) },
      { key: 'amount', money: true, label: 'Сумма', sort: 'amount', cls: 'num right', render: (r) => money(r.amount) },
      { key: 'files', label: 'Файл', cls: 'nowrap md-hide', render: (r) => ((r.files || []).length ? link({ label: 'Открыть', href: PREFIX + r.files[0].url, target: '_blank', onClick: (e) => e.stopPropagation() }) : '—') },
    ],
    card: {
      title: (r) => r.title,
      sub: (r) => [date(r.date), articleName(r), r.companyName].filter(Boolean).join(' · '),
      side: (r) => [money(r.amount)],
    },
    footer: (resp) => (session.canMoney ? (resp.sum != null ? `Итого по списку: ${money(resp.sum)} · ` : '') + `${resp.total ?? 0} ${plural(resp.total ?? 0, 'расход', 'расхода', 'расходов')}` : null),
  },
};

/**
 * Поле «Статья расхода» для формы заявки: подставляется по категории (categoryIds подстатьи), ручной выбор не затирается.
 * lk — справочники заявок (categories: [{id,name}]); linked — позиция склада (категория не в форме, берётся из заявки r).
 */
export const requestArticleField = (tree, lk, r, linked) => ({
  key: 'articleId', money: true, label: 'Статья расхода', type: 'select', options: articleOptions(tree, 'Не указана'), wide: true, hint: 'Подставляется по категории — можно сменить. Нужна для «Денег → По статьям»',
  mount: (fapi) => {
    const sync = () => {
      if (fapi.manual('articleId') || (fapi.get('articleId') && !fapi.input('articleId').classList.contains('is-default'))) return; // выбрано вручную или сохранено раньше
      const cat = lk.categories.find((c) => c.name === (linked ? r.categoryName : fapi.get('categoryName')));
      const id = cat ? articleByCategory(tree, cat.id) : '';
      if (id) fapi.set('articleId', id, { auto: true, src: 'по категории' });
    };
    fapi.on('categoryName', sync); sync();
  },
});
