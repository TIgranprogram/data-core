import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, qty } from '../core/format.js';
import { badge, DESIGN_STATUS, ORDER_PRIORITY } from '../ui/badges.js';
import { askAssignee, changed, COL_LABEL, createTask, distributeOrder, dropOrder, fetchBoardOrder, loadLines } from '../ui/design-board.js';
import { toastError } from '../ui/toast.js';
import { dueNode, moveTask, people } from './design.js';
import { STAGE } from './salesorders.js';

/**
 * Правая панель заказа на доске «Проектирование» (`?of=designorder&open=<id заказа>`, DESIGN §4 «Доска заказов»).
 * Открыто — «с чем работаем»: «Заказ», «Изделия к проектированию» (взять в работу / назначить прямо в строке), «Как идёт проектирование».
 * Свёрнуто — справочное: «Что в позициях». Цен нет. Блоки «Файлы и чертежи», «История» появятся, когда сервер отдаст данные.
 */
const block = (title, open, ...kids) => h('details', { class: 'db-blk', open: open || undefined }, h('summary', null, title), h('div', { class: 'db-blk-body' }, ...kids));
const field = (label, value) => (value === null || value === undefined || value === '' ? null : [h('dt', null, label), h('dd', null, value)]);
const today = () => isoDay();

function linesBlock(row, ctx) {
  const can = session.canEdit;
  const run = async (fn, what) => { try { await fn(); } catch (e) { toastError(e, what); } finally { changed(); ctx.reload(); } };
  const rows = row.lines.map((l) => {
    const t = l.task;
    const acts = [];
    if (can && !t) acts.push(h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => run(() => createTask(l, 'work', people), 'взять в работу') }, 'Взять в работу'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => run(() => createTask(l, 'queue', people), 'отправить на распределение') }, 'На распределение'));
    if (can && t && t.status !== 'done') {
      if (t.status === 'queue' || t.status === 'paused') acts.push(h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => run(() => moveTask(t, 'work'), 'взять в работу') }, t.status === 'paused' ? 'Возобновить' : 'Взять в работу'));
      acts.push(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => run(async () => {
        const who = await askAssignee(await people(), { okText: 'Назначить' });
        if (who) await api(`/design-tasks/${t.id}`, { method: 'PATCH', body: { assigneeId: who } });
      }, 'назначить исполнителя') }, t.assignee ? 'Сменить исполнителя' : 'Назначить'));
    }
    return h('li', { class: 'db-prow' },
      l.photo ? h('img', { class: 'db-pic sm', src: PREFIX + l.photo, alt: '', loading: 'lazy' }) : h('span', { class: 'db-pic sm none' }),
      h('div', { class: 'db-pmain' },
        h('div', { class: 't-title' }, ((l.seqNo ?? l.lineNo) != null ? `поз. ${l.seqNo ?? l.lineNo} · ` : '') + l.title),
        h('div', { class: 't-sub' }, [l.sku && '№ ' + l.sku, t?.assignee?.name].filter(Boolean).join(' · ')),
        h('div', { class: 'db-pstate' }, t ? [badge(DESIGN_STATUS, t.status), ' ', h('a', { href: '#design?open=' + t.id, title: 'Открыть изделие справа' }, 'Открыть')] : h('span', { class: 'muted' }, 'ещё не взято')),
        acts.length ? h('div', { class: 'db-pacts' }, acts) : null));
  });
  return block('Изделия к проектированию', true, rows.length ? h('ul', { class: 'db-plist' }, rows) : h('div', { class: 'db-hint' }, 'В заказе нет позиций.'));
}

function progressBlock(row) {
  const c = row.counts;
  const open = row.lines.map((l) => l.task).filter((t) => t && t.status !== 'done');
  const dues = open.map((t) => t.deadline && String(t.deadline).slice(0, 10)).filter(Boolean).sort();
  const over = dues.filter((d) => d < today()).length;
  const free = row.lines.filter((l) => !l.task).length;
  return block('Как идёт проектирование', true, h('dl', { class: 'fields' },
    ...['queue', 'work', 'paused', 'done', 'cancelled'].flatMap((k) => field(COL_LABEL[k], String(c[k] ?? 0))),
    ...(field('Ещё не взято', String(free)) || []),
    ...(field('Ближайший срок', dues[0] ? date(dues[0]) : open.length ? 'без срока' : '') || []),
    ...(field('Просрочено', over ? `${over} шт.` : open.length ? 'нет' : '') || [])));
}

export const designOrder = {
  id: 'designorder',
  title: 'Проектирование',
  get: async (id) => {
    const o = await fetchBoardOrder(id);
    if (!o) throw new Error('Заказ не найден на доске проектирования — возможно, его уже убрали.');
    return { ...o, id: o.orderId, lines: await loadLines(id, o) };
  },
  card: {
    heading: (r) => `${r.productionNo ? 'Заказ № ' + r.productionNo : 'Заказ, нет №'}${r.customer ? ' · ' + r.customer : ''}`,
    subheading: () => 'Заказ в проектировании',
    noHistory: true,
    actions: (r, ctx) => {
      const free = r.lines.some((l) => !l.task);
      return [
        free ? { label: 'На распределение все позиции', primary: true, run: async () => { await distributeOrder(r.orderId); changed(); ctx.reload(); } } : null,
        { label: 'Убрать из проектирования', run: async () => { if (await dropOrder(r)) { changed(); ctx.close(); } } },
      ].filter(Boolean);
    },
    view: (r) => [
      ['Заказ', h('a', { href: '#salesorders?open=' + r.orderId }, 'Открыть заказ')],
      ['Заказчик', r.customer],
      ['Срок', r.deadline ? dueNode({ deadline: r.deadline, status: 'queue' }) : 'без срока'],
      ['Приоритет', ORDER_PRIORITY[r.priority]?.label],
      ['Этап заказа', STAGE[r.stage]?.label || r.stage],
      ['Примечание', r.note],
    ],
    extra: (r, ctx) => h('div', { class: 'db-blocks' },
      linesBlock(r, ctx),
      progressBlock(r),
      block('Что в позициях', false, r.lines.length ? h('table', { class: 'db-ptable' }, h('thead', null, h('tr', null, ['Поз.', 'Название', 'Кол-во', 'Артикул'].map((x) => h('th', null, x)))),
        h('tbody', null, r.lines.map((l) => h('tr', null, h('td', null, l.seqNo ?? l.lineNo ?? ''), h('td', null, l.title), h('td', { class: 'num' }, l.qty != null ? qty(l.qty) : ''), h('td', null, l.sku || ''))))) : h('div', { class: 'db-hint' }, 'Позиций нет.'))),
  },
};
