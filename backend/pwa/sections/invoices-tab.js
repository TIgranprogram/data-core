import { sourceMoney, foreignInvoice, paymentStateLabel, needsPaymentDate } from './invoice-workspace-state.js';
import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { current, patch } from '../core/router.js';
import { date, money } from '../core/format.js';
import { INVOICE_STATUS, badge, enhanceSelect, empty, table, link, autoMore, button, field, searchBox } from '../ui/kit/index.js';
import { filterPanel } from '../ui/kit/filter-panel.js';
import { lookups } from './lookups.js';
import { articleTree, articleFilterOptions } from './expenses.js';

/** Вкладка — только список/фильтры. Все операции и позиции находятся в routable invoicecard. */
const LIMIT = 30;
const STATUS_OPTS = [['', 'Все статусы'], ['draft', 'Черновик'], ['issued', 'Выставлен'], ['paid', 'Оплачен']]; // «Отменён» не показываем: такие счета (после объединения) уходят в корзину, фильтр всегда пуст
const invoiceHref = (id) => {
  const route = current();
  const params = { ...route.params, tab: 'invoices', of: 'invoicecard', open: id, new: undefined, fill: undefined };
  return '#' + (route.section || 'requests') + '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
};
export function mountInvoicesTab(params = {}) {
  const F = { status: '', supplierId: '', q: '', from: '', to: '', contract: '', articleId: params.articleId || '', needsPaymentDate: params.needsPaymentDate === '1' ? '1' : '' };
  const sel = (opts, key, title) => {
    const select = h('select', { class: 'invl-f', 'aria-label': title, onchange: () => { F[key] = select.value; if (key === 'articleId') patch({ articleId: F.articleId || undefined, page: undefined }); if (key === 'needsPaymentDate') patch({ needsPaymentDate: F.needsPaymentDate || undefined, page: undefined }); reload(); } }, ...opts.map(([value, label]) => h('option', { value }, label)));
    return enhanceSelect(select);
  };
  const dateSel = sel([['', 'Дата оплаты: все'], ['1', 'Нужно заполнить дату оплаты']], 'needsPaymentDate', 'Дата оплаты');
  dateSel.value = F.needsPaymentDate; enhanceSelect(dateSel);
  const statusSel = sel(STATUS_OPTS, 'status', 'Статус');
  const supSel = sel([['', 'Все поставщики']], 'supplierId', 'Поставщик');
  lookups().then((lk) => {
    supSel.append(...(lk.suppliers || []).map((supplier) => {
      const value = typeof supplier === 'string' ? supplier : String(supplier.value ?? supplier.id);
      const label = typeof supplier === 'string' ? supplier : supplier.label ?? supplier.name;
      return h('option', { value }, label);
    })); enhanceSelect(supSel);
  }).catch(() => {});
  const articleSel = sel([['', 'Все статьи'], ['none', 'Без статьи']], 'articleId', 'Статья расходов');
  const fillArticles = () => articleTree(true).then(tree => { articleSel.replaceChildren(h('option', { value: '' }, 'Все статьи'), ...articleFilterOptions(tree).map(({ value, label }) => h('option', { value }, label))); articleSel.value = F.articleId; enhanceSelect(articleSel); }).catch(() => { articleSel.title = 'Статьи не загрузились; нажмите фильтр, чтобы повторить'; });
  articleSel.value = F.articleId; articleSel.addEventListener('focus', fillArticles); fillArticles();
  const ctrSel = sel([['', 'Договор поставщика: все'], ['has', 'Договор есть'], ['none', 'Без договора']], 'contract', 'Договор поставщика');
  const q = searchBox({ placeholder: 'Поиск: № счёта, поставщик…', onSearch: (value) => { F.q = value; reload(); } });
  const from = h('input', { type: 'date', class: 'invl-f', 'aria-label': 'С даты', onchange: () => { F.from = from.value; reload(); } });
  const to = h('input', { type: 'date', class: 'invl-f', 'aria-label': 'По дату', onchange: () => { F.to = to.value; reload(); } });
  const rows = h('div', { class: 'invl-list' });
  const F_ = () => Object.fromEntries(Object.entries(F).filter(([, value]) => value));
  // ПГ-1c: порции при прокрутке вниз — kit.autoMore; «Итого» — из ответа сервера
  const more = autoMore({
    root: rows, cls: 'invl-foot', limit: LIMIT, text: { fail: 'Счета не загрузились', moreFail: 'Не удалось подгрузить счета' },
    load: (p, { limit }) => api('/supply/invoices', { query: { page: p, limit, ...F_() } }),
    summary: (shown, total, r) => h('div', { class: 'invl-sum' }, `Показано ${shown} из ${total}`, session.canMoney ? [F.articleId ? ' · Сумма целых отобранных счетов: ' : ' · Итого: ', h('b', null, money(r?.sum ?? 0))] : null),
    render: (items) => {
      if (!items.length) {
        rows.replaceChildren(empty({ title: Object.values(F).some(Boolean) ? 'По этим условиям счетов нет' : 'Счетов пока нет', hint: 'Измените фильтры или создайте счёт на вкладке «Заявки».' })); return;
      }
      rows.replaceChildren(table({ label: 'Счета поставщиков',
        columns: [{ label: 'Счёт' }, { label: 'Дата' }, { label: 'Поставщик', cls: 'clip' }, ...(session.canMoney ? [{ label: 'Сумма счёта', num: true }, { label: 'Оплачено, ₽', num: true }, { label: 'Остаток', num: true }] : []), { label: 'Статус' }, { label: 'Договор' }, { label: 'Позиций', num: true }],
        rows: items.map((invoice) => ({ data: invoice.id, cells: [link({ label: invoice.no ? `Счёт № ${invoice.no}` : 'Счёт без номера', href: invoiceHref(invoice.id) }), date(invoice.date) || '—', invoice.supplierName || '—', ...(session.canMoney ? [invoice.accountingState === 'unresolved' ? sourceMoney(invoice.sourceAmount, invoice) + ' · Нужен пересчёт' : money(invoice.amount), needsPaymentDate(invoice) ? 'Подтверждено без даты' : invoice.paidAmount == null ? 'Не указано' : money(invoice.paidAmount), needsPaymentDate(invoice) ? 'Дата не заполнена' : invoice.reconciliationRequired ? 'Требует сверки' : foreignInvoice(invoice) ? sourceMoney(invoice.sourceBalance, invoice) : invoice.balanceDue == null ? 'Не указано' : money(invoice.balanceDue)] : []),
          h('span', null, needsPaymentDate(invoice) ? badge(paymentStateLabel(invoice), 'warn') : invoice.reconciliationRequired || invoice.paymentState === 'reconciliation' ? h('span', { title: invoice.reconciliationReason || '' }, paymentStateLabel(invoice)) : invoice.paymentState === 'partial' ? 'Частично оплачен' : badge(INVOICE_STATUS, invoice.status), invoice.partial ? badge('Часть строк скрыта', 'warn') : null), invoice.contractNo ? `№ ${invoice.contractNo}` : 'Без договора', invoice.requestsCount ?? 0] })) }));
    },
  });
  const load = (opt) => more.reload(opt);
  const reset = button({ label: 'Сбросить всё', kind: 'ghost', cls: 'ls-reset', onClick: () => {
    for (const key of Object.keys(F)) F[key] = '';
    for (const control of [statusSel, supSel, articleSel, ctrSel, dateSel, from, to]) {
      control.value = '';
      if (control.tagName === 'SELECT') enhanceSelect(control);
    }
    q.set('', true);
    patch({ articleId: undefined, needsPaymentDate: undefined, page: undefined });
    reload();
  } });
  const filters = filterPanel({
    key: 'requests-invoices',
    search: q.el,
    reset,
    fields: [field('Статус', statusSel), field('Поставщик', supSel), field('Статья расходов', articleSel),
      field('Договор поставщика', ctrSel), field('Дата оплаты', dateSel), field('С даты', from), field('По дату', to)],
    content: [rows, more.el],
  });
  const el = h('div', { class: 'invl-tab' }, filters.el);
  function reload() {
    const count = Object.entries(F).filter(([key, value]) => key !== 'q' && value).length;
    filters.setCount(count);
    reset.hidden = !count && !F.q;
    reset.classList.toggle('is-on', !reset.hidden);
    return load();
  }
  reload();
  return { el, reload: () => load({ keep: true }), update: (next = {}) => { const pending = next.needsPaymentDate === '1' ? '1' : ''; if (F.needsPaymentDate !== pending) { F.needsPaymentDate = pending; dateSel.value = pending; enhanceSelect(dateSel); reload(); } const articleId = next.articleId || ''; if (F.articleId !== articleId) { F.articleId = articleId; articleSel.value = articleId; enhanceSelect(articleSel); reload(); } }, focusSearch: q.focus, destroy: () => more.destroy() };
}
