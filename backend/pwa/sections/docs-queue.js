import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date } from '../core/format.js';
import { go } from '../core/router.js';
import { failBlock } from '../ui/busy.js';
import { emptyState } from '../ui/empty.js';
import { toastError } from '../ui/toast.js';
import { issuePassport } from './passports.js';
import { canEdit as canEditTexts } from './passports/common.js';

/**
 * Вкладка «Нужно сделать паспорт» (ТЗ ОП): позиции заказов, где проектирование готово, а выпущенного паспорта нет.
 * Данные — GET /passports/queue (по сроку отгрузки; «горит» — до отгрузки ≤ 3 дней или просрочено).
 */
const STATE = { none: ['нет паспорта', 'dim'], draft: ['черновик', 'info'], rework: ['доработать', 'warn'] };
const DUE = [['all', 'Все'], ['overdue', 'Просрочено'], ['soon', 'Горит']];

export function mountQueueTab(params) {
  let due = 'all', search = '', data = null, t = null, gone = false;
  const summary = h('div', { class: 'q-summary' });
  const chips = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Срок' });
  const q = h('input', { type: 'search', placeholder: 'Поиск: заказ, заказчик, изделие…', 'aria-label': 'Поиск', oninput: (e) => { search = e.target.value.trim(); clearTimeout(t); t = setTimeout(load, 300); } });
  const list = h('div', { class: 'dq-list' });
  const el = h('div', { class: 'dq' }, h('div', { class: 'page-head' }, h('div', { class: 'field' }, q), chips), summary, list);
  const drawChips = () => chips.replaceChildren(...DUE.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(due === k), class: due === k ? 'active' : '', onclick: () => { due = k; drawChips(); load(); } }, label)));

  const make = async (r, btn) => {
    if (r.passportId) { go('docs', { tab: 'archive', of: 'passports', open: r.passportId }); return; }
    btn.classList.add('is-busy'); btn.disabled = true;
    try { await issuePassport({ productId: r.productId, name: r.productName, salesOrderId: r.orderId, orderNo: r.orderNo, customerName: r.customer, incomeId: r.incomeId }); }
    catch (e) { toastError(e, 'выпустить паспорт'); } finally { btn.classList.remove('is-busy'); btn.disabled = false; }
  };
  const row = (r) => {
    const [stLabel, stTone] = STATE[r.passportState] || STATE.none;
    const btn = h('button', { type: 'button', class: 'btn btn-sm btn-primary' }, r.passportId ? 'Открыть' : 'Выпустить');
    btn.addEventListener('click', () => make(r, btn));
    return h('tr', { class: r.hot ? 'dq-hot' : '' },
      h('td', { class: 'nowrap' }, r.shipDate ? h('span', { class: r.hot ? 'neg' : '' }, date(r.shipDate)) : h('span', { class: 'muted' }, 'без срока'), r.hot ? h('span', { class: 'badge danger', title: 'До отгрузки не больше 3 дней или срок прошёл' }, 'горит') : null),
      h('td', { class: 'nowrap' }, h('b', null, '№ ' + (r.orderNo || '—') + (r.lineNo ? '-' + r.lineNo : '')), h('div', { class: 'muted' }, r.customer || '')),
      h('td', null, r.productName || r.title, r.productName && r.title && r.title !== r.productName ? h('div', { class: 'muted' }, r.title) : null),
      h('td', null, h('span', { class: 'badge ' + stTone }, stLabel)),
      h('td', { class: 'right' }, canEditTexts() && session.canEdit ? btn : null));
  };
  function paint() {
    const c = data?.counts || {};
    summary.replaceChildren(
      h('span', { class: 'badge danger' }, `горит: ${c.hot || 0}`), h('span', { class: 'badge dim' }, `нет паспорта: ${c.none || 0}`),
      h('span', { class: 'badge info' }, `черновик: ${c.draft || 0}`), h('span', { class: 'badge warn' }, `доработать: ${c.rework || 0}`));
    const items = data?.items || [];
    list.replaceChildren(items.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'so-lines' }, h('thead', null, h('tr', null, h('th', null, 'Срок отгрузки'), h('th', null, 'Заказ'), h('th', null, 'Изделие'), h('th', null, 'Состояние'), h('th', null, ''))), h('tbody', null, ...items.map(row))))
      : emptyState({ title: search || due !== 'all' ? 'Ничего не найдено' : 'Все паспорта сделаны', hint: search || due !== 'all' ? 'Смените срок или очистите поиск.' : 'Позиции появятся здесь, когда проектирование закончено, а паспорта нет.' }));
  }
  async function load() {
    try { data = await api('/passports/queue', { query: { due, search, limit: 200 } }); if (!gone) paint(); }
    catch (e) { if (!gone) list.replaceChildren(failBlock(e)); }
  }
  const onChanged = () => load();
  window.addEventListener('data-changed', onChanged);
  drawChips(); load();
  void params;
  return { el, reload: load, update: () => {}, focusSearch: () => q.focus(), destroy: () => { gone = true; clearTimeout(t); window.removeEventListener('data-changed', onChanged); } };
}
