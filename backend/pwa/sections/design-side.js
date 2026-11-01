import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { current, go } from '../core/router.js';
import { paintOrder } from '../core/order-color.js';
import { sku as kitSku, button, card, badge, empty, modal, toast, toastError, failBlock, busyBlock, attachCombo, openPopMenu, draggable, afterDrag, DESIGN_STATUS } from '../ui/kit/index.js';
import { addToBoard, clean, createTask, distributeOrder, dropOrder, loadLines, normBoard, orderName } from './design-data.js';
import { copyLink } from './design-menu.js';
import { orderLabel } from './salesorders.js';

/**
 * Левая панель «Проектирования» (kit.layout.split): заказы доски, раскрываются в изделия; изделие без задачи перетаскивают в колонку доски
 * (создаётся задача) или берут кнопкой. Сервер: GET /design-board, GET /design-board/:id/lines, POST /design-board, DELETE /design-board/:id.
 * env = { people(), activeOrders() }; onBoard() — перечитать доску после действия.
 */
const COLS = ['queue', 'work', 'paused', 'done', 'cancelled'];
const SHORT = { queue: 'распределение', work: 'в работе', paused: 'пауза', done: 'готово', cancelled: 'отменено' };
const plain = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
const isPhone = () => window.matchMedia('(max-width: 720px)').matches;
const dotted = (...xs) => xs.map(clean).filter(Boolean).join(' · ');

export function designSide({ query, env, onBoard }) {
  const canEdit = session.canEdit;
  let q = query, showAll = false, seq = 0;
  const S = { orders: [], tasks: [], lines: new Map(), loading: new Set(), expanded: new Set(), error: null, ready: false };
  const el = h('div', { class: 'k-side-item' });
  const isOpen = (o) => (o.counts.queue + o.counts.work + o.counts.paused) > 0;
  const taskText = (t) => plain([t.code, t.title, t.productName, t.sku, t.productionNo, t.orderNo, t.customerTitle].join(' '));
  const visible = () => {
    const s = plain(q.search);
    return S.orders.filter((o) => (showAll || s || q.orderId || isOpen(o)) && (!q.orderId || o.orderId === q.orderId)
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
      actions: !t && canEdit ? button({ label: 'Взять в работу', size: 'S', onClick: () => take(l, 'work') }) : null,
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
  async function addOrder() {
    let all;
    try { all = await env.activeOrders(); } catch (e) { toastError(e, 'загрузить заказы'); return; }
    const have = new Set(S.orders.map((o) => o.orderId));
    const opts = all.filter((o) => !have.has(String(o.id))).map((o) => ({ value: o.id, label: orderLabel(o) }));
    let picked = null;
    const inp = h('input', { placeholder: '№ заказа или заказчик', 'aria-label': 'Заказ', maxlength: 100, autocomplete: 'off' });
    attachCombo(inp, { options: () => opts, onPick: (o) => { picked = o.value; }, empty: () => 'Нет подходящих заказов. Добавлены все заказы в работе, либо заказа нет — проверьте раздел «Заказы».' });
    inp.addEventListener('input', () => { picked = null; });
    const cb = h('input', { type: 'checkbox', checked: true });
    const r = await modal({ title: 'Добавить заказ в проектирование', okText: 'Добавить',
      body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Заказ'), inp), h('label', { class: 'field' }, h('span', null, 'Позиции'), h('span', null, cb, ' Сразу поставить все позиции на распределение'))),
      onOk: () => { if (!picked) throw new Error('Выберите заказ из списка.'); return { id: picked, distribute: cb.checked }; } });
    if (!r) return;
    await act(async () => { const res = await addToBoard(r.id, r.distribute); S.expanded.add(String(r.id)); toast(r.distribute && res.created ? `Заказ добавлен, на распределение: ${res.created} поз.` : 'Заказ добавлен в проектирование'); });
    if (S.expanded.has(String(r.id))) fetchLines(String(r.id));
  }
  function paint() {
    const vis = visible();
    const hidden = S.orders.filter((o) => !isOpen(o)).length;
    const bar = h('div', { class: 'toolbar' }, h('b', null, 'Заказы · ', String(vis.length)), canEdit ? button({ label: '+ Добавить заказ', kind: 'primary', size: 'S', onClick: addOrder }) : null,
      hidden ? button({ label: showAll ? 'Только в работе' : `Показать все (+${hidden})`, kind: 'ghost', size: 'S', title: 'Заказы, где всё спроектировано или задачи не поставлены', onClick: () => { showAll = !showAll; paint(); } }) : null);
    if (!S.ready) { el.replaceChildren(bar, busyBlock('заказы')); return; }
    if (S.error) { el.replaceChildren(bar, failBlock(S.error, () => load(), { text: 'Доска не загрузилась' })); return; }
    el.replaceChildren(bar, ...(vis.length ? vis.map(orderNode) : [empty({ title: S.orders.length ? 'Открытых задач нет.' : 'Заказов пока нет.', hint: S.orders.length ? '«Показать все» — заказы, где всё готово или задачи не поставлены.' : 'Добавьте заказ, который нужно проектировать — кнопка выше.' })]));
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
