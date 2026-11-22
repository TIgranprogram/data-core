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
import { deskStorage, isDeskDone, keyOf, LANES } from './desk-state.js';

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
  let mark = '', archiveOpen = false, allRecent = false;
  const actions = deskActions((action) => {
    try {
      if (action.type === 'task' && action.task) expanded.add(action.key);
      store.dispatch(action);
    } catch (e) { toastError(e); return false; }
  }, (item) => remember(item));
  const paintLater = () => {
    if (disposed || painted) return;
    painted = true;
    queueMicrotask(() => afterDrag(() => { painted = false; if (!disposed) paint(); }, { pending: true }));
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
  function remember(item) {
    const meta = cache.get(keyOf(item));
    if (!meta?.href || !deskCanRead(item)) return;
    recentStore()?.remember({ section: deskKind(item.of)[3], of: item.of, id: item.id, title: meta.title, kind: deskKind(item.of)[0] });
    paintLater();
  }
  function forget(item) {
    const history = recentStore();
    for (const entry of history?.list() || []) {
      const ref = deskRef(entry);
      if (ref && keyOf(ref) === keyOf(item)) history.forget(entry);
    }
    paint();
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
  function bind(node, item, source) {
    const key = keyOf(item);
    const targetSel = '[data-desk-card], [data-desk-lane], [data-desk-recent]';
    draggable(node, { targetSel, handleSel: '[data-desk-grab]',
      canStart: () => !disposed && store.state().ready,
      canDrop: (target) => canvas.contains(target) && target.dataset.deskCard !== key &&
        (target.hasAttribute('data-desk-recent') ? source === 'table' && !!cache.get(key)?.href : !!target.closest('[data-desk-lane]')),
      onDrop: (target) => {
        if (target.hasAttribute('data-desk-recent')) { void actions.remove(item, true); return; }
        const lane = target.closest('[data-desk-lane]');
        if (lane) actions.place(item, lane.dataset.deskLane, target.dataset.deskCard);
      },
    });
  }
  function recentNode(item, meta) {
    const row = h('div', { class: 'desk-recent-row', dataset: { deskColor: deskKind(item.of)[4] } },
      h('div', { class: 'desk-grab', dataset: { deskGrab: '' }, title: 'Перетащить на стол' }, deskMark(item.of, meta.thumb),
        h('span', { class: 'desk-kind' }, deskKind(item.of)[0])),
      h('a', { href: meta.href, title: meta.title }, meta.title),
      h('div', { class: 'desk-recent-actions' },
        iconButton({ icon: '+', cls: 'desk-control', size: 'S', label: 'В фокус: ' + meta.title, onClick: () => actions.place(item, 'focus') }),
        iconButton({ icon: '×', cls: 'desk-control', size: 'S', label: 'Убрать из недавних: ' + meta.title, onClick: () => forget(item) })));
    bind(row, item, 'history');
    return row;
  }
  function itemCard(item, list) {
    const key = keyOf(item);
    const card = deskCard(item, cache.get(key), list, actions, expanded.has(key), () => {
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      paint();
      [...canvas.querySelectorAll('[data-desk-card]')].find((el) => el.dataset.deskCard === key)?.querySelector('.desk-todo-toggle')?.focus();
    });
    card.classList.toggle('desk-selected', key === mark);
    bind(card, item, 'table');
    return card;
  }
  function toggleArchive() {
    archiveOpen = !archiveOpen;
    paint();
    canvas.querySelector('.desk-archive-tab')?.focus({ preventScroll: true });
  }
  function archiveSection(completed) {
    const tab = button({ label: ['Завершённые', completed.length ? h('span', { class: 'desk-count' }, completed.length) : null],
      cls: 'desk-archive-tab', onClick: toggleArchive });
    tab.setAttribute('aria-expanded', String(archiveOpen));
    tab.setAttribute('aria-controls', 'desk-completed');
    return h('div', { class: 'desk-archive', onkeydown: (e) => {
      if (e.key === 'Escape' && archiveOpen) { e.stopPropagation(); toggleArchive(); }
    } }, tab, h('section', { id: 'desk-completed', class: 'desk-archive-panel', 'aria-label': 'Завершённые карточки', hidden: !archiveOpen },
      archiveOpen ? [titleBlock('Завершённые', completed.length),
        h('div', { class: 'desk-archive-cards' }, completed.length ? completed.map((item) => itemCard(item, [])) : empty({ title: 'Завершённых карточек пока нет' }))] : null));
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
    const active = allowed.filter((item) => !isDeskDone(item));
    const completed = allowed.filter(isDeskDone);
    const left = sources().filter((item) => !pinned.has(keyOf(item)));
    for (const item of archiveOpen ? allowed : active) if (item.of !== 'personal') read(item);
    const pendingRecent = left.map((item) => [item, read(item)]);
    const recent = pendingRecent.filter(([, meta]) => meta?.href);
    const plan = agenda(active.filter((item) => item.of === 'personal' || cache.get(keyOf(item))?.href));
    const boards = h('div', { class: 'desk-boards', 'aria-label': 'Стопки рабочего стола' },
      LANES.map(({ key, title, empty: hint }) => {
        const list = active.filter((item) => item.lane === key);
        const cards = list.map((item) => itemCard(item, list));
        return h('section', { class: 'desk-lane', dataset: { deskLane: key }, 'aria-label': title },
          titleBlock(title, cards.length), h('div', { class: 'desk-lane-cards' }, cards.length ? cards : empty({ title: hint })));
      }));
    const recentBlock = h('aside', { class: 'desk-rail', 'aria-label': 'Недавние карточки', dataset: { deskRecent: '' } },
      titleBlock('Недавние', recent.length),
      h('div', { class: 'desk-history-list' }, recent.length ? (allRecent ? recent : recent.slice(0, 6)).map(([item, meta]) => recentNode(item, meta))
        : pendingRecent.some(([, meta]) => !meta) ? busyBlock('Недавние') : empty({ title: 'Пока нет карточек', hint: 'Здесь появятся открытые записи, свободные для переноса.' })),
      recent.length > 6 ? h('div', { class: 'desk-history-foot' }, button({ size: 'S', label: allRecent ? 'Свернуть' : 'Показать все ' + recent.length, onClick: () => { allRecent = !allRecent; paint(); canvas.querySelector('.desk-history-foot button')?.focus(); } })) : null);
    const planBlock = h('aside', { class: 'desk-rail desk-agenda', 'aria-label': 'Мои задачи' },
      titleBlock('Мои задачи', plan.length),
      plan.length ? h('ol', { class: 'desk-agenda-list' }, plan.map(({ item, task, standalone }) => {
        const late = task.due && task.due < isoDay();
        const parent = !standalone ? item.title || cache.get(keyOf(item))?.title : '';
        return h('li', { class: late ? 'is-late' : null },
          button({ kind: 'ghost', onClick: () => putFocus(keyOf(item)), label: [h('strong', null, task.title),
            parent ? h('small', null, parent) : null, taskDate(task.due, task.done)] }));
      })) : empty({ title: 'Пока нет открытых задач', hint: 'Добавьте свою задачу или привяжите её к карточке.' }));
    const archiveFocused = canvas.contains(document.activeElement) && document.activeElement.matches('.desk-archive-tab');
    canvas.replaceChildren(h('div', { class: 'desk-layout' }, recentBlock, boards, planBlock, archiveSection(completed)));
    if (archiveFocused) canvas.querySelector('.desk-archive-tab')?.focus({ preventScroll: true });
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
