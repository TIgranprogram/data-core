import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { enhanceSelect } from '../ui/select.js';
import { toastError } from '../ui/toast.js';
import { STAGE } from './order-stage.js';
import { openMatching } from './salesorders-matching.js';
import { posPic } from '../ui/pos-pic.js';

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

/** Блок над списком: кнопка «Несопоставленные · N» (скрыта при 0) и раскрывающаяся таблица; open — сразу таблица, без кнопки (экран «Сопоставление»). */
export function unmatchedTop({ open = false } = {}) {
  const btn = h('button', { class: 'btn btn-ghost', type: 'button', hidden: true, 'aria-expanded': 'false' }, 'Несопоставленные');
  const box = h('div', { class: 'ua-box', hidden: !open });
  const el = h('div', { class: 'ua-top' }, open ? null : btn, box);
  let items = [], total = 0, q = '', onlyProd = false, loaded = false;
  const filter = { productionNo: '', orderNo: '', stage: '' };
  const search = h('input', { type: 'search', placeholder: 'Поиск: № заказа, № договора, заказчик, позиция…', 'aria-label': 'Поиск несопоставленных позиций' });
  const select = (key, label) => { const s = h('select', { class: 'mq-f', 'aria-label': label, onchange: () => { filter[key] = s.value; load(false); } }, h('option', { value: '' }, label + ': все')); return s; };
  const orderSel = select('productionNo', 'Заказ'), contractSel = select('orderNo', 'Договор'), stageSel = select('stage', 'Этап заказа');
  const fill = (s, key, label, list, name) => {
    const cur = filter[key];
    // поиск убрал выбранное значение из вариантов — оставляем пункт, иначе фильтр работает невидимо и его не сбросить
    const all = list || [];
    const opts = cur && !all.some((o) => o.value === cur) ? [{ value: cur, n: 0 }, ...all] : all;
    s.replaceChildren(h('option', { value: '' }, label + ': все'), ...opts.map((o) => h('option', { value: o.value }, `${name(o.value)} · ${qty(o.n)}`)));
    s.value = cur;
    enhanceSelect(s);
  };
  const prod = h('input', { type: 'checkbox' });
  const bulkBtn = h('button', { class: 'btn btn-primary mq-bulk', type: 'button', hidden: true });
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
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openMatching(patch, it.orderId, it.lineId) }, 'Выбрать…'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: (e) => { e.currentTarget.classList.add('is-busy'); run(() => api('/matching/none', { method: 'POST', body: { lineId: it.lineId } })); } }, 'Не изделие')) : null;
    return h('tr', null,
      h('td', { class: 'nowrap' }, it.productionNo ? h('b', null, it.productionNo) : h('span', { class: 'muted' }, 'нет №'), h('div', { class: 't-sub' }, STAGE[it.stage]?.label || '')),
      h('td', null, h('b', null, it.orderNo || '—'), h('div', { class: 't-sub' }, it.customer || '')),
      h('td', null, h('div', { class: 'mq-item' }, posPic(it.photo), h('div', { class: 'mq-item-main' }, it.title))),
      h('td', { class: 'num nowrap' }, `${qty(it.qty)} ${it.unit || ''}`.trim()),
      h('td', null, s ? h('div', { class: 'mq-item' }, posPic(s.photo), h('div', { class: 'mq-item-main' }, h('b', null, s.name), s.sku ? h('span', { class: 'muted' }, ' · ' + s.sku) : null, h('div', { class: 't-sub' }, `совпадение ${qty(s.percent)}%${it.confident ? ' · уверенно' : ''}`))) : h('span', { class: 'muted' }, write ? 'Похожих изделий нет. Нажмите «Выбрать…»' : 'Похожих изделий нет')),
      h('td', { class: 'mq-act-cell' }, acts));
  };
  const paint = () => {
    const n = sure().length;
    bulkBtn.hidden = !write || !n;
    bulkBtn.textContent = `Подтвердить все уверенные (${n})`;
    body.replaceChildren(items.length
      ? h('table', { class: 'so-lines static mq-table' }, h('thead', null, h('tr', null, h('th', null, 'Заказ'), h('th', null, 'Договор'), h('th', null, 'Что в договоре'), h('th', { class: 'num' }, 'Кол-во'), h('th', null, 'Похожее изделие'), h('th', null, ''))), h('tbody', null, ...items.map(rowEl)))
      : h('p', { class: 'muted' }, !loaded ? 'Загрузка…' : q || filter.productionNo || filter.orderNo || filter.stage || onlyProd ? 'По этим условиям позиций нет. Сбросьте фильтр или поиск.' : 'Всё сопоставлено — несопоставленных позиций нет.'));
    more.hidden = items.length >= total;
  };
  const load = async (append) => {
    try {
      const page = append ? Math.floor(items.length / LIMIT) + 1 : 1;
      const d = await api('/matching/unmatched', { query: { page, limit: LIMIT, q: q || undefined, inProduction: onlyProd ? 1 : undefined, productionNo: filter.productionNo || undefined, orderNo: filter.orderNo || undefined, stage: filter.stage || undefined } });
      items = append ? items.concat(d.items || []) : (d.items || []);
      total = d.total ?? items.length; loaded = true;
      fill(orderSel, 'productionNo', 'Заказ', d.facets?.orders, (v) => (v === '-' ? 'Без № заказа' : v));
      fill(contractSel, 'orderNo', 'Договор', d.facets?.contracts, (v) => v);
      fill(stageSel, 'stage', 'Этап заказа', d.facets?.stages, (v) => STAGE[v]?.label || v);
    } catch (e) { toastError(e, 'загрузить несопоставленные позиции'); }
    paint();
  };
  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value.trim(); load(false); }, 300); });
  prod.addEventListener('change', () => { onlyProd = prod.checked; load(false); });
  more.addEventListener('click', () => load(true));
  bulkBtn.addEventListener('click', (e) => { e.currentTarget.classList.add('is-busy'); const list = sure(); run(() => api('/matching/bulk', { method: 'POST', body: { items: list.map((x) => ({ lineId: x.lineId, productId: best(x).productId })) } })); });
  box.append(h('p', { class: 'hint' }, write ? 'Здесь строки договоров, которые ещё не связаны с изделием из «Продукции». Сравните картинки слева и справа. Совпало — подтвердите. Нет — выберите другое изделие.' : 'Только просмотр: сопоставлять могут администратор и менеджер.'),
    bulkBtn, h('div', { class: 'mq-bar' }, h('label', { class: 'field' }, search), orderSel, contractSel, stageSel, h('label', { class: 'check' }, prod, ' Только в производстве')), body, more);
  btn.addEventListener('click', () => {
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
    btn.classList.toggle('active', !box.hidden);
    if (!box.hidden) load(false);
  });
  window.addEventListener('data-changed', () => { if (!el.isConnected) return; setCount(); if (!box.hidden) load(false); });
  setCount();
  if (open) load(false);
  return el;
}

/**
 * УПР-1/Д9: Самостоятельный экран «Сопоставление» (#matching) с двумя вкладками:
 * «Позиции» — очередь несопоставленных позиций заказов; «Договоры без заказа» — выбор договоров для переноса в заказ.
 */
const TABS = [['positions', 'Позиции'], ['unassigned', 'Договоры без заказа']];
const tabOf = (p) => (p?.tab === 'unassigned' ? 'unassigned' : 'positions');

export function mountMatchingQueue(params) {
  let tab = tabOf(params);
  const counts = { positions: null, unassigned: null };
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Сопоставление' });
  const body = h('div', { class: 'panel mq-screen-body' });
  const el = h('div', { class: 'matching-screen' }, h('div', { class: 'page-head' }, h('h1', null, 'Сопоставление')), tabs, body);

  const drawTabs = () => tabs.replaceChildren(...TABS.map(([k, label]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(tab === k), class: tab === k ? 'active' : '',
    onclick: () => { if (tab !== k) go('matching', k === 'unassigned' ? { tab: k } : {}, { replace: true }); },
  }, counts[k] == null ? label : `${label} · ${qty(counts[k])}`)));
  const loadCounts = async () => {
    const [c, u] = await Promise.all([unmatchedCount(), api('/production-orders/unassigned', { query: { limit: 1 } }).catch(() => null)]);
    counts.positions = c.total ?? 0;
    counts.unassigned = u?.total ?? counts.unassigned;
    drawTabs();
  };

  let seq = 0; // быстрая смена вкладок: модуль вкладки мог приехать, когда она уже закрыта
  const mountTab = () => {
    const my = ++seq;
    drawTabs();
    if (tab === 'positions') { body.replaceChildren(unmatchedTop({ open: true })); return; }
    body.replaceChildren(h('p', { class: 'muted' }, 'Загрузка…'));
    import('./salesorders-unassigned.js').then(({ unassignedPicker, unassignedBar }) => {
      if (my !== seq) return;
      let picker = null;
      const { bar, onChange } = unassignedBar(() => picker);
      picker = unassignedPicker({ onChange });
      body.replaceChildren(h('p', { class: 'hint' }, 'Здесь договоры, которые ещё не вошли в заказ. Отметьте договоры и нажмите «В заказ…». Договор с несопоставленными позициями сначала сопоставьте.'), bar, picker.el);
    }).catch((e) => { if (my === seq) body.replaceChildren(h('p', { class: 'neg' }, 'Не загрузилось: ' + (e?.message || e))); });
  };
  window.addEventListener('data-changed', loadCounts);
  mountTab();
  loadCounts();
  return {
    el,
    update: (p) => { if (tabOf(p) !== tab) { tab = tabOf(p); mountTab(); } },
    destroy: () => window.removeEventListener('data-changed', loadCounts),
  };
}
