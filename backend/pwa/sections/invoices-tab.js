import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { current } from '../core/router.js';
import { date, money } from '../core/format.js';
import { INVOICE_STATUS, badge, enhanceSelect, empty, table, link, failBlock } from '../ui/kit/index.js';
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
  let page = 1, seq = 0, timer = null;
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
  const rows = h('div', { class: 'invl-list' }), foot = h('div', { class: 'invl-foot' });
  const el = h('div', { class: 'invl-tab' }, h('p', { class: 'hint' }, 'Откройте счёт по его названию. Позиции и разрешённые действия — в правой панели.'),
    h('div', { class: 'invl-bar' }, q, statusSel, supSel, ctrSel, h('span', { class: 'invl-period' }, from, h('span', { class: 'muted' }, '—'), to)), rows, foot);
  function reload() { page = 1; return load(); }
  async function load() {
    const my = ++seq; rows.classList.add('is-busy');
    try {
      const result = await api('/supply/invoices', { query: { page, limit: LIMIT, ...Object.fromEntries(Object.entries(F).filter(([, value]) => value)) } });
      if (my !== seq) return;
      const items = result.items || [];
      if (!items.length) {
        rows.replaceChildren(empty({ title: Object.values(F).some(Boolean) ? 'По этим условиям счетов нет' : 'Счетов пока нет', hint: 'Измените фильтры или создайте счёт на вкладке «Заявки».' })); foot.replaceChildren(); return;
      }
      rows.replaceChildren(table({ label: 'Счета поставщиков',
        columns: [{ label: 'Счёт' }, { label: 'Дата' }, { label: 'Поставщик', cls: 'clip' }, ...(session.canMoney ? [{ label: 'Сумма счёта', num: true }] : []), { label: 'Статус' }, { label: 'Договор' }, { label: 'Позиций', num: true }],
        rows: items.map((invoice) => ({ data: invoice.id, cells: [link({ label: invoice.no ? `Счёт № ${invoice.no}` : 'Счёт без номера', href: invoiceHref(invoice.id) }), date(invoice.date) || '—', invoice.supplierName || '—', ...(session.canMoney ? [money(invoice.amount)] : []),
          h('span', null, badge(INVOICE_STATUS, invoice.status), invoice.partial ? badge('Часть строк скрыта', 'warn') : null), invoice.contractNo ? `№ ${invoice.contractNo}` : 'Без договора', invoice.requestsCount ?? 0] })) }));
      const pages = Math.max(1, Math.ceil((result.total || 0) / LIMIT));
      foot.replaceChildren(h('div', { class: 'invl-sum' }, `Счетов: ${result.total ?? items.length}`, session.canMoney ? [' · Итого: ', h('b', null, money(result.sum ?? 0))] : null),
        pages > 1 ? h('div', { class: 'invl-pager' },
          h('button', { class: 'btn', type: 'button', disabled: page <= 1, onclick: () => { page--; return load(); } }, '‹ Назад'), h('span', { class: 'muted' }, `${page} из ${pages}`),
          h('button', { class: 'btn', type: 'button', disabled: page >= pages, onclick: () => { page++; return load(); } }, 'Далее ›')) : null);
    } catch (e) { if (my === seq) { rows.replaceChildren(failBlock(e, load, { text: 'Счета не загрузились' })); foot.replaceChildren(); } }
    finally { if (my === seq) rows.classList.remove('is-busy'); }
  }
  load();
  return { el, reload: load, update: () => {}, focusSearch: () => q.focus(), destroy: () => { seq++; clearTimeout(timer); } };
}
