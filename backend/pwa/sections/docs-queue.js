import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date } from '../core/format.js';
import { go } from '../core/router.js';
import { failBlock } from '../ui/kit/busy.js';
import { emptyState } from '../ui/kit/empty.js';
import { toastError } from '../ui/kit/toast.js';
import { issuePassport } from './passports.js';
import { canEdit as canEditTexts } from './passports/common.js';

import { table, tabs, button, badge } from '../ui/kit/index.js';
/**
 * Вкладка «Нужно сделать паспорт» (ТЗ ОП): позиции заказов, где проектирование готово, а выпущенного паспорта нет.
 * Данные — GET /passports/queue (по сроку отгрузки; «горит» — до отгрузки ≤ 3 дней или просрочено).
 */
const STATE = { none: ['нет паспорта', 'dim'], draft: ['черновик', 'info'], rework: ['доработать', 'warn'] };
const DUE = [['all', 'Все'], ['overdue', 'Просрочено'], ['soon', 'Горит']];

export function mountQueueTab(params) {
  let due = 'all', search = '', data = null, t = null, gone = false;
  const summary = h('div', { class: 'q-summary' });
  const chips = tabs({ items: DUE.map(([key, label]) => ({ key, label })), value: 'all', label: 'Срок', onChange: (k) => { due = k; load(); } });
  const q = h('input', { type: 'search', placeholder: 'Поиск: заказ, заказчик, изделие…', 'aria-label': 'Поиск', oninput: (e) => { search = e.target.value.trim(); clearTimeout(t); t = setTimeout(load, 300); } });
  const list = h('div', { class: 'dq-list' });
  const el = h('div', { class: 'dq' }, h('div', { class: 'page-head' }, h('div', { class: 'field' }, q), chips.el), summary, list);

  const make = async (r, btn) => {
    if (r.passportId) {
      const of = r.passportState === 'draft' ? 'passports' : 'passarchive';
      go('docs', { tab: 'archive', of, open: r.passportId });
      return;
    }
    btn.classList.add('is-busy'); btn.disabled = true;
    try { await issuePassport({ productId: r.productId, name: r.productName, salesOrderId: r.orderId, orderNo: r.orderNo, customerName: r.customer, customerTitle: r.title, incomeId: r.incomeId }); }
    catch (e) { toastError(e, 'выпустить паспорт'); } finally { btn.classList.remove('is-busy'); btn.disabled = false; }
  };
  const row = (r) => {
    const [stLabel, stTone] = STATE[r.passportState] || STATE.none;
    const wait = !r.passportId && r.work && r.work.status !== 'done'; // позиция в работе, ещё не изготовлена
    const btn = wait ? h('span', { class: 'muted shp-why' }, 'Паспорт — после изготовления') : button({ label: r.passportId ? 'Открыть' : 'Выпустить', kind: 'primary', size: 'S' });
    if (!wait) btn.addEventListener('click', () => make(r, btn));
    return h('tr', { class: r.hot ? 'tone-danger k-toned' : '' },
      h('td', { class: 'nowrap' }, r.shipDate ? h('span', { class: r.hot ? 'neg' : '' }, date(r.shipDate)) : h('span', { class: 'muted' }, 'без срока'), r.hot ? h('span', { title: 'До отгрузки не больше 3 дней или срок прошёл' }, badge('горит', 'danger')) : null),
      h('td', { class: 'nowrap' }, h('b', null, '№ ' + (r.productionNo || r.orderNo || '—') + ((r.seqNo ?? r.lineNo) ? '-' + (r.seqNo ?? r.lineNo) : '')), h('div', { class: 'muted' }, r.customer || '')),
      h('td', null, r.productName || r.title, r.productName && r.title && r.title !== r.productName ? h('div', { class: 'muted' }, r.title) : null),
      h('td', null, badge(stLabel, stTone)),
      h('td', { class: 'right' }, canEditTexts() && session.canEdit ? btn : null));
  };
  function paint() {
    const c = data?.counts || {};
    summary.replaceChildren(
      badge(`горит: ${c.hot || 0}`, 'danger'), badge(`нет паспорта: ${c.none || 0}`, 'dim'),
      badge(`черновик: ${c.draft || 0}`, 'info'), badge(`доработать: ${c.rework || 0}`, 'warn'));
    const items = data?.items || [];
    list.replaceChildren(items.length
      ? table({ columns: [{ label: 'Срок отгрузки' }, { label: 'Заказ' }, { label: 'Изделие' }, { label: 'Состояние' }, { label: '' }], rows: items.map(row) })
      : emptyState({ title: search || due !== 'all' ? 'Ничего не найдено' : 'Все паспорта сделаны', hint: search || due !== 'all' ? 'Смените срок или очистите поиск.' : 'Позиции появятся здесь, когда проектирование закончено, а паспорта нет.' }));
  }
  async function load() {
    try { data = await api('/passports/queue', { query: { due, search, limit: 200 } }); if (!gone) paint(); }
    catch (e) { if (!gone) list.replaceChildren(failBlock(e)); }
  }
  const onChanged = () => load();
  window.addEventListener('data-changed', onChanged);
  load();
  void params;
  return { el, reload: load, update: () => {}, focusSearch: () => q.focus(), destroy: () => { gone = true; clearTimeout(t); window.removeEventListener('data-changed', onChanged); } };
}
