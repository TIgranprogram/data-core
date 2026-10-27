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

/** Подпись открытых вопросов: «1 вопрос», «3 вопроса». */
export const questionsText = (n) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;

export function discussionBlock(row, ctx) {
  let items = [];
  let replyTo = null;
  const list = h('div', { class: 'dn-list' });
  const flag = h('div', { class: 'dn-flag', hidden: true });
  const input = h('textarea', { class: 'dn-input', rows: 2, maxlength: 4000, placeholder: 'Напишите сообщение…', 'aria-label': 'Сообщение' });
  const ask = h('input', { type: 'checkbox' });
  const replyBar = h('div', { class: 'dn-reply', hidden: true });
  const send = h('button', { type: 'button', class: 'btn primary' }, 'Отправить');

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

  const item = (n) => {
    const mine = n.canEdit;
    const isQ = n.kind === 'question';
    return h('div', { class: 'dn-item' + (isQ && n.needsAnswer ? ' dn-open' : ''), id: 'dn-' + n.id },
      h('span', { class: 'avatar sm', title: n.author.name }, n.author.initials),
      h('div', { class: 'dn-body' },
        h('div', { class: 'dn-head' }, h('b', null, n.author.name), h('span', { class: 'muted' }, noteTime(n.createdAt)),
          isQ ? h('span', { class: 'stk ' + (n.needsAnswer ? 'warn' : 'dim') }, n.needsAnswer ? 'Требует ответа' : 'Есть ответ') : null),
        h('div', { class: 'dn-text' }, n.text),
        h('div', { class: 'dn-acts' },
          isQ && n.needsAnswer ? h('button', { type: 'button', class: 'link-btn', onclick: () => setReply(n) }, 'Ответить') : null,
          mine ? h('button', { type: 'button', class: 'link-btn', onclick: () => remove(n) }, 'Удалить') : null)));
  };

  const paint = () => {
    list.replaceChildren(...(items.length ? items.map(item) : [h('div', { class: 'db-hint' }, 'Пока нет сообщений. Напишите первое.')]));
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
  const askLabel = h('label', { class: 'dn-ask' }, ask, ' Вопрос менеджеру');
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
