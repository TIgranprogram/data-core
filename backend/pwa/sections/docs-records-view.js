import { api, apiBlob, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date } from '../core/format.js';
import { canFollow } from '../core/route-access.js';
import { patch } from '../core/router.js';
import { autoMore, badge, button, card, clamp, hint, link, openPdfPreview, searchBox, tabs, tileGrid, toolbar } from '../ui/kit/index.js';
import { positionsTable } from '../ui/kit/screens/blocks.js';
import { toastError } from '../ui/kit/toast.js';
import { showOriginal } from './sales-legal.js';

const STATES = [['', 'Все'], ['live', 'Рабочие договоры'], ['archived', 'Архив договоров']];
const orderHref = (orderId) => '#salesorders?of=salesorder&open=' + encodeURIComponent(orderId);
const actTitle = (act) => [act.name || 'Акт / УПД', act.number && '№ ' + act.number].filter(Boolean).join(' ');

function openAct(act) {
  if (act.archiveVersion) {
    const url = '/salesorders/' + encodeURIComponent(act.orderId) + '/archive/' + encodeURIComponent(act.archiveVersion)
      + '/files/' + encodeURIComponent(act.fileId);
    const title = actTitle(act);
    return openPdfPreview({ title, load: () => apiBlob(url, { fallback: title + '.pdf' }) });
  }
  return showOriginal({ kind: 'acceptance', number: act.number, fileId: act.fileId });
}

function actDetails(act) {
  const href = orderHref(act.orderId);
  const canOrder = canFollow(session, href);
  const canFile = canOrder && session.canMoney && act.fileId;
  return tileGrid(
    card({
      title: 'Оригинал', variant: 'fields',
      body: !canFile ? hint('PDF недоступен') : null,
      actions: canFile ? [button({ label: 'Открыть PDF', size: 'S', onClick: () => openAct(act).catch(toastError) })] : [],
    }),
    canOrder ? card({
      title: 'Договор', variant: 'fields',
      actions: [link({ label: act.orderNo ? 'Открыть договор № ' + act.orderNo : 'Открыть договор', href })],
    }) : null,
  );
}

const filtersOf = (params) => ({
  search: params.search || '',
  order: params.order || '',
  state: ['live', 'archived'].includes(params.state) ? params.state : '',
});

export function mountActsTab(params) {
  let filters = filtersOf(params);
  let active = true;
  const setFilter = (field, value) => { if (active) patch({ [field]: value }); };
  const list = h('div');
  const search = searchBox({
    className: 'search', value: filters.search, label: 'Поиск актов', placeholder: '№ акта, договор, заказчик…', onSearch: (value) => setFilter('search', value),
  });
  const order = searchBox({
    className: 'search', value: filters.order, label: 'Номер заказа или договора', placeholder: '№ заказа или договора', onSearch: (value) => setFilter('order', value),
  });
  search.input.maxLength = 200;
  order.input.maxLength = 100;
  const states = tabs({
    label: 'Состояние договора', items: STATES.map(([key, label]) => ({ key, label })), value: filters.state,
    onChange: (value) => setFilter('state', value),
  });
  const more = autoMore({
    root: list,
    cls: 'list-foot',
    limit: 25,
    skeleton: true,
    text: { fail: 'Акты не загрузились' },
    load: (page, { limit }) => api('/documents/acts', { query: { page, limit, ...filters } }),
    render: (items) => list.replaceChildren(positionsTable({
      label: 'Акты',
      columns: [{ label: 'Документ', wrap: true }, { label: 'Дата', nowrap: true }, { label: 'Заказ / договор', nowrap: true },
        { label: 'Заказчик', wrap: true }, { label: 'Состояние', nowrap: true }],
      groups: [{ rows: items.map((act) => ({
        cells: [
          clamp(actTitle(act)),
          act.date ? date(act.date) : '—',
          [...new Set([act.productionNo, act.orderNo].filter(Boolean))].join(' / ') || '—',
          clamp(act.customer || '—'),
          act.archiveVersion ? badge('В архиве', 'dim') : badge('Рабочий договор', 'ok'),
        ],
        expand: () => actDetails(act),
      })) }],
      empty: { title: 'Актов не найдено' },
    })),
  });
  const el = h('div', { class: 'panel' }, toolbar(search.el, order.el), states.el, list, more.el);
  more.reload();

  return {
    el, focusSearch: search.focus,
    destroy() { active = false; more.destroy(); },
    reload: () => more.reload({ keep: true }),
    update(next) {
      const fresh = filtersOf(next);
      if (Object.keys(fresh).every(key => fresh[key] === filters[key])) return;
      filters = fresh;
      search.set(fresh.search);
      order.set(fresh.order);
      states.set(fresh.state);
      more.reload();
    },
  };
}

