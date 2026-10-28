import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/busy.js';
import { toastError, toast } from '../ui/toast.js';
import { DESIGN_STATUS as STATUS } from '../ui/badges.js';

/*
 * «Проектирование» в карточке заказа (ПРЖ-5): по каждой позиции — задача «D-81 · В работе» (ссылка) или галочка «передать».
 * «Передать выбранные» / «Все без задач» → POST /design-tasks/from-order (повтор безопасен: у позиции с открытой задачей новая не создаётся).
 * Блок виден тем, у кого открыт раздел «Проектирование»; кнопки — тем, кто может править.
 */
export function orderDesign(order, lines) {
  if (!session.sees('design') || !lines.length) return null;
  const box = h('div', { class: 'so-sec' });
  const picked = new Set();

  async function load() {
    let tasks;
    try { tasks = (await api('/design-tasks', { query: { orderId: order.id, status: 'queue,work,done,paused', limit: 500, sort: '-seq' } })).items || []; }
    catch (e) { box.replaceChildren(h('div', { class: 'section-title' }, 'Проектирование'), failBlock(e, load)); return; }
    // на позицию — самая свежая задача; «открытая» — не завершённая
    const byLine = new Map();
    for (const t of tasks) if (t.incomeId && (!byLine.has(t.incomeId) || (byLine.get(t.incomeId).status === 'done' && t.status !== 'done'))) byLine.set(t.incomeId, t);
    const free = lines.filter((l) => { const t = byLine.get(String(l.id)); return !t || t.status === 'done'; });
    for (const id of [...picked]) if (!free.some((l) => String(l.id) === id)) picked.delete(id);
    const can = session.canEdit;
    const send = async (ids, btn) => {
      btn.disabled = true;
      try {
        const r = await api('/design-tasks/from-order', { method: 'POST', body: { orderId: order.id, ...(ids ? { lineIds: ids } : {}) } });
        toast(r.created ? `Передано в проектирование: ${r.created}${r.skipped ? ` (уже были: ${r.skipped})` : ''}` : 'Все выбранные позиции уже в проектировании');
        picked.clear();
        window.dispatchEvent(new CustomEvent('data-changed'));
        await load();
      } catch (e) { toastError(e, 'передать в проектирование'); btn.disabled = false; }
    };
    const rows = lines.map((l, i) => {
      const t = byLine.get(String(l.id));
      const cb = can && free.includes(l) ? h('input', { type: 'checkbox', 'aria-label': 'Передать позицию в проектирование', checked: picked.has(String(l.id)),
        onchange: (e) => { if (e.target.checked) picked.add(String(l.id)); else picked.delete(String(l.id)); paint(); } }) : h('span');
      return h('li', { class: 'spec-row' }, cb,
        h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: l.title }, `${l.seqNo ?? l.lineNo ?? i + 1}. ${l.title || "Без названия"}`)),
        t ? h('a', { href: '#design?open=' + t.id, title: 'Открыть задачу проектирования' }, `${t.code} · ${STATUS[t.status]?.label || t.status}`) : h('span', { class: 'muted' }, 'нет задачи'),
        h('span'));
    });
    const sendSel = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: (e) => send([...picked], e.currentTarget) }, 'Передать выбранные');
    const sendAll = h('button', { type: 'button', class: 'btn btn-sm', disabled: !free.length, onclick: (e) => send(null, e.currentTarget) }, free.length === lines.length ? 'Передать все позиции' : `Передать все без задач (${free.length})`);
    const pickHint = h('span', { class: 'muted' }, 'Отметьте позиции галочками');
    const paint = () => { sendSel.disabled = !picked.size; sendSel.title = picked.size ? '' : 'Отметьте позиции галочками'; pickHint.hidden = !!picked.size || !free.length; sendSel.textContent = picked.size ? `Передать выбранные (${picked.size})` : 'Передать выбранные'; };
    paint();
    box.replaceChildren(h('div', { class: 'section-title' }, `Проектирование (${byLine.size} из ${lines.length} поз.)`),
      h('ul', { class: 'spec-list' }, ...rows),
      h('a', { class: 'link-btn', href: '#design?o=' + order.id, title: 'Доска проектирования с этим заказом' }, 'Открыть в проектировании'),
      can ? h('div', { class: 'spec-acts' }, sendSel, pickHint, sendAll, free.length ? null : h('span', { class: 'muted' }, 'Все позиции уже переданы.')) : null);
  }
  box.replaceChildren(h('div', { class: 'section-title' }, 'Проектирование'), h('div', { class: 'skel', style: { width: '50%' } }));
  load();
  return box;
}
