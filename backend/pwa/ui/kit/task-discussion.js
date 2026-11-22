import { h } from '../../core/dom.js';
import { plural } from '../../core/format.js';
import { actions, busyBlock, button, confirmDlg, failBlock, hint, photoStrip, section, stack, toastError, uploadPhoto } from './index.js';
import { openPopMenu } from './pop-menu.js';

const two = (n) => String(n).padStart(2, '0');
const photoLimit = 5;
const dayKey = (v) => { const d = new Date(v); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const noteClock = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : `${two(d.getHours())}:${two(d.getMinutes())}`; };

/** «сегодня 14:05», «вчера 09:30», иначе «27.10.2026 14:05». */
function noteTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 864e5);
  const hm = noteClock(v);
  if (diff === 0) return 'сегодня ' + hm;
  if (diff === 1) return 'вчера ' + hm;
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${hm}`;
}

const dayLabel = (v) => { const t = noteTime(v); return t.startsWith('сегодня') ? 'Сегодня' : t.startsWith('вчера') ? 'Вчера' : t.slice(0, 10); };
const tidy = (t) => String(t || '').replace(/\n\s*\n+/g, '\n').trim();
const questionsText = (n) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;

export function taskDiscussion({ open, count, canWrite, canAttach, loadNotes, create, remove, onChange }) {
  let items = [];
  let replyTo = null;
  let sending = false;
  const draft = [];
  const list = h('div', { class: 'dn-list', role: 'log', 'aria-live': 'polite' });
  const flag = h('div', { class: 'dn-flag', hidden: true });
  const input = h('textarea', { class: 'dn-input', rows: 2, maxlength: 4000, placeholder: 'Напишите сообщение…', 'aria-label': 'Сообщение' });
  const files = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const attached = stack();
  const replyBar = h('div', { class: 'dn-reply', hidden: true });
  const attach = canAttach && button({ label: 'Прикрепить фото', size: 'S', onClick: () => files.click() });
  const send = button({ label: 'Отправить', kind: 'primary', onClick: sendMessage });

  function setReply(note) {
    replyTo = note;
    replyBar.hidden = !note;
    replyBar.replaceChildren(note ? 'Ответ на вопрос: ' + note.text.slice(0, 60) : null,
      note ? button({ label: 'Отмена', kind: 'ghost', size: 'S', onClick: () => setReply(null) }) : null);
    if (note) input.focus();
  }

  function renderDraft() {
    attached.hidden = !draft.length;
    attached.replaceChildren(...draft.map((pic, i) => actions(
      h('span', null, pic.file.name || `Фото ${i + 1}`),
      button({ label: 'Убрать', size: 'S', kind: 'ghost', title: `Убрать ${pic.file.name || 'фото'}`, disabled: sending,
        onClick: () => { draft.splice(i, 1); renderDraft(); } }))));
    if (attach) attach.disabled = sending || draft.length >= photoLimit;
  }

  function addFiles(selected) {
    if (sending) return;
    const images = [...selected].filter((file) => /^image\//.test(file.type));
    if (!images.length) { toastError(new Error('Выберите файл изображения.')); return; }
    const left = photoLimit - draft.length;
    if (images.length > left) toastError(new Error(`К сообщению можно прикрепить до ${photoLimit} фото.`));
    draft.push(...images.slice(0, left).map((file) => ({ file })));
    renderDraft();
  }

  const box = h('div', { class: 'dn-form' }, replyBar, input, attached, files,
    h('div', { class: 'dn-row' }, attach || h('span'), send));
  if (canAttach) {
    files.addEventListener('change', () => { if (files.files.length) addFiles(files.files); files.value = ''; });
    box.addEventListener('paste', (event) => {
      const pasted = [...(event.clipboardData?.files || [])].filter((file) => /^image\//.test(file.type));
      if (!pasted.length) return;
      event.preventDefault(); event.stopPropagation(); addFiles(pasted);
    });
  }
  renderDraft();

  function item(n, same) {
    const question = n.kind === 'question';
    const waiting = question && n.needsAnswer;
    const more = canWrite && n.canEdit ? h('button', {
      type: 'button', class: 'btn btn-ghost btn-icon dn-dots', 'aria-label': 'Ещё действия с сообщением', 'aria-haspopup': 'menu',
      onclick: (e) => openPopMenu({ anchor: e.currentTarget, side: 'down', groups: [{ items: [{ label: 'Удалить', danger: true, onSelect: () => removeNote(n) }] }] }),
    }, '⋯') : null;
    return h('div', { class: 'dn-item' + (waiting ? ' dn-open' : ''), id: 'dn-' + n.id },
      same ? h('span', { class: 'dn-gap' }) : h('span', { class: 'avatar sm', title: n.author.name, 'aria-hidden': 'true' }, n.author.initials),
      h('div', { class: 'dn-bubble' },
        h('div', { class: 'dn-head' }, same ? null : h('b', null, n.author.name), h('span', { class: 'muted' }, noteClock(n.createdAt)),
          question ? h('span', { class: 'stk ' + (waiting ? 'warn' : 'dim') }, waiting ? 'Без ответа' : 'Есть ответ') : null),
        n.text ? h('div', { class: 'dn-text' }, tidy(n.text)) : null,
        photoStrip(n.photos || []),
        waiting && canWrite ? h('div', { class: 'dn-acts' }, button({ label: 'Ответить', kind: 'ghost', size: 'S', onClick: () => setReply(n) })) : null,
        more ? h('div', { class: 'dn-menu' }, more) : null));
  }

  function paint() {
    const out = [];
    let prevDay = null;
    let prevAuthor = null;
    for (const n of items) {
      const day = dayKey(n.createdAt);
      const author = n.author.id || n.author.name;
      if (day !== prevDay && n.createdAt) out.push(h('div', { class: 'dn-day' }, h('span', null, dayLabel(n.createdAt))));
      out.push(item(n, day === prevDay && author === prevAuthor && n.kind !== 'question'));
      prevDay = day;
      prevAuthor = author;
    }
    list.replaceChildren(...(out.length ? out : [hint('Пока нет сообщений.')]));
    summaryCount.hidden = !items.length;
    summaryCount.textContent = items.length || '';
    const questions = items.filter((n) => n.kind === 'question' && n.needsAnswer);
    flag.hidden = !questions.length;
    flag.replaceChildren(...(questions.length ? [h('b', null, 'Без ответа: '), questionsText(questions.length), ' ',
      button({ label: 'К вопросу', kind: 'ghost', size: 'S', onClick: () => document.getElementById('dn-' + questions[0].id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) })] : []));
  }

  async function load(fresh = false) {
    if (!items.length) list.replaceChildren(busyBlock('обсуждение'));
    try {
      items = await loadNotes(fresh);
      paint();
      if (fresh) onChange?.(items);
    } catch (e) { list.replaceChildren(failBlock(e, () => load(fresh))); }
  }

  async function removeNote(note) {
    if (!(await confirmDlg('Удалить сообщение?', 'Сообщение пропадёт из обсуждения.', { okText: 'Удалить', danger: true }))) return;
    try { await remove(note.id); await load(true); } catch (e) { toastError(e, 'удалить сообщение'); }
  }

  async function sendMessage() {
    if (sending) return;
    const text = input.value.trim();
    if (!text && !draft.length) { toastError(new Error('Напишите сообщение или прикрепите фото.')); input.focus(); return; }
    sending = true;
    input.readOnly = true;
    renderDraft();
    try {
      for (const pic of draft) if (!pic.id) pic.id = (await uploadPhoto(pic.file)).id;
      await create({ text, ...(draft.length ? { photoIds: draft.map((pic) => pic.id) } : {}), ...(replyTo ? { replyTo: replyTo.id } : {}) });
      input.value = '';
      draft.length = 0;
      setReply(null);
      await load(true);
    } catch (e) { toastError(e, 'отправить сообщение'); }
    finally { sending = false; input.readOnly = false; renderDraft(); }
  }

  const el = section({ title: 'Обсуждение', count: count || 0, tone: 'who', open, body: [flag, list, canWrite ? box : null] });
  const summaryCount = el.querySelector('.k-sec-n');
  summaryCount.hidden = !count;
  let loaded = open;
  if (open) void load();
  el.addEventListener('toggle', () => {
    if (el.open && !loaded) { loaded = true; void load(); }
  });
  return el;
}
