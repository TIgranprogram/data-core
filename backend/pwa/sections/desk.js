import { session } from '../core/api.js';
import { viewAsActive } from '../core/view-as.js';
import { h } from '../core/dom.js';
import { isoDay } from '../core/format.js';
import { afterDrag, button, draggable, empty, failBlock, iconButton, busyBlock, toastError } from '../ui/kit/index.js';
import { recentStore } from '../core/recent-session.js';
import { canFollow } from '../core/route-access.js';
import { recentHref } from '../core/recent-cards.js';
import { deskCanRead, deskKind, deskRef, loadDeskCard } from './desk-data.js';
import { deskActions, deskCard, deskMark, taskDate } from './desk-card.js';
import { deskStorage, keyOf, LANES } from './desk-state.js';

function agenda(items) {
  const entries = items.flatMap((item) => {
    const title = item.of === 'personal' && !item.done ? [{ item, task: item, standalone: true }] : [];
    return title.concat((item.tasks || []).filter((task) => !task.done).map((task) => ({ item, task })));
  });
  return entries.sort((a, b) => (a.task.due || '9999-12-31').localeCompare(b.task.due || '9999-12-31'));
}

function titleBlock(title, count) {
  return h('div', { class: 'desk-area-head' }, h('h2', null, title), count ? h('span', { class: 'desk-count' }, count) : null);
}

export function mountDesk() {
  const canvas = h('div');
  const status = h('div', { class: 'desk-save', role: 'status' });
  const add = button({ label: '+ Задача', kind: 'primary', onClick: () => actions.create() });
  const header = h('div', { class: 'desk-head' }, h('h1', null, 'Рабочий стол'), status, add);
  const el = h('section', { class: 'desk-screen' }, header, canvas);
  if (viewAsActive(session.realUser)) {
    add.hidden = true;
    canvas.append(empty({ title: 'Личный рабочий стол', hint: 'Выйдите из просмотра роли, чтобы открыть свои карточки и задачи.' }));
    return { el };
  }

  const store = deskStorage();
  let disposed = false, painted = false, cacheEpoch = 0, busy = 0;
  const cache = new Map(), queue = [];
  const expanded = new Set();
  let mark = '';
  const actions = deskActions((action) => {
    try {
      if (action.type === 'task' && action.task) expanded.add(action.key);
      store.dispatch(action);
    } catch (e) { toastError(e); }
  });
  const paintLater = () => {
    if (disposed || painted) return;
    painted = true;
    queueMicrotask(() => afterDrag(() => { painted = false; if (!disposed) paint(); }));
  };
  function run() {
    while (busy < 5 && queue.length && !disposed) {
      const [item, epoch] = queue.shift();
      const key = keyOf(item);
      if (epoch !== cacheEpoch) continue;
      busy++;
      loadDeskCard(item).then((meta) => {
        if (epoch === cacheEpoch) { cache.set(key, meta); paintLater(); }
      }).finally(() => { busy--; run(); });
    }
  }
  function read(item) {
    const key = keyOf(item);
    if (!cache.has(key)) { cache.set(key, null); queue.push([item, cacheEpoch]); }
    return cache.get(key);
  }
  function sources() {
    const unique = new Map();
    for (const entry of recentStore()?.list() || []) {
      if (!canFollow(session, recentHref(entry))) continue;
      const item = deskRef(entry);
      if (item && deskCanRead(item) && !unique.has(keyOf(item))) unique.set(keyOf(item), item);
    }
    return [...unique.values()];
  }
  function putFocus(key) {
    mark = key;
    expanded.add(key);
    paint();
    const card = [...canvas.querySelectorAll('[data-desk-card]')].find((el) => el.dataset.deskCard === key);
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    card.querySelector('h3 :is(a,input)')?.focus({ preventScroll: true });
  }
  function bind(node, item, isReady) {
    if (!isReady) return;
    const key = keyOf(item);
    draggable(node, { targetSel: '[data-desk-card], [data-desk-lane]',
      canStart: () => !disposed && store.state().ready,
      canDrop: (target) => canvas.contains(target) && target.dataset.deskCard !== key,
      onDrop: (target) => {
        const lane = target.closest('[data-desk-lane]');
        if (lane) actions.place(item, lane.dataset.deskLane, target.dataset.deskCard);
      },
    });
  }
  function recentNode(item, meta, isReady, pinned) {
    const put = iconButton({ icon: '+', size: 'S', label: 'В фокус: ' + meta.title, onClick: () => actions.place(item, 'focus') });
    put.disabled = !isReady;
    const row = h('div', { class: 'desk-recent-row', dataset: { deskColor: deskKind(item.of)[4] } },
      deskMark(item.of, meta.thumb),
      h('div', null, h('span', { class: 'desk-kind' }, deskKind(item.of)[0]), h('a', { href: meta.href, title: meta.title }, meta.title)),
      pinned ? iconButton({ icon: '✓', label: 'Найти на столе: ' + meta.title, size: 'S', onClick: () => putFocus(keyOf(item)) }) : put);
    if (!pinned) bind(row, item, isReady);
    return row;
  }
  function paint() {
    const current = store.state();
    const { items, ready, saving, error } = current;
    add.disabled = !ready;
    status.replaceChildren(saving ? h('span', null, 'Сохраняется…') : ready && !error ? h('span', null, 'Сохранено') : null,
      error && ready ? [h('span', { class: 'desk-late' }, 'Изменения не сохранились'),
        button({ label: 'Повторить', kind: 'ghost', size: 'S', onClick: () => store.retry() }),
        button({ label: 'Отменить несохранённое', kind: 'ghost', size: 'S', onClick: () => store.discard() })] : null);
    if (!ready) {
      canvas.replaceChildren(error ? failBlock(error, () => store.retry(), { text: 'Рабочий стол не загрузился' }) : busyBlock('Рабочий стол'));
      return;
    }
    const allowed = items.filter((item) => item.of === 'personal' || deskCanRead(item));
    const pinned = new Set(items.map(keyOf));
    const left = sources();
    for (const item of allowed) if (item.of !== 'personal') read(item);
    const pendingRecent = left.map((item) => [item, read(item)]);
    const recent = pendingRecent.filter(([, meta]) => meta?.href);
    const plan = agenda(allowed.filter((item) => item.of === 'personal' || cache.get(keyOf(item))?.href));
    const boards = h('div', { class: 'desk-boards', 'aria-label': 'Стопки рабочего стола' },
      LANES.map(({ key, title, empty: hint }) => {
        const list = allowed.filter((item) => item.lane === key);
        const cards = list.map((item) => {
          const ref = keyOf(item);
          const card = deskCard(item, cache.get(ref), list, actions, expanded.has(ref), () => {
            if (expanded.has(ref)) expanded.delete(ref); else expanded.add(ref);
            paint();
            [...canvas.querySelectorAll('[data-desk-card]')].find((el) => el.dataset.deskCard === ref)?.querySelector('.desk-todo-toggle')?.focus();
          });
          card.classList.toggle('desk-selected', ref === mark);
          bind(card, item, ready);
          return card;
        });
        return h('section', { class: 'desk-lane', dataset: { deskLane: key }, 'aria-label': title },
          titleBlock(title, cards.length), h('div', { class: 'desk-lane-cards' }, cards.length ? cards : empty({ title: hint })));
      }));
    const recentBlock = h('aside', { class: 'desk-rail', 'aria-label': 'Недавние карточки' },
      titleBlock('Недавние'),
      h('div', { class: 'desk-history-list' }, recent.length ? recent.map(([item, meta]) => recentNode(item, meta, ready, pinned.has(keyOf(item))))
        : pendingRecent.some(([, meta]) => !meta) ? busyBlock('Недавние') : empty({ title: 'Пока нет карточек', hint: 'Откройте заказ, изделие или другую запись. Здесь появится ссылка.' })));
    const planBlock = h('aside', { class: 'desk-rail desk-agenda', 'aria-label': 'Мои задачи' },
      titleBlock('Мои задачи', plan.length),
      plan.length ? h('ol', { class: 'desk-agenda-list' }, plan.map(({ item, task, standalone }) => {
        const late = task.due && task.due < isoDay();
        const parent = !standalone ? item.title || cache.get(keyOf(item))?.title : '';
        return h('li', { class: late ? 'is-late' : null },
          button({ kind: 'ghost', onClick: () => putFocus(keyOf(item)), label: [h('strong', null, task.title),
            parent ? h('small', null, parent) : null, taskDate(task.due, task.done)] }));
      })) : empty({ title: 'Пока нет открытых задач', hint: 'Добавьте свою задачу или привяжите её к карточке.' }));
    canvas.replaceChildren(h('div', { class: 'desk-layout' }, recentBlock, boards, planBlock));
    run();
  }

  function reload() { cacheEpoch++; cache.clear(); queue.length = 0; paintLater(); }
  const stop = store.subscribe(paintLater);
  document.addEventListener('dc:recent-cards', paintLater);
  document.addEventListener('dc:changed', reload);
  window.addEventListener('online', store.retry);
  void store.load();
  paint();
  return {
    el, reload,
    destroy() {
      disposed = true;
      stop();
      document.removeEventListener('dc:recent-cards', paintLater);
      document.removeEventListener('dc:changed', reload);
      window.removeEventListener('online', store.retry);
    },
  };
}
