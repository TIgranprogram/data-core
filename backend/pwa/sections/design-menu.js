import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { enhanceSelect, modal, confirmDlg, toast, toastError, ORDER_PRIORITY, DESIGN_STATUS } from '../ui/kit/index.js';
import { askAssignee, changed, clean } from './design-data.js';

/** Пункты меню «⋯» на карточке доски «Проектирования» (kit.board cardMenu): исполнитель, срок, вопрос, фото, перенос, ссылка, удаление. */
export async function copyLink(url) {
  try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
  catch {
    // буфер недоступен (нет HTTPS/разрешения) — показать ссылку в окне, чтобы скопировать руками
    await modal({ title: 'Скопируйте ссылку', body: document.createTextNode('Выделите и скопируйте: ' + url), okText: 'Готово', onOk: async () => true });
  }
}
const askDue = async (t) => {
  const d = h('input', { type: 'date', 'aria-label': 'Срок', value: t.deadline && !t.deadlineFromOrder ? String(t.deadline).slice(0, 10) : '' });
  const p = h('select', { 'aria-label': 'Приоритет' }, h('option', { value: '' }, 'Как в заказе'), ...Object.entries(ORDER_PRIORITY).map(([v, x]) => h('option', { value: v }, x.label)));
  p.value = t.priorityFromOrder || !t.priority ? '' : t.priority;
  queueMicrotask(() => enhanceSelect(p));
  const v = await modal({ title: 'Срок и приоритет', okText: 'Сохранить',
    body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Срок'), d), h('p', { class: 'hint' }, 'Пусто — срок берётся из заказа.'), h('label', { class: 'field' }, h('span', null, 'Приоритет'), p)),
    onOk: () => ({ deadline: d.value, priority: p.value }) });
  if (!v) return false;
  await api(`/design-tasks/${t.id}`, { method: 'PATCH', body: v });
  toast('Сохранено');
  return true;
};
const askQuestion = async (t) => {
  const ta = h('textarea', { rows: 4, maxlength: 2000, 'aria-label': 'Вопрос менеджеру', placeholder: 'Например: уточните, сколько изделий нужно изготовить' });
  const text = await modal({ title: 'Вопрос менеджеру', okText: 'Отправить', body: h('label', { class: 'field' }, h('span', null, 'Текст вопроса'), ta),
    onOk: () => { const s = ta.value.trim(); if (!s) throw new Error('Впишите вопрос.'); return s; } });
  if (!text) return false;
  await api(`/design-tasks/${t.id}/notes`, { method: 'POST', body: { text, kind: 'question' } });
  toast('Вопрос отправлен');
  return true;
};
const pickPhoto = (t) => new Promise((resolve) => {
  const inp = h('input', { type: 'file', accept: 'image/*', hidden: true });
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; inp.remove();
    if (!f) return resolve(false);
    try {
      if (!/^image\//.test(f.type)) throw new Error('Это не картинка — нужны JPG, PNG, WEBP');
      const fd = new FormData(); fd.append('file', f, f.name);
      const ph = await api('/photos/upload', { method: 'POST', body: fd });
      await api(`/design-tasks/${t.id}/photos`, { method: 'POST', body: { photoId: String(ph._id || ph.id) } });
      toast('Фото добавлено'); resolve(true);
    } catch (e) { toastError(e, 'добавить фото'); resolve(false); }
  });
  document.body.append(inp); inp.click();
});
const trash = async (t, title) => {
  if (!(await confirmDlg('Удалить задачу?', `Задача ${t.code || ''} «${title}» уйдёт в корзину. Можно восстановить из корзины.`, { okText: 'Удалить', danger: true }))) return false;
  await api(`/design-tasks/${t.id}`, { method: 'DELETE' });
  toast('Задача удалена', { undo: async () => { await api(`/design-tasks/${t.id}/restore`, { method: 'POST' }); changed(); } });
  return true;
};

export function taskMenu(t, { people, moveTask }) {
  const can = session.canEdit;
  const title = clean(t.productName) || clean(t.title) || 'Без названия';
  const url = `${location.origin}${location.pathname}#design?open=${t.id}`;
  const SEP = { sep: true };
  return [
    can && { label: t.assignee ? 'Сменить исполнителя…' : 'Назначить исполнителя…', run: async () => { const who = await askAssignee(await people(), { okText: 'Назначить' }); if (!who) return false; await api(`/design-tasks/${t.id}`, { method: 'PATCH', body: { assigneeId: who } }); toast('Исполнитель назначен'); return true; } },
    can && { label: 'Изменить срок и приоритет…', run: () => askDue(t) },
    { label: 'Задать вопрос менеджеру…', run: () => askQuestion(t) },
    { label: 'Добавить фото…', run: () => pickPhoto(t) },
    SEP,
    t.orderId && { label: 'Открыть заказ', run: () => { go('design', { of: 'designorder', open: t.orderId }, { kind: 'card' }); return false; } },
    t.orderId && { label: 'Открыть в «Заказах»', run: () => { go('salesorders', { open: t.orderId }, { kind: 'card' }); return false; } },
    { label: 'Копировать ссылку', run: async () => { await copyLink(url); return false; } },
    can && SEP,
    ...(can ? Object.keys(DESIGN_STATUS).filter((k) => k !== t.status).map((k) => ({ label: 'Перенести: ' + DESIGN_STATUS[k].label, run: async () => !!(await moveTask(t, k)) })) : []),
    can && SEP,
    can && { label: 'Удалить в корзину', danger: true, run: () => trash(t, title) },
  ];
}
