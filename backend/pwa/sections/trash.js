import { api, canEditSection, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { canFollow } from '../core/route-access.js';
import { viewAsActive } from '../core/view-as.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { dateTime } from '../core/format.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { clamp, iconButton, table } from '../ui/kit/index.js';
import { modal } from '../ui/kit/dialog.js';
import { withConfirm } from '../ui/confirm-password.js';
import { requests } from './requests.js';
import { orders } from './orders.js';
import { salesorder as salesorders } from './salesorders.js';
import { stock } from './stock.js';
import { partners } from './partners.js';
import { products } from './products.js';
import { passports } from './passports.js';
import { offers } from './offers.js';
import { design } from './design.js';
import { work } from './work.js';


/** Корзина (CANON §2 «Удаление»): всё удалённое, «Восстановить». */
const SOURCES = [
  { id: 'requests', section: requests, title: 'Заявки', path: '/supply/requests' },
  { id: 'stock', section: stock, title: 'Позиции склада', path: '/stock/items' },
  { id: 'salesorders', section: salesorders, title: 'Заказы', path: '/salesorders' },
  { id: 'orders', section: orders, title: 'Позиции заказов', path: '/incomes' },
  { id: 'partners', section: partners, title: 'Контрагенты', path: '/partners' },
  { id: 'products', section: products, title: 'Изделия', path: '/showcase' },
  { id: 'passports', section: passports, title: 'Паспорта', path: '/passports' },
  { id: 'offers', section: offers, title: 'Коммерческие предложения', path: '/offers' },
  { id: 'design', section: design, title: 'Задачи проектирования', path: '/design-tasks' },
  { id: 'work', section: work, title: 'Задания в работе', path: '/work-tasks' },
];

const actorId = () => String(session.realUser?.id || session.realUser?._id || '');
const canWrite = (src) => session.sees(src.id) && canEditSection(src.section) && !viewAsActive(session.realUser);
const mayReturn = (src, row) => canWrite(src) && src.section.remove?.run && !src.section.remove.noTrash
  && !src.section.remove.blocked?.(row);

function restoredHref(src, id) {
  const route = { salesorder: 'salesorders', orders: 'salesorders', passports: 'docs' }[src.section.id] || src.id;
  const params = new URLSearchParams({ open: id });
  if (route !== src.section.id) params.set('of', src.section.id);
  if (route === 'docs') params.set('tab', 'archive');
  return '#' + route + '?' + params;
}

function confirmAction(title, text, { okText, danger, password } = {}, run) {
  if (password && session.role !== 'admin') return withConfirm(run, { text });
  const body = h('p', null, text);
  const answer = modal({ title, body, okText, danger });
  const dialog = body.closest('[role="dialog"]');
  dialog?.setAttribute('aria-label', title);
  dialog?.querySelector('.modal-foot button[type="button"]')?.focus();
  return answer.then((ok) => ok ? run() : null);
}

export function mountTrash() {
  const el = h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'Корзина')));
  const box = h('div', { class: 'results' });
  el.append(box);

  function load() {
    box.replaceChildren(...SOURCES.filter((s) => session.sees(s.id)).map((s) => block(s)));
  }

  function changed() {
    if (el.isConnected) load();
    window.dispatchEvent(new CustomEvent('data-changed'));
  }

  function restoredNotice(src, row, name, actor) {
    const href = restoredHref(src, row.id);
    const stillAllowed = () => actor === actorId() && canFollow(session, href);
    const actions = [];
    if (stillAllowed()) actions.push({ label: 'Открыть запись', run: () => { if (stillAllowed()) location.hash = href; } });
    if (mayReturn(src, row)) actions.push({ label: 'Вернуть в корзину', run: async () => {
      if (!stillAllowed() || !canWrite(src)) return;
      try {
        const fresh = await src.section.get(row.id);
        if (!stillAllowed() || !canWrite(src)) return;
        const remove = src.section.remove;
        if (!remove?.run || remove.noTrash) return;
        const blockReason = remove.blocked?.(fresh);
        if (blockReason) { toast(blockReason, { tone: 'warn', notice: false }); return; }
        const note = remove.text?.(fresh) || `Вернуть «${name}» в корзину?`;
        const result = await confirmAction('Вернуть в корзину?', note, { okText: 'Вернуть в корзину', danger: true, password: remove.password }, async () => {
          if (!stillAllowed() || !canWrite(src)) return null;
          await remove.run(fresh);
          return true;
        });
        if (result) { changed(); toast('В корзине', { sub: name, notice: false }); }
        else if (stillAllowed()) restoredNotice(src, row, name, actor);
      } catch (error) { toastError(error, 'вернуть запись в корзину'); }
    } });
    toast('Восстановлено', { sub: name, tone: 'success', actions, notice: false });
  }

  function restoreButton(src, row, name) {
    const remove = src.section.remove;
    if (!canWrite(src) || !remove?.restore) return null;
    const arrow = h('span', { 'aria-hidden': 'true' }, '↶');
    return iconButton({ icon: arrow, label: `Восстановить «${name}»`, title: 'Восстановить', size: 'S', onClick: async (event) => {
      const btn = event.currentTarget;
      if (btn.disabled) return;
      const actor = actorId();
      btn.disabled = true;
      try {
        const saved = await confirmAction('Восстановить запись?', `Восстановить «${name}»?`, { okText: 'Восстановить', password: remove.password }, () => (
          actor === actorId() && canWrite(src) ? remove.restore(row) : null
        ));
        if (saved && actor === actorId()) { changed(); restoredNotice(src, { ...row, ...saved }, name, actor); }
      } catch (error) { toastError(error, 'восстановить запись'); }
      finally { btn.disabled = false; if (btn.isConnected) btn.focus(); }
    } });
  }

  function block(src) {
    const holder = h('div', null, busyBlock('', { cls: 'muted' }));
    const panel = h('div', { class: 'panel' }, h('h3', null, src.title), holder);
    api(src.path, { query: { deleted: 1, sort: '-deletedAt', limit: 100 } }).then((r) => {
      const canRestore = canWrite(src) && src.section.remove?.restore;
      const columns = [{ label: 'Запись', wrap: true }, { label: 'Удалено', num: true, phoneHide: true }];
      if (canRestore) columns.push({ label: 'Действие', cls: 'k-col-act right' });
      holder.replaceChildren(table({ columns, label: src.title, empty: { title: 'Корзина пуста' }, rows: r.items.map((row) => {
        const v = src.section.searchRow(row);
        const name = v.title || 'Запись без названия';
        const cells = [h('div', null, clamp(name, { lines: 2 }), h('div', { class: 'muted small' }, v.sub)), dateTime(row.deletedAt)];
        if (canRestore) cells.push(restoreButton(src, row, name));
        return { cells };
      }) }));
    }).catch((e) => holder.replaceChildren(failBlock(e, load)));
    return panel;
  }

  load();
  return { el };
}
