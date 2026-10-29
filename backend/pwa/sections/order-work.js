import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/busy.js';
import { toast, toastError } from '../ui/toast.js';

/*
 * «В работе» в карточке заказа: по каждой позиции — карточка «W-12 · Сварка» (ссылка) или галочка «запустить».
 * «Запустить выбранные» / «Запустить все позиции» → POST /work-tasks/launch (повтор безопасен: у запущенной позиции новой карточки нет).
 * Отказы (`refused`) и предупреждения (`warnings`) показываются словами под кнопками и тостом.
 * Блок виден тем, у кого открыт раздел «В работе»; кнопки — тем, кто может править.
 */
const lineName = (l, i) => `${l.seqNo ?? l.lineNo ?? i + 1}. ${l.title || 'Без названия'}`;

/** Итог запуска словами: что запущено, что не запущено и почему, на что обратить внимание. */
export function launchResult(res, titleOf) {
  const nameOf = (x) => titleOf(x.incomeId) || (x.lineNo != null ? 'Позиция ' + x.lineNo : 'Позиция');
  const refused = res.refused || [], warnings = res.warnings || [];
  return h('div', { class: 'wk-launch' },
    h('p', { class: 'wk-launch-head' }, res.created ? `Запущено в работу: ${res.created}.` : 'Ничего не запущено.'),
    refused.length ? h('ul', { class: 'wk-launch-list wk-bad' }, ...refused.map((x) => h('li', null, h('b', null, nameOf(x) + ': '), x.reason))) : null,
    warnings.length ? h('ul', { class: 'wk-launch-list wk-warn' }, ...warnings.map((x) => h('li', null, h('b', null, nameOf(x) + ': '), x.text))) : null);
}

/** orders — договоры заказа: [{ id, orderNo, lines:[{ id, title, seqNo, lineNo }] }]. */
export function orderWork(orders) {
  if (!session.sees('work')) return null;
  const all = (orders || []).filter((o) => o.stage !== 'cancelled').flatMap((o) => (o.lines || []).map((l) => ({ ...l, _order: o })));
  if (!all.length) return null;
  const many = (orders || []).length > 1;
  const box = h('div', { class: 'so-sec wk-order' });
  const picked = new Set();
  const titleOf = (id) => { const i = all.findIndex((l) => String(l.id) === String(id)); return i < 0 ? '' : lineName(all[i], i); };

  async function load(result) {
    let tasks;
    try {
      const ids = [...new Set(all.map((l) => l._order.id))].join(',');
      tasks = (await api('/work-tasks', { query: { orderId: ids, status: 'waiting,work,done', limit: 500, sort: '-seq' } })).items || [];
    } catch (e) { box.replaceChildren(h('div', { class: 'section-title' }, 'В работе'), failBlock(e, () => load())); return; }
    const byLine = new Map();
    for (const t of tasks) if (t.incomeId && !byLine.has(t.incomeId)) byLine.set(t.incomeId, t);
    const free = all.filter((l) => !byLine.has(String(l.id)));
    for (const id of [...picked]) if (!free.some((l) => String(l.id) === id)) picked.delete(id);
    const can = session.canEdit;
    const send = async (lineIds, btn) => {
      btn.disabled = true; btn.classList.add('is-busy');
      try {
        // запуск — только по ещё не запущенным позициям (иначе уже запущенные попадают в «не запущено»)
        const parts = [{ lineIds }];
        const sum = { created: 0, refused: [], warnings: [] };
        for (const body of parts) {
          const r = await api('/work-tasks/launch', { method: 'POST', body });
          sum.created += r.created || 0; sum.refused.push(...(r.refused || [])); sum.warnings.push(...(r.warnings || []));
        }
        const skip = sum.refused.length;
        toast(sum.created ? `Запущено в работу: ${sum.created}${skip ? `, не запущено: ${skip}` : ''}` : skip ? `Не запущено: ${skip} — причины ниже` : 'Нечего запускать',
          { sub: sum.warnings.length ? `Предупреждений: ${sum.warnings.length}` : undefined });
        picked.clear();
        window.dispatchEvent(new CustomEvent('data-changed'));
        await load(sum);
      } catch (e) { toastError(e, 'запустить в работу'); btn.disabled = false; btn.classList.remove('is-busy'); }
    };
    const rows = all.map((l, i) => {
      const t = byLine.get(String(l.id));
      const cb = can && !t ? h('input', { type: 'checkbox', 'aria-label': 'Запустить позицию в работу', checked: picked.has(String(l.id)),
        onchange: (e) => { if (e.target.checked) picked.add(String(l.id)); else picked.delete(String(l.id)); paint(); } }) : h('span');
      const st = t ? (t.status === 'done' ? 'готово' : t.status === 'waiting' ? 'ждёт запуска' : t.currentStep || 'в работе') : '';
      return h('li', { class: 'spec-row' }, cb,
        h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: l.title }, (many ? `Договор ${l._order.orderNo || '—'} · ` : '') + lineName(l, i))),
        t ? h('a', { href: '#work?open=' + t.id, title: 'Открыть карточку в работе' }, `${t.code} · ${st}`) : h('span', { class: 'muted' }, 'не запущена'),
        h('span'));
    });
    const sendSel = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: (e) => send([...picked], e.currentTarget) }, 'Запустить выбранные');
    const sendAll = h('button', { type: 'button', class: 'btn btn-sm', disabled: !free.length, onclick: (e) => send(free.map((l) => String(l.id)), e.currentTarget) }, free.length === all.length ? 'Запустить в работу все позиции' : `Запустить все не запущенные (${free.length})`);
    const pickHint = h('span', { class: 'muted' }, 'Отметьте позиции галочками');
    const paint = () => { sendSel.disabled = !picked.size; pickHint.hidden = !!picked.size || !free.length; sendSel.textContent = picked.size ? `Запустить выбранные (${picked.size})` : 'Запустить выбранные'; };
    paint();
    box.replaceChildren(h('div', { class: 'section-title' }, `В работе (${byLine.size} из ${all.length} поз.)`),
      h('ul', { class: 'spec-list' }, ...rows),
      result ? launchResult(result, titleOf) : null,
      h('a', { class: 'link-btn', href: '#work?orderId=' + all[0]._order.id, title: 'Доска «В работе» с этим заказом' }, 'Открыть в «В работе»'),
      can ? h('div', { class: 'spec-acts' }, sendSel, pickHint, sendAll, free.length ? null : h('span', { class: 'muted' }, 'Все позиции уже запущены.')) : null);
  }
  box.replaceChildren(h('div', { class: 'section-title' }, 'В работе'), h('div', { class: 'skel', style: { width: '50%' } }));
  load();
  return box;
}
