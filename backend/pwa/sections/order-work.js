import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/kit/busy.js';
import { link, openSide, button, section } from '../ui/kit/index.js';
import { openLaunch } from './work-launch.js';

/*
 * «В работе» в карточке заказа: по каждой позиции — карточка «W-12 · Сварка» (ссылка) или галочка «запустить».
 * «Запустить выбранные» / «Запустить все позиции» → POST /work-tasks/launch (повтор безопасен: у запущенной позиции новой карточки нет).
 * Отказы (`refused`) и предупреждения (`warnings`) показываются словами под кнопками и тостом.
 * Блок виден тем, у кого открыт раздел «В работе»; кнопки — тем, кто может править.
 */
/** Секция блока: раскрытость переживает перерисовку. */
const wrap = (box, title, count, body) => section({ title, count, tone: 'main', open: box.querySelector('details.k-sec')?.open || false, body });
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
    } catch (e) { box.replaceChildren(wrap(box, 'В работе', null, failBlock(e, () => load()))); return; }
    const byLine = new Map();
    for (const t of tasks) if (t.incomeId && !byLine.has(t.incomeId)) byLine.set(t.incomeId, t);
    const free = all.filter((l) => !byLine.has(String(l.id)));
    for (const id of [...picked]) if (!free.some((l) => String(l.id) === id)) picked.delete(id);
    const can = session.canEdit;
    // запуск — через панель «Запуск в работу»: там видно и выбирается, как делается каждая позиция
    const send = (lineIds) => openLaunch(all.filter((l) => lineIds.includes(String(l.id))).map((l) => ({ id: String(l.id), name: titleOf(l.id), productId: l.productId || l.product?.id || null })),
      (res) => { picked.clear(); if (box.isConnected) load({ created: res.created || 0, refused: res.refused || [], warnings: res.warnings || [] }); }, openSide);
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
    const sendSel = button({ label: 'Запустить выбранные', kind: 'primary', size: 'S', onClick: (e) => send([...picked], e.currentTarget) });
    const sendAll = button({ label: free.length === all.length ? 'Запустить в работу все позиции' : `Запустить все не запущенные (${free.length})`, size: 'S', disabled: !free.length, onClick: (e) => send(free.map((l) => String(l.id)), e.currentTarget) });
    const pickHint = h('span', { class: 'muted' }, 'Отметьте позиции галочками');
    const paint = () => { sendSel.disabled = !picked.size; pickHint.hidden = !!picked.size || !free.length; sendSel.textContent = picked.size ? `Запустить выбранные (${picked.size})` : 'Запустить выбранные'; };
    paint();
    box.replaceChildren(wrap(box, 'В работе', `${byLine.size} из ${all.length}`, [
      h('ul', { class: 'spec-list' }, ...rows),
      result ? launchResult(result, titleOf) : null,
      link({ href: '#work?orderId=' + all[0]._order.id, title: 'Доска «В работе» с этим заказом', label: 'Открыть в «В работе»' }),
      can ? h('div', { class: 'spec-acts' }, sendSel, pickHint, sendAll, free.length ? null : h('span', { class: 'muted' }, 'Все позиции уже запущены.')) : null]));
  }
  box.replaceChildren(wrap(box, 'В работе', null, h('p', { class: 'muted small' }, 'Загружаю…')));
  load();
  return box;
}
