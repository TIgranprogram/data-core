import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { current } from '../core/router.js';
import { date, money } from '../core/format.js';
import { INVOICE_STATUS, badge, enhanceSelect, empty, table, link, autoMore } from '../ui/kit/index.js';
import { lookups } from './lookups.js';

/** Вкладка — только список/фильтры. Все операции и позиции находятся в routable invoicecard. */
const LIMIT = 30;
const STATUS_OPTS = [['', 'Все статусы'], ['draft', 'Черновик'], ['issued', 'Выставлен'], ['paid', 'Оплачен'], ['cancelled', 'Отменён']];
const invoiceHref = (id) => {
  const route = current();
  const params = { ...route.params, tab: 'invoices', of: 'invoicecard', open: id, new: undefined, fill: undefined };
  return '#' + (route.section || 'requests') + '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
};
export function mountInvoicesTab() {
  const F = { status: '', supplierId: '', q: '', from: '', to: '', contract: '' };
  let timer = null;
  const sel = (opts, key, title) => {
    const select = h('select', { class: 'invl-f', 'aria-label': title, onchange: () => { F[key] = select.value; reload(); } }, ...opts.map(([value, label]) => h('option', { value }, label)));
    return select;
  };
  const statusSel = sel(STATUS_OPTS, 'status', 'Статус');
  const supSel = sel([['', 'Все поставщики']], 'supplierId', 'Поставщик');
  lookups().then((lk) => {
    supSel.append(...(lk.suppliers || []).map((supplier) => {
      const value = typeof supplier === 'string' ? supplier : String(supplier.value ?? supplier.id);
      const label = typeof supplier === 'string' ? supplier : supplier.label ?? supplier.name;
      return h('option', { value }, label);
    })); enhanceSelect(supSel);
  }).catch(() => {});
  const ctrSel = sel([['', 'Договор поставщика: все'], ['has', 'Договор есть'], ['none', 'Без договора']], 'contract', 'Договор поставщика');
  const q = h('input', { type: 'search', class: 'invl-f', placeholder: 'Поиск: № счёта, поставщик…', oninput: () => { clearTimeout(timer); timer = setTimeout(() => { F.q = q.value.trim(); reload(); }, 300); } });
  const from = h('input', { type: 'date', class: 'invl-f', 'aria-label': 'С даты', onchange: () => { F.from = from.value; reload(); } });
  const to = h('input', { type: 'date', class: 'invl-f', 'aria-label': 'По дату', onchange: () => { F.to = to.value; reload(); } });
  const rows = h('div', { class: 'invl-list' });
  const F_ = () => Object.fromEntries(Object.entries(F).filter(([, value]) => value));
  // ПГ-1c: порции при прокрутке вниз — kit.autoMore; «Итого» — из ответа сервера
  const more = autoMore({
    root: rows, cls: 'invl-foot', limit: LIMIT, text: { fail: 'Счета не загрузились', moreFail: 'Не удалось подгрузить счета' },
    load: (p, { limit }) => api('/supply/invoices', { query: { page: p, limit, ...F_() } }),
    summary: (shown, total, r) => h('div', { class: 'invl-sum' }, `Показано ${shown} из ${total}`, session.canMoney ? [' · Итого: ', h('b', null, money(r?.sum ?? 0))] : null),
    render: (items) => {
      if (!items.length) {
        rows.replaceChildren(empty({ title: Object.values(F).some(Boolean) ? 'По этим условиям счетов нет' : 'Счетов пока нет', hint: 'Измените фильтры или создайте счёт на вкладке «Заявки».' })); return;
      }
      rows.replaceChildren(table({ label: 'Счета поставщиков',
        columns: [{ label: 'Счёт' }, { label: 'Дата' }, { label: 'Поставщик', cls: 'clip' }, ...(session.canMoney ? [{ label: 'Сумма счёта', num: true }] : []), { label: 'Статус' }, { label: 'Договор' }, { label: 'Позиций', num: true }],
        rows: items.map((invoice) => ({ data: invoice.id, cells: [link({ label: invoice.no ? `Счёт № ${invoice.no}` : 'Счёт без номера', href: invoiceHref(invoice.id) }), date(invoice.date) || '—', invoice.supplierName || '—', ...(session.canMoney ? [money(invoice.amount)] : []),
          h('span', null, badge(INVOICE_STATUS, invoice.status), invoice.partial ? badge('Часть строк скрыта', 'warn') : null), invoice.contractNo ? `№ ${invoice.contractNo}` : 'Без договора', invoice.requestsCount ?? 0] })) }));
    },
  });
  const load = (opt) => more.reload(opt);
  const el = h('div', { class: 'invl-tab' }, h('p', { class: 'hint' }, 'Откройте счёт по его названию. Позиции и разрешённые действия — в правой панели.'),
    h('div', { class: 'invl-bar' }, q, statusSel, supSel, ctrSel, h('span', { class: 'invl-period' }, from, h('span', { class: 'muted' }, '—'), to)), rows, more.el);
  function reload() { return load(); }
  load();
  return { el, reload: () => load({ keep: true }), update: () => {}, focusSearch: () => q.focus(), destroy: () => { clearTimeout(timer); more.destroy(); } };
}
