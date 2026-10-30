import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { patch } from '../core/router.js';
import { toastError } from '../ui/toast.js';
import { openMatching } from './salesorders-matching.js';

// УПР-1/Д9: re-export matching panel section (used as ?of=matching right panel)
export { matching } from './salesorders-matching.js';

/**
 * Очередь «Несопоставленные позиции» (над списком «Заказов»): все позиции договоров без связи с продукцией.
 * Сервер: GET /matching/unmatched | /matching/unmatched/count, POST /matching/confirm | none | bulk.
 * «Выбрать…» открывает правую панель сопоставления договора (ввод — только там).
 */
const canWrite = () => ['admin', 'manager'].includes(session.role) || session.user?.isOwner === true;
const changed = () => window.dispatchEvent(new CustomEvent('data-changed'));
const LIMIT = 50;

/** Количество несопоставленных позиций: {total, inProduction}. */
export const unmatchedCount = () => api('/matching/unmatched/count').catch(() => ({ total: 0, inProduction: 0 }));

/** Жёлтая плашка «N позиций не связаны с продукцией — Сопоставить» (заказ не блокируется). */
export function unmatchedPlate(n, orderId) {
  if (!n) return null;
  return h('div', { class: 'mt-plate', role: 'status' },
    h('span', null, `${qty(n)} ${n % 10 === 1 && n % 100 !== 11 ? 'позиция не связана' : 'позиций не связаны'} с продукцией. Заказ можно вести дальше.`),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openMatching(patch, orderId) }, 'Сопоставить'));
}

/** Метка «не сопоставлено» на карточке; клик открывает сопоставление договора. */
export function unmatchedFlag(orderId) {
  return h('a', { class: 'badge warn mt-flag', href: '#', title: 'Сопоставить позиции договора с изделиями', onclick: (e) => { e.preventDefault(); e.stopPropagation(); openMatching(patch, orderId); } }, 'не сопоставлено');
}

/** Договоры заказа с несопоставленными позициями: [{id, n}]. */
export function unmatchedOrders(r) {
  return (r.orders || []).map((o) => ({ id: o.id, n: (o.lines || []).filter((l) => l.matched === false).length })).filter((x) => x.n);
}

/** Блок над списком: кнопка «Несопоставленные · N» (скрыта при 0) и раскрывающаяся таблица. */
export function unmatchedTop() {
  const btn = h('button', { class: 'btn btn-ghost', type: 'button', hidden: true, 'aria-expanded': 'false' }, 'Несопоставленные');
  const box = h('div', { class: 'ua-box', hidden: true });
  const el = h('div', { class: 'ua-top' }, btn, box);
  let items = [], total = 0, q = '', onlyProd = false, loaded = false;
  const search = h('input', { type: 'search', placeholder: 'Поиск: № договора, заказчик, позиция…', 'aria-label': 'Поиск несопоставленных позиций' });
  const prod = h('input', { type: 'checkbox' });
  const bulkBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', hidden: true });
  const body = h('div', { class: 'mq-body' });
  const more = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', hidden: true }, 'Показать ещё');
  const write = canWrite();

  const setCount = async () => {
    const c = await unmatchedCount();
    btn.hidden = !c.total && box.hidden;
    btn.textContent = `Несопоставленные · ${qty(c.total || 0)}`;
    btn.classList.toggle('active', !box.hidden);
  };
  const run = async (fn) => { try { await fn(); changed(); } catch (e) { toastError(e, 'сохранить сопоставление'); } };
  const best = (it) => (it.suggestions || [])[0];
  const sure = () => items.filter((x) => x.confident && best(x));

  const rowEl = (it) => {
    const s = best(it);
    const acts = write ? h('div', { class: 'mq-acts' },
      s ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: (e) => { e.currentTarget.classList.add('is-busy'); run(() => api('/matching/confirm', { method: 'POST', body: { lineId: it.lineId, productId: s.productId } })); } }, 'Подтвердить') : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openMatching(patch, it.orderId) }, 'Выбрать…'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: (e) => { e.currentTarget.classList.add('is-busy'); run(() => api('/matching/none', { method: 'POST', body: { lineId: it.lineId } })); } }, 'Не изделие')) : null;
    return h('tr', null,
      h('td', null, h('b', null, it.orderNo || '—'), h('div', { class: 't-sub' }, it.customer || '')),
      h('td', null, it.productionNo ? h('span', { class: 'badge warn', title: 'Заказ уже в производстве' }, 'в производстве · ' + it.productionNo) : h('span', { class: 'muted' }, '—')),
      h('td', null, it.title),
      h('td', { class: 'num nowrap' }, `${qty(it.qty)} ${it.unit || ''}`.trim()),
      h('td', null, s ? h('span', null, h('b', null, s.name), s.sku ? h('span', { class: 'muted' }, ' · ' + s.sku) : null, h('div', { class: 't-sub' }, `${qty(s.percent)}%${it.confident ? ' · уверенно' : ''}`)) : h('span', { class: 'muted' }, 'нет вариантов')),
      h('td', { class: 'mq-act-cell' }, acts));
  };
  const paint = () => {
    const n = sure().length;
    bulkBtn.hidden = !write || !n;
    bulkBtn.textContent = `Подтвердить все уверенные (${n})`;
    body.replaceChildren(items.length
      ? h('table', { class: 'so-lines mq-table' }, h('thead', null, h('tr', null, h('th', null, 'Договор'), h('th', null, 'В производстве'), h('th', null, 'Позиция'), h('th', { class: 'num' }, 'Кол-во'), h('th', null, 'Лучший вариант'), h('th', null, ''))), h('tbody', null, ...items.map(rowEl)))
      : h('p', { class: 'muted' }, loaded ? 'Всё сопоставлено — несопоставленных позиций нет.' : 'Загрузка…'));
    more.hidden = items.length >= total;
  };
  const load = async (append) => {
    try {
      const page = append ? Math.floor(items.length / LIMIT) + 1 : 1;
      const d = await api('/matching/unmatched', { query: { page, limit: LIMIT, q: q || undefined, inProduction: onlyProd ? 1 : undefined } });
      items = append ? items.concat(d.items || []) : (d.items || []);
      total = d.total ?? items.length; loaded = true;
    } catch (e) { toastError(e, 'загрузить несопоставленные позиции'); }
    paint();
  };
  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value.trim(); load(false); }, 300); });
  prod.addEventListener('change', () => { onlyProd = prod.checked; load(false); });
  more.addEventListener('click', () => load(true));
  bulkBtn.addEventListener('click', (e) => { e.currentTarget.classList.add('is-busy'); const list = sure(); run(() => api('/matching/bulk', { method: 'POST', body: { items: list.map((x) => ({ lineId: x.lineId, productId: best(x).productId })) } })); });
  box.append(h('div', { class: 'mq-bar' }, bulkBtn, h('label', { class: 'field' }, search), h('label', { class: 'check' }, prod, ' Только в производстве')), body, more);
  btn.addEventListener('click', () => {
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
    btn.classList.toggle('active', !box.hidden);
    if (!box.hidden) load(false);
  });
  window.addEventListener('data-changed', () => { if (!el.isConnected) return; setCount(); if (!box.hidden) load(false); });
  setCount();
  return el;
}

/**
 * УПР-1/Д9: Самостоятельный экран «Сопоставление» (#matching) с двумя вкладками:
 * «Позиции» — очередь несопоставленных позиций заказов; «Без договора» — договоры без заказа.
 */
export function mountMatchingQueue(params) {
  const tab = params?.tab || 'positions';
  const tabs = h('div', { class: 'tabs' },
    h('a', { class: 'tab' + (tab !== 'unassigned' ? ' active' : ''), href: '#matching' }, 'Позиции'),
    h('a', { class: 'tab' + (tab === 'unassigned' ? ' active' : ''), href: '#matching?tab=unassigned' }, 'Без договора'));
  const body = h('div', { class: 'mq-screen-body' });
  const el = h('div', { class: 'panel matching-screen' },
    h('div', { class: 'page-head' }, h('h1', null, 'Сопоставление')),
    tabs, body);
  if (tab === 'unassigned') {
    import('./salesorders-unassigned.js').then(({ unassignedPicker, chooseTarget }) => {
      const bar = h('div', { class: 'ua-bar', hidden: true });
      const picker = unassignedPicker({
        onChange: (ids) => {
          bar.hidden = !ids.length;
          bar.replaceChildren(
            h('b', null, `Выбрано ${ids.length}`),
            h('button', { class: 'btn btn-primary btn-sm', type: 'button',
              onclick: async () => { if (await chooseTarget(ids)) { picker.reload(); bar.hidden = true; } } }, 'В заказ…'));
        },
      });
      body.replaceChildren(bar, picker.el);
    }).catch((e) => { body.replaceChildren(h('p', { class: 'neg' }, 'Не загрузилось: ' + (e?.message || e))); });
  } else {
    body.replaceChildren(unmatchedTop());
  }
  return { el, update: (p) => { if ((p?.tab || 'positions') !== tab) { body.replaceChildren(); } } };
}
