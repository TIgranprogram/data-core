import { api, apiFile, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date } from '../core/format.js';
import { recentHref } from '../core/recent-cards.js';
import { recentStore } from '../core/recent-session.js';
import { canFollow } from '../core/route-access.js';
import { viewAsActive } from '../core/view-as.js';
import { button, busyBlock, confirmDlg, failBlock, field, fileButton, iconButton, link, modal, section, select, textInput, toast, toastError } from '../ui/kit/index.js';
import { deskActions } from './desk-card.js';
import { deskCanRead, deskKind, deskRef, loadDeskCard } from './desk-data.js';
import { deskStorage, isDeskDone, keyOf } from './desk-state.js';

function pickerOptions(item) {
  const seen = new Set((item.refs || []).map(keyOf));
  return (recentStore()?.list() || []).flatMap((entry) => {
    const ref = deskRef(entry);
    if (!ref || seen.has(keyOf(ref)) || !canFollow(session, recentHref(entry)) || !deskCanRead(ref)) return [];
    seen.add(keyOf(ref));
    return [{ ref, title: entry.title }];
  });
}

function fromAddress(value) {
  const url = new URL(value, location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname || !canFollow(session, url.hash)) return null;
  const [section, query] = url.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  const ref = deskRef({ of: params.get('of') || section, id: params.get('open') });
  return ref && deskCanRead(ref) ? ref : null;
}

async function pickCard(item) {
  const options = pickerOptions(item);
  const choice = select({ label: 'Недавние карточки', value: '', options: [
    ['', options.length ? 'Выберите карточку' : 'Доступных карточек нет'],
    ...options.map(({ ref, title }) => [keyOf(ref), deskKind(ref.of)[0] + ' · ' + title]),
  ] });
  const address = textInput({ label: 'Или ссылка на открытую карточку' });
  return modal({
    title: 'Добавить карточку', okText: 'Добавить',
    body: h('div', { class: 'desk-task-form' }, field('Недавние карточки', choice), address.el),
    onOk: async () => {
      const value = address.value.trim();
      let ref;
      try { ref = value ? fromAddress(value) : options.find((option) => keyOf(option.ref) === choice.value)?.ref; }
      catch { throw new Error('Вставьте адрес карточки из этого приложения.'); }
      if (!ref) throw new Error('Выберите карточку или вставьте её адрес.');
      if (item.refs?.some((existing) => keyOf(existing) === keyOf(ref))) throw new Error('Эта карточка уже есть в задаче.');
      if (!(await loadDeskCard(ref)).href) throw new Error('Карточка недоступна.');
      return ref;
    },
  });
}

function taskGroup(title, control, content) {
  return h('section', { class: 'desk-task-group', 'aria-label': title },
    h('div', { class: 'desk-task-group-head' }, h('h3', null, title), control), content);
}

function taskActions(store) {
  return deskActions((action) => store.dispatch(action), null, () => store.state().lanes);
}

function relatedCards(item, store, ctx) {
  const list = h('ul', { class: 'desk-detail-list' });
  for (const ref of item.refs || []) {
    const info = h('span', { class: 'desk-detail-label' }, deskKind(ref.of)[0]);
    const unlink = iconButton({ icon: '×', size: 'S', label: 'Убрать ссылку', onClick: async () => {
      if (!await confirmDlg('Убрать ссылку?', 'Карточка исчезнет из этой задачи.', { okText: 'Убрать' })) return;
      store.dispatch({ type: 'ref-remove', key: keyOf(item), ref });
      toast('Ссылка убрана', { undo: () => {
        store.dispatch({ type: 'ref-add', key: keyOf(item), ref });
        void ctx.reload();
      }, notice: false });
      await ctx.reload();
    } });
    list.append(h('li', null, info, unlink));
    void loadDeskCard(ref).then((meta) => {
      info.replaceChildren(...(meta.href
        ? [h('small', null, deskKind(ref.of)[0]), link({ href: meta.href, label: meta.title })]
        : [h('small', null, 'Карточка недоступна')]));
      if (meta.title) unlink.setAttribute('aria-label', 'Убрать ссылку «' + meta.title + '»');
    });
  }
  const add = button({ label: '+ Карточка', size: 'S', onClick: async () => {
    const ref = await pickCard(item);
    if (!ref) return;
    store.dispatch({ type: 'ref-add', key: keyOf(item), ref });
    await ctx.reload();
  } });
  return taskGroup('Связанные карточки', add, list.childElementCount ? list : h('p', { class: 'muted small' }, 'Карточек пока нет'));
}

function fileList(item, store) {
  const body = h('div', null, busyBlock('Файлы'));
  const path = '/auth/me/desk/tasks/' + encodeURIComponent(item.id) + '/files';
  const progress = h('span', { class: 'muted small', role: 'status' });
  const upload = fileButton({ label: '+ Файл', multiple: true, onFiles: add });
  const toFile = (file) => path + '/' + encodeURIComponent(file.id);
  async function add(selected) {
    const input = upload.querySelector('input');
    input.disabled = true;
    upload.setAttribute('aria-disabled', 'true');
    try {
      await store.synced();
      for (const [index, file] of selected.entries()) {
        progress.textContent = 'Загрузка ' + (index + 1) + ' из ' + selected.length + '…';
        const data = new FormData();
        data.append('file', file);
        try { await api(path, { method: 'POST', body: data }); }
        catch (error) { toastError(error, 'прикрепить «' + file.name + '»'); }
      }
    } catch (error) { toastError(error); }
    finally {
      await reload();
      input.disabled = false;
      upload.removeAttribute('aria-disabled');
      progress.textContent = '';
    }
  }
  async function restore(file) {
    await api(toFile(file) + '/restore', { method: 'POST' });
    await reload();
  }
  async function remove(file) {
    if (!await confirmDlg('Убрать файл?', '«' + file.name + '». Его можно восстановить здесь же.', { okText: 'Убрать', danger: true })) return;
    await api(toFile(file), { method: 'DELETE' });
    await reload();
    toast('Файл убран', { undo: async () => { try { await restore(file); } catch (error) { toastError(error); } }, notice: false });
  }
  const run = (action) => async () => { try { await action(); } catch (error) { toastError(error); } };
  function rows(files, removed) {
    return h('ul', { class: 'desk-detail-list' }, files.map((file) => h('li', null,
      h('span', { class: 'desk-detail-label', title: file.name }, file.name,
        h('small', null, [Math.max(1, Math.ceil(file.size / 1024)) + ' КБ', date(file.uploadedAt)].filter(Boolean).join(' · '))),
      removed ? iconButton({ icon: '↶', size: 'S', label: 'Восстановить «' + file.name + '»', onClick: run(() => restore(file)) })
        : [iconButton({ icon: '↓', size: 'S', label: 'Скачать «' + file.name + '»', onClick: run(() => apiFile(toFile(file), { fallback: file.name })) }),
          iconButton({ icon: '×', size: 'S', label: 'Убрать «' + file.name + '»', onClick: run(() => remove(file)) })])));
  }
  async function reload() {
    try {
      await store.synced();
      const files = await api(path, { quiet: true });
      const active = files.filter((file) => !file.deletedAt);
      const removed = files.filter((file) => file.deletedAt);
      const open = body.querySelector('details')?.open;
      body.replaceChildren(active.length ? rows(active, false) : h('p', { class: 'muted small' }, 'Файлов пока нет'),
        ...(removed.length ? [section({ title: 'Удалённые файлы', count: removed.length, open: !!open, cls: 'desk-removed-files', body: rows(removed, true), plain: true })] : []));
    } catch (error) { body.replaceChildren(failBlock(error, reload, { text: 'Файлы не загрузились' })); }
  }
  void reload();
  return taskGroup('Файлы', [progress, upload], body);
}

export const deskTask = {
  id: 'desk',
  title: 'Личная задача',
  kind: 'Личная задача',
  popout: false,
  canEdit: () => !!session.realUser && !viewAsActive(session.realUser),
  async get(id) {
    if (!deskTask.canEdit()) throw new Error('Личный рабочий стол доступен из своего профиля.');
    const store = deskStorage();
    if (!store.state().ready) await store.load();
    if (store.state().error && !store.state().ready) throw store.state().error;
    const item = store.state().items.find((value) => value.of === 'personal' && value.id === id && !value.deletedAt);
    if (!item) throw new Error('Личная задача не найдена.');
    return item;
  },
  card: {
    heading: (item) => item.title,
    subheading: (item) => [
      item.due ? 'Срок ' + date(item.due) + ' · ' : '',
      isDeskDone(item) ? 'Завершена' : 'В работе',
    ],
    view: () => [],
    extra(item, ctx) {
      const store = deskStorage();
      return h('div', { class: 'desk-task-detail' }, relatedCards(item, store, ctx), fileList(item, store));
    },
    actionsInHead: true,
    actions(item) {
      const store = deskStorage();
      const actions = taskActions(store);
      const done = isDeskDone(item);
      const hasOpenTasks = item.tasks?.some((task) => !task.done);
      return [
        { label: done ? 'Вернуть на стол' : 'Завершить задачу', primary: !done, disabled: hasOpenTasks, title: hasOpenTasks ? 'Сначала завершите подзадачи' : undefined, run: async (_, ctx) => { actions.complete(item, !done); await ctx.reload(); } },
        { label: 'Изменить название и срок', more: true, run: async (_, ctx) => { if (await actions.create(item, item)) await ctx.reload(); } },
        { label: 'Удалить задачу', more: true, danger: true, run: async (_, ctx) => { if (await actions.trash(item)) await ctx.close(); } },
      ];
    },
    noHistory: true,
  },
};
