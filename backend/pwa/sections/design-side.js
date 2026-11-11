import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { current, go } from '../core/router.js';
import { paintOrder } from '../core/order-color.js';
import { sku as kitSku, button, card, badge, empty, toast, toastError, failBlock, busyBlock, openPopMenu, draggable, afterDrag, DESIGN_STATUS } from '../ui/kit/index.js';
import { clean, createTask, distributeOrder, dropOrder, loadLines, normBoard, orderName } from './design-data.js';
import { copyLink } from './design-menu.js';

/**
 * Левая панель «Проектирования» (kit.layout.split): заказы с открытой работой.
 * Заказ появляется сам после «Передать в проектирование» в карточке заказа (сервер подхватывает
 * метку designorders ∪ открытые задачи). Кнопок «добавить заказ» нет — принимать позиции
 * можно на карточке: «На распределение» / «Взять в работу» или перетаскиванием на доску.
 * env = { people() }; onBoard() — перечитать доску после действия.
 */
const COLS = ['queue', 'work', 'paused', 'done', 'cancelled'];
const SHORT = { queue: 'распределение', work: 'в работе', paused: 'пауза', done: 'готово', cancelled: 'отменено' };
const plain = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
const isPhone = () => window.matchMedia('(max-width: 720px)').matches;
const dotted = (...xs) => xs.map(clean).filter(Boolean).join(' · ');

/** Нужна работа проектировщика: есть позиции без задачи или открытые задачи. */
const needsWork = (o) => {
  const c = o.counts || {};
  return (c.free || 0) > 0 || (c.queue || 0) + (c.work || 0) + (c.paused || 0) > 0;
};

export function designSide({ query, env, onBoard }) {
  const canEdit = session.canEdit;
  let q = query, showAll = false, seq = 0;
  const S = { orders: [], tasks: [], lines: new Map(), loading: new Set(), expanded: new Set(), error: null, ready: false };
  const el = h('div', { class: 'k-side-item' });
  const taskText = (t) => plain([t.code, t.title, t.productName, t.sku, t.productionNo, t.orderNo, t.customerTitle].join(' '));
  const visible = () => {
    const s = plain(q.search);
    return S.orders.filter((o) => (showAll || s || q.orderId || needsWork(o)) && (!q.orderId || o.orderId === q.orderId)
      && (!s || plain([o.productionNo, o.orderNo, o.customer].join(' ')).includes(s) || S.tasks.some((t) => t.orderId === o.orderId && taskText(t).includes(s))));
  };
  const openTask = (t) => go('design', { ...current().params, of: undefined, open: t.id, new: undefined }, { kind: 'card' });
  const openOrder = (id) => go('design', { ...current().params, of: 'designorder', open: id, new: undefined }, { kind: 'card' });
  async function act(fn) {
    try { await fn(); } catch (e) { if (e?.status === 409) toast('Позицию уже взяли', { tone: 'warn', sub: 'Список обновлён.' }); else toastError(e, 'выполнить действие'); }
    await load(); onBoard();
  }
  const take = (line, to) => act(() => createTask(line, to, env.people));
  async function fetchLines(id) {
    S.loading.add(id);
    try { S.lines.set(id, await loadLines(id, S.orders.find((o) => o.orderId === id))); } catch (e) { S.lines.set(id, []); toastError(e, 'открыть изделия заказа'); }
    S.loading.delete(id); afterDrag(paint);
  }
  const toggle = (id) => { if (S.expanded.has(id)) S.expanded.delete(id); else { S.expanded.add(id); fetchLines(id); } paint(); };

  function lineNode(o, l) {
    const t = l.task;
    const title = (l.lineNo != null ? `поз. ${l.lineNo} · ` : '') + l.title;
    const node = card({ size: 'S', title, meta: h('span', null, kitSku(l.sku), l.sku && l.qty != null ? ' · ' : null, dotted(l.qty != null && qty(l.qty) + ' шт')),
      badges: t ? badge(DESIGN_STATUS, t.status) : null,
      actions: !t && canEdit ? [button({ label: 'На распределение', size: 'S', kind: 'ghost', onClick: () => take(l, 'queue') }), button({ label: 'Взять в работу', size: 'S', onClick: () => take(l, 'work') })] : null,
      onClick: () => (t ? openTask(t) : openOrder(o.orderId)) });
    paintOrder(node, o.orderId);
    if (!t && canEdit) draggable(node, { canStart: () => !isPhone(), targetSel: '.board .col', canDrop: (c) => c.dataset.key !== 'done', onDrop: (c) => take(l, c.dataset.key) });
    return node;
  }
  function orderMenu(btn, o) {
    const only = q.orderId === o.orderId;
    const url = `${location.origin}${location.pathname}#design?of=designorder&open=${o.orderId}`;
    const g1 = [{ label: 'Открыть', onSelect: () => openOrder(o.orderId) }, { label: 'Открыть в «Заказах»', onSelect: () => go('salesorders', { open: o.orderId }, { kind: 'card' }) },
      { label: only ? 'Сбросить: показать все заказы' : 'Показать только этот заказ', onSelect: () => go('design', { ...current().params, orderId: only ? undefined : o.orderId }, { replace: true }) },
      { label: 'Копировать ссылку', onSelect: () => copyLink(url) }];
    const g2 = canEdit ? [{ label: 'На распределение все позиции', onSelect: () => act(() => distributeOrder(o.orderId)) }] : [];
    const g3 = canEdit ? [{ label: 'Убрать из проектирования', danger: true, onSelect: () => act(() => dropOrder(o)) }] : [];
    openPopMenu({ anchor: btn, side: 'down', groups: [{ items: g1 }, { sep: true, items: g2 }, { sep: true, items: g3 }] });
  }
  function orderNode(o) {
    const open = S.expanded.has(o.orderId), c = o.counts;
    const badges = [...COLS.filter((k) => c[k]).map((k) => badge(`${SHORT[k]} ${c[k]}`, DESIGN_STATUS[k].tone)), c.free ? badge(`не взято ${c.free}`, 'info') : null];
    const stop = (fn) => (e) => { e?.stopPropagation?.(); fn(e); };
    const more = button({ label: '⋯', kind: 'ghost', size: 'S', title: `Действия с заказом ${orderName(o)}`, onClick: stop((e) => orderMenu(e.currentTarget, o)) });
    const chev = button({ label: open ? '▾ Изделия' : '▸ Изделия', kind: 'ghost', size: 'S', onClick: stop(() => toggle(o.orderId)) });
    const head = card({ size: 'L', title: orderName(o), meta: o.customer, badges, actions: [chev, more], onClick: () => openOrder(o.orderId) });
    paintOrder(head, o.orderId);
    const lines = S.lines.get(o.orderId);
    const body = !open ? null : S.loading.has(o.orderId) && !lines ? busyBlock('изделия') : lines?.length ? h('div', { class: 'k-side-item' }, ...lines.map((l) => lineNode(o, l))) : empty({ title: 'В заказе нет позиций.' });
    return h('div', { class: 'k-side-item' }, head, body);
  }
  function paint() {
    const vis = visible();
    const doneOnly = S.orders.filter((o) => !needsWork(o)).length;
    const bar = h('div', { class: 'toolbar' }, h('b', null, 'Заказы · ', String(vis.length)),
      doneOnly ? button({ label: showAll ? 'Только в работе' : `Завершённые (+${doneOnly})`, kind: 'ghost', size: 'S', title: 'Заказы, где все позиции уже завершены или без открытой работы', onClick: () => { showAll = !showAll; paint(); } }) : null);
    if (!S.ready) { el.replaceChildren(bar, busyBlock('заказы')); return; }
    if (S.error) { el.replaceChildren(bar, failBlock(S.error, () => load(), { text: 'Доска не загрузилась' })); return; }
    const emptyHint = S.orders.length
      ? 'Новые появятся после «Передать в проектирование» в карточке заказа. «Завершённые» — уже закрытые.'
      : 'В карточке заказа нажмите «Передать в проектирование» — заказ появится здесь сам.';
    el.replaceChildren(bar, ...(vis.length ? vis.map(orderNode) : [empty({ title: S.orders.length ? 'Сейчас всё в колонках справа.' : 'Заказов в проектировании пока нет.', hint: emptyHint })]));
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
      await Promise.all([...S.expanded].map((id) => loadLines(id, S.orders.find((o) => o.orderId === id)).then((l) => S.lines.set(id, l)).catch(() => S.lines.set(id, []))));
    } catch (e) { if (my !== seq) return; S.error = e; S.ready = true; }
    afterDrag(paint);
  }
  paint(); load();
  return { el, reload: () => load(), setQuery: (qq) => { q = qq; afterDrag(paint); } };
}
