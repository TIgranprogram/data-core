import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { plural } from '../core/format.js';
import { confirmDlg } from './dialog.js';
import { toastError } from './toast.js';

/**
 * Обсуждение задачи проектирования (правая панель): лента, вопрос менеджеру, ответ.
 * Сервер: GET/POST /design-tasks/:id/notes, PATCH/DELETE /design-notes/:id. Служебных кодов на экране нет.
 */
const two = (n) => String(n).padStart(2, '0');
/** «сегодня 14:05», «вчера 09:30», иначе «27.10.2026 14:05». */
export function noteTime(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 864e5);
  if (diff === 0) return 'сегодня ' + hm;
  if (diff === 1) return 'вчера ' + hm;
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${hm}`;
}

const noteClock = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : `${two(d.getHours())}:${two(d.getMinutes())}`; };
const dayKey = (v) => { const d = new Date(v); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
/** «Сегодня», «Вчера», иначе «27.10.2026». */
const dayLabel = (v) => { const t = noteTime(v); return t.startsWith('сегодня') ? 'Сегодня' : t.startsWith('вчера') ? 'Вчера' : t.slice(0, 10); };
/** Лишние пустые строки (импорт YouGile) схлопываются, остальное — как есть. */
const tidy = (t) => String(t || '').replace(/\n\s*\n+/g, '\n').trim();

/** Подпись открытых вопросов: «1 вопрос», «3 вопроса». */
export const questionsText = (n) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;

const PHOTO_ONLY = /^(\s*\[фото\]\s*)+$/i;
const isPhotoNote = (n) => n.kind !== 'question' && PHOTO_ONLY.test(n.text || '');

export function discussionBlock(row, ctx, openGallery) {
  let items = [];
  let replyTo = null;
  const list = h('div', { class: 'dn-list', role: 'log', 'aria-live': 'polite' });
  const flag = h('div', { class: 'dn-flag', hidden: true });
  const input = h('textarea', { class: 'dn-input', rows: 2, maxlength: 4000, placeholder: 'Напишите сообщение…', 'aria-label': 'Сообщение' });
  const ask = h('input', { type: 'checkbox', id: 'dn-ask-' + row.id });
  const replyBar = h('div', { class: 'dn-reply', hidden: true });
  const send = h('button', { type: 'button', class: 'btn btn-primary' }, 'Отправить');

  const open = () => items.filter((n) => n.kind === 'question' && n.needsAnswer);
  const sync = () => {
    row.openQuestions = open().length;
    row.notesCount = items.length;
    ctx.changed?.();
  };
  const setReply = (q) => {
    replyTo = q;
    replyBar.hidden = !q;
    replyBar.replaceChildren(...(q ? [h('span', null, 'Ответ на вопрос: ' + q.text.slice(0, 60)), h('button', { type: 'button', class: 'link-btn', onclick: () => setReply(null) }, 'Отмена')] : []));
    ask.parentElement.hidden = !!q;
    if (q) input.focus();
  };

  let openMenu = null;
  const item = (n, same) => {
    const mine = n.canEdit;
    const isQ = n.kind === 'question';
    const open = isQ && n.needsAnswer;
    const menu = mine ? h('div', { class: 'menu', role: 'menu', hidden: true }, h('button', { type: 'button', role: 'menuitem', class: 'danger', onclick: () => { menu.hidden = true; remove(n); } }, 'Удалить')) : null;
    const dots = mine ? h('button', { type: 'button', class: 'btn btn-ghost btn-icon dn-dots', title: 'Ещё', 'aria-label': 'Ещё действия с сообщением', onclick: (e) => { e.stopPropagation(); const was = menu.hidden; openMenu?.(); menu.hidden = !was; openMenu = was ? () => { menu.hidden = true; } : null; } }, '⋯') : null;
    return h('div', { class: 'dn-item' + (open ? ' dn-open' : '') + (same ? ' dn-same' : ''), id: 'dn-' + n.id },
      same ? h('span', { class: 'dn-gap' }) : h('span', { class: 'avatar sm', title: n.author.name, 'aria-label': n.author.name }, n.author.initials),
      h('div', { class: 'dn-bubble' },
        same && !isQ ? null : h('div', { class: 'dn-head' }, same ? null : h('b', null, n.author.name), h('span', { class: 'muted' }, noteClock(n.createdAt)),
          isQ ? h('span', { class: 'stk ' + (n.needsAnswer ? 'warn' : 'dim') }, n.needsAnswer ? 'Требует ответа' : 'Есть ответ') : null),
        h('div', { class: 'dn-text' }, tidy(n.text)),
        open ? h('div', { class: 'dn-acts' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => setReply(n) }, 'Ответить')) : null,
        dots ? h('div', { class: 'dn-menu' }, dots, menu) : null));
  };
  document.addEventListener('click', () => { openMenu?.(); openMenu = null; });

  /** Подряд идущие сообщения только с «[фото]» одного автора — одна строка «Имя добавил N фото · 12:40». */
  const photoLine = (grp) => {
    const cnt = grp.reduce((s, n) => s + ((n.text || '').match(/\[фото\]/gi) || []).length, 0);
    return h('button', { type: 'button', class: 'dn-photoline', title: 'Открыть фото', onclick: () => openGallery?.(grp[0]) }, `${grp[0].author.name} добавил ${cnt} фото · ${noteClock(grp[grp.length - 1].createdAt)}`);
  };
  const paint = () => {
    const out = [];
    let prev = null;
    for (let i = 0; i < items.length; i++) {
      const n = items[i];
      if (isPhotoNote(n)) {
        const grp = [n];
        while (i + 1 < items.length && isPhotoNote(items[i + 1]) && items[i + 1].author.name === n.author.name && dayKey(items[i + 1].createdAt) === dayKey(n.createdAt)) grp.push(items[++i]);
        const day = dayKey(n.createdAt);
        if (!prev || prev.day !== day) out.push(h('div', { class: 'dn-day' }, h('span', null, dayLabel(n.createdAt))));
        out.push(photoLine(grp)); prev = { day, author: null };
        continue;
      }
      const day = dayKey(n.createdAt);
      if (!prev || prev.day !== day) out.push(h('div', { class: 'dn-day' }, h('span', null, dayLabel(n.createdAt))));
      const same = prev && prev.day === day && prev.author === n.author.name && n.kind !== 'question';
      out.push(item(n, same));
      prev = { day, author: n.author.name };
    }
    list.replaceChildren(...(out.length ? out : [h('div', { class: 'db-hint' }, 'Пока нет сообщений. Напишите первое.')]));
    const q = open();
    flag.hidden = !q.length;
    flag.replaceChildren(...(q.length ? [h('b', null, 'Требует ответа: '), questionsText(q.length), ' ',
      h('button', { type: 'button', class: 'link-btn', onclick: () => document.getElementById('dn-' + q[0].id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 'Показать')] : []));
  };

  async function remove(n) {
    if (!(await confirmDlg('Удалить сообщение?', 'Сообщение пропадёт из обсуждения.', { okText: 'Удалить', danger: true }))) return;
    try { await api(`/design-notes/${n.id}`, { method: 'DELETE' }); await load(); } catch (e) { toastError(e, 'удалить сообщение'); }
  }

  async function load() {
    try { items = (await api(`/design-tasks/${row.id}/notes`)).items || []; } catch (e) { toastError(e, 'загрузить обсуждение'); }
    paint(); sync();
  }

  send.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) { toastError(new Error('Напишите текст сообщения.')); return; }
    send.disabled = true;
    try {
      const body = { text, ...(replyTo ? { replyTo: replyTo.id } : ask.checked ? { kind: 'question' } : {}) };
      await api(`/design-tasks/${row.id}/notes`, { method: 'POST', body });
      input.value = ''; ask.checked = false; setReply(null);
      await load();
    } catch (e) { toastError(e, 'отправить сообщение'); } finally { send.disabled = false; }
  });

  const me = session.name;
  const askLabel = h('label', { class: 'check dn-ask', for: 'dn-ask-' + row.id }, ask, h('span', null, 'Вопрос менеджеру'));
  const box = h('div', { class: 'dn-form' }, replyBar, input, h('div', { class: 'dn-row' }, askLabel, send));
  const el = h('details', { class: 'db-blk', open: true }, h('summary', null, 'Обсуждение'),
    h('div', { class: 'db-blk-body' }, flag, list, me ? box : null));
  load();
  return el;
}

/** Значок на карточке/в списке: число открытых вопросов менеджеру (нет — ничего). */
export const questionBadge = (t) => (t?.openQuestions > 0
  ? h('span', { class: 'stk warn dn-badge', title: 'Требует ответа: ' + questionsText(t.openQuestions), 'aria-label': 'Требует ответа: ' + questionsText(t.openQuestions) }, '? ' + t.openQuestions)
  : null);
