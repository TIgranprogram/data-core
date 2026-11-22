import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { current, go } from '../core/router.js';
import { paintOrder } from '../core/order-color.js';
import { sku as kitSku, button, iconButton, row, badge, empty, toast, toastError, failBlock, busyBlock, openPopMenu, draggable, afterDrag, DESIGN_STATUS } from '../ui/kit/index.js';
import { clean, createTask, distributeOrder, dropOrder, loadLines, normBoard, openDesignCard, orderName } from './design-data.js';
import { copyLink } from './design-menu.js';

/**
 * Левая панель «Проектирования» (kit.layout.split): заказы с открытой работой.
 * Заказ появляется сам после «Передать в проектирование» в карточке заказа (сервер подхватывает
 * метку designorders ∪ открытые задачи). Кнопок «добавить заказ» нет — принимать позиции
 * можно на карточке: «На распределение» / «Взять в работу» или перетаскиванием на доску.
 * board — правая доска и её область прокрутки; onBoard() — перечитать доску после действия.
 */
const COLS = ['queue', 'work', 'paused', 'done', 'cancelled'];
const SHORT = { queue: 'распределение', work: 'в работе', paused: 'пауза', done: 'готово', cancelled: 'отменено' };
const CREATE_IN = new Set(['queue', 'work', 'paused']);
const plain = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
const isPhone = () => window.matchMedia('(max-width: 720px)').matches;

/** Нужна работа проектировщика: есть позиции без задачи или открытые задачи. */
const needsWork = (o) => {
  const c = o.counts || {};
  return (c.free || 0) > 0 || (c.queue || 0) + (c.work || 0) + (c.paused || 0) > 0;
};

export function designSide({ query, board, env, onBoard }) {
  const canEdit = session.canEdit;
  let q = query, showClosed = false, seq = 0;
  const S = { orders: [], tasks: [], positions: new Map(), expanded: new Set(), taking: new Set(), error: null, ready: false };
  const el = h('div', { class: 'k-side-item' });
  const taskText = (t) => plain([t.code, t.title, t.productName, t.sku, t.productionNo, t.orderNo, t.customerTitle].join(' '));
  const visible = () => {
    const s = plain(q.search);
    return S.orders.filter((o) => needsWork(o) !== showClosed && (!q.orderId || o.orderId === q.orderId)
      && (!s || plain([o.productionNo, o.orderNo, o.customer].join(' ')).includes(s) || S.tasks.some((t) => t.orderId === o.orderId && taskText(t).includes(s))));
  };
  const openOrder = (id) => openDesignCard(id, 'designorder');
  async function act(fn) {
    try { if (await fn() === false) return; } catch (e) { if (e?.status === 409) toast('Позицию уже взяли', { tone: 'warn', sub: 'Список обновлён.' }); else toastError(e, 'выполнить действие'); }
    await load(); onBoard();
  }
  async function take(line, to) {
    if (S.taking.has(line.incomeId)) return;
    S.taking.add(line.incomeId);
    try { await act(() => createTask(line, to, env.people)); } finally { S.taking.delete(line.incomeId); }
  }
  async function fetchLines(id) {
    const order = S.orders.find((o) => o.orderId === id);
    if (!order) return;
    const state = { loading: true };
    S.positions.set(id, state);
    try { state.lines = await loadLines(id, order); } catch (error) { state.error = error; }
    state.loading = false;
    if (S.positions.get(id) === state && S.expanded.has(id)) afterDrag(paint);
  }
  function toggle(id) {
    if (S.expanded.has(id)) S.expanded.delete(id);
    else {
      S.expanded.add(id);
      if (!S.positions.get(id)?.loading) fetchLines(id);
    }
    paint();
  }

  function lineNode(l) {
    const t = l.task;
    const free = !t && canEdit;
    const status = t?.status === 'done' ? badge('Завершено', DESIGN_STATUS.done.tone) : t ? badge(DESIGN_STATUS, t.status) : badge('Ещё не взято', 'dim');
    const title = t ? button({ label: l.title, kind: 'ghost', size: 'S', cls: 'design-side-task', title: l.title, onClick: () => openDesignCard(t.id) }) : l.title;
    const menu = free && iconButton({ icon: '⋯', label: `Действия с позицией ${l.title}`, size: 'S', menu: true, onClick: (e) => {
      openPopMenu({ anchor: e.currentTarget, side: 'down', groups: [{ items: [
        { label: 'На распределение', onSelect: () => take(l, 'queue') },
        { label: 'Взять в работу', onSelect: () => take(l, 'work') },
      ] }] });
    } });
    const lead = free ? h('span', { class: 'design-side-grip', title: 'Перетащить позицию в столбец доски', 'aria-hidden': 'true' }, '⠿') : null;
    const meta = h('span', null, l.lineNo != null && `Поз. ${l.lineNo}`, l.lineNo != null && l.sku ? ' · ' : null, kitSku(l.sku),
      (l.lineNo != null || l.sku) && l.qty != null ? ' · ' : null, l.qty != null && `${qty(l.qty)} ${l.unit || 'шт'}`);
    const node = row({ tag: 'li', cls: 'design-side-line' + (free ? ' design-side-line-free' : ''), title, meta, lead, below: status, action: menu, wrap: true });
    if (free) draggable(node, {
      canStart: () => !isPhone() && !S.taking.has(l.incomeId),
      targetSel: '.design-board > .col', scroller: board, scrollAxis: 'x',
      canDrop: (col) => board.contains(col) && CREATE_IN.has(col.dataset.key),
      onDrop: (col) => take(l, col.dataset.key),
    });
    return node;
  }
  function orderMenu(btn, o) {
    const only = q.orderId === o.orderId;
    const url = `${location.origin}${location.pathname}#design?of=designorder&open=${o.orderId}`;
    const g1 = [{ label: 'Открыть в «Заказах»', onSelect: () => go('salesorders', { open: o.orderId }, { kind: 'card' }) },
      { label: only ? 'Сбросить: показать все заказы' : 'Показать только этот заказ', onSelect: () => go('design', { ...current().params, designOrder: only ? undefined : o.orderId }, { replace: true }) },
      { label: 'Копировать ссылку', onSelect: () => copyLink(url) }];
    const g2 = canEdit && o.counts.free !== 0 ? [{ label: 'На распределение все позиции', onSelect: () => act(() => distributeOrder(o.orderId)) }] : [];
    const g3 = canEdit ? [{ label: 'Убрать из проектирования', danger: true, onSelect: () => act(() => dropOrder(o)) }] : [];
    openPopMenu({ anchor: btn, side: 'down', groups: [{ items: g1 }, { sep: true, items: g2 }, { sep: true, items: g3 }] });
  }
  function orderNode(o) {
    const open = S.expanded.has(o.orderId), c = o.counts;
    const name = orderName(o), nameId = `design-order-${o.orderId}`, groupId = `${nameId}-lines`;
    const badges = [...COLS.filter((k) => c[k]).map((k) => badge(`${SHORT[k]} ${c[k]}`, DESIGN_STATUS[k].tone)), c.free ? badge(`не взято ${c.free}`, 'info') : null];
    const more = iconButton({ icon: '⋯', size: 'S', label: `Действия с заказом ${name}`, menu: true, onClick: (e) => orderMenu(e.currentTarget, o) });
    const openButton = button({ label: name, kind: 'ghost', size: 'S', cls: 'db-oname design-order-open', onClick: () => openOrder(o.orderId) });
    openButton.id = nameId;
    openButton.setAttribute('aria-label', `Открыть заказ ${name} в проектировании`);
    const head = h('div', { class: 'db-oh' }, h('h3', null, openButton), more);
    const state = S.positions.get(o.orderId);
    const count = o.linesCount ?? state?.lines?.length;
    const mayExpand = count !== 0 || open;
    const disclosure = mayExpand ? button({ label: [h('span', { class: 'design-order-chevron', 'aria-hidden': 'true' }, '▸'), `Изделия${count == null ? '' : ` · ${count}`}`], kind: 'ghost', size: 'S', cls: 'design-order-toggle', onClick: () => toggle(o.orderId) }) : null;
    disclosure?.setAttribute('aria-controls', groupId);
    disclosure?.setAttribute('aria-expanded', String(open));
    const summary = h('div', { class: 'design-order-summary', onclick: (e) => { if (!e.target.closest('button')) openOrder(o.orderId); } },
      head, o.customer ? h('span', { class: 'db-cust' }, o.customer) : null,
      h('div', { class: 'design-order-footer' }, badges.some(Boolean) ? h('div', { class: 'design-order-badges' }, ...badges) : null, disclosure));
    let content = null;
    if (open) {
      if (state?.loading) content = busyBlock('изделия');
      else if (state?.error) content = failBlock(state.error, () => { fetchLines(o.orderId); paint(); }, { text: 'Изделия не загрузились' });
      else if (state?.lines?.length) content = h('ul', { class: 'design-side-lines-list' }, ...state.lines.map(lineNode));
      else content = empty({ title: 'В заказе нет позиций.' });
    }
    return paintOrder(h('article', { class: 'db-order design-side-order', 'aria-labelledby': nameId }, summary,
      mayExpand ? h('div', { class: 'db-lines design-side-lines', id: groupId, hidden: !open }, content) : null), o.orderId);
  }
  function paint() {
    const vis = visible();
    const doneOnly = S.orders.filter((o) => !needsWork(o)).length;
    const switchView = showClosed || doneOnly ? button({ label: showClosed ? 'Активные' : `Закрытые (${doneOnly})`, kind: 'ghost', size: 'S', cls: 'design-orders-switch', onClick: () => {
      showClosed = !showClosed;
      if (q.orderId) go('design', { ...current().params, designOrder: undefined }, { replace: true });
      else paint();
      el.querySelector('.design-orders-switch')?.focus();
    } }) : null;
    const bar = h('div', { class: 'toolbar' }, h('h3', null, showClosed ? 'Закрытые заказы' : 'Заказы', ' · ', String(vis.length)), switchView);
    if (!S.ready) { el.replaceChildren(bar, busyBlock('заказы')); return; }
    if (S.error) { el.replaceChildren(bar, failBlock(S.error, () => load(), { text: 'Доска не загрузилась' })); return; }
    const emptyHint = S.orders.length
      ? 'Новые появятся после «Передать в проектирование» в карточке заказа.'
      : 'В карточке заказа нажмите «Передать в проектирование» — заказ появится здесь сам.';
    const active = el.contains(document.activeElement) ? document.activeElement : null;
    const disclosureId = active?.matches('.design-order-toggle') ? active.getAttribute('aria-controls') : null;
    const focusSelector = disclosureId ? `[aria-controls="${CSS.escape(disclosureId)}"]` : active?.matches('.design-orders-switch') ? '.design-orders-switch' : null;
    const blank = q.search || q.orderId ? 'Заказы по этому фильтру не найдены.' : showClosed ? 'Закрытых заказов нет.' : 'Активных заказов пока нет.';
    el.replaceChildren(bar, ...(vis.length ? vis.map(orderNode) : [empty({ title: blank, hint: !q.search && !q.orderId && !showClosed ? emptyHint : null })]));
    if (focusSelector) el.querySelector(focusSelector)?.focus({ preventScroll: true });
  }
  async function load() {
    const my = ++seq;
    try {
      const nb = normBoard(await api('/design-board'));
      if (my !== seq) return;
      S.orders = nb.orders.sort((a, z) => (a.deadline ? 0 : 1) - (z.deadline ? 0 : 1) || String(a.deadline).localeCompare(String(z.deadline)) || String(a.orderNo).localeCompare(String(z.orderNo), 'ru', { numeric: true }));
      S.tasks = nb.tasks; S.error = null;
      S.expanded = new Set([...S.expanded].filter((id) => S.orders.some((o) => o.orderId === id)));
      S.ready = true;
      for (const id of S.positions.keys()) if (!S.expanded.has(id)) S.positions.delete(id);
      await Promise.all([...S.expanded].map(fetchLines));
    } catch (e) { if (my !== seq) return; S.error = e; S.ready = true; }
    afterDrag(paint);
  }
  paint(); load();
  return { el, reload: () => load(), setQuery: (qq) => { q = qq; afterDrag(paint); } };
}
