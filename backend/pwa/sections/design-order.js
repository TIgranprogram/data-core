import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, qty } from '../core/format.js';
import { badge, DESIGN_STATUS, ORDER_PRIORITY } from '../ui/kit/badges.js';
import { posPic } from '../ui/kit/pos-pic.js';
import { askAssignee, changed, COL_LABEL, createTask, distributeOrder, dropOrder, fetchBoardOrder, loadLines } from './design-data.js';
import { toastError } from '../ui/kit/toast.js';
import { dueNode, moveTask, people } from './design.js';
import { STAGE } from './salesorders.js';

import { sku as kitSku, button, section, stack, row as kitRow, actions as kitActions } from '../ui/kit/index.js';
import { go } from '../core/router.js';
/**
 * Правая панель заказа на доске «Проектирование» (`?of=designorder&open=<id заказа>`, DESIGN §4 «Доска заказов»).
 * Открыто — «с чем работаем»: «Заказ», «Изделия к проектированию» (взять в работу / назначить прямо в строке), «Как идёт проектирование».
 * Свёрнуто — справочное: «Что в позициях». Цен нет. Блоки «Файлы и чертежи», «История» появятся, когда сервер отдаст данные.
 */
const block = (title, open, count, ...kids) => section({ title, tone: 'main', count, open, body: kids });
const field = (label, value) => (value === null || value === undefined || value === '' ? null : [h('dt', null, label), h('dd', null, value)]);
const today = () => isoDay();

function linesBlock(row, ctx) {
  const can = session.canEdit;
  const run = async (fn, what) => { try { await fn(); } catch (e) { toastError(e, what); } finally { changed(); ctx.reload(); } };
  const rows = row.lines.map((l) => {
    const t = l.task;
    const acts = [];
    if (can && !t) acts.push(button({ label: 'Взять в работу', kind: 'primary', size: 'S', onClick: () => run(() => createTask(l, 'work', people), 'взять в работу') }),
      button({ label: 'На распределение', size: 'S', onClick: () => run(() => createTask(l, 'queue', people), 'отправить на распределение') }));
    if (can && t && t.status !== 'done') {
      if (t.status === 'queue' || t.status === 'paused') acts.push(button({ label: t.status === 'paused' ? 'Возобновить' : 'Взять в работу', kind: 'primary', size: 'S', onClick: () => run(() => moveTask(t, 'work'), 'взять в работу') }));
      acts.push(button({ label: t.assignee ? 'Сменить исполнителя' : 'Назначить', size: 'S', onClick: () => run(async () => {
        const who = await askAssignee(await people(), { okText: 'Назначить' });
        if (who) await api(`/design-tasks/${t.id}`, { method: 'PATCH', body: { assigneeId: who } });
      }, 'назначить исполнителя') }));
    }
    // C030: строка — эталон kit row: вся строка открывает изделие справа (если оно в работе), кнопки — внизу и карточку не открывают
    return kitRow({
      lead: posPic(l.photo ? { url: l.photo, thumb: l.photo } : null, 'sm'),
      title: lineTitle(l), wrap: true,
      meta: [kitSku(l.sku), l.sku ? ' · ' : null, [l.qty != null && `${qty(l.qty)} ${l.unit || ''}`.trim(), t?.assignee?.name].filter(Boolean).join(' · ')],
      side: t ? badge(DESIGN_STATUS, t.status) : badge('Ещё не взято', 'dim'),
      below: acts.length ? kitActions(...acts) : null,
      onClick: t ? () => go('design', { open: t.id }) : undefined,
    });
  });
  return block('Изделия к проектированию', true, rows.length, rows.length ? stack(...rows) : h('div', { class: 'db-hint' }, 'В заказе нет позиций.'));
}

const lineTitle = (l) => ((l.seqNo ?? l.lineNo) != null ? `поз. ${l.seqNo ?? l.lineNo} · ` : '') + l.title;

function progressBlock(row) {
  const c = row.counts;
  const open = row.lines.map((l) => l.task).filter((t) => t && t.status !== 'done');
  const dues = open.map((t) => t.deadline && String(t.deadline).slice(0, 10)).filter(Boolean).sort();
  const over = dues.filter((d) => d < today()).length;
  const free = row.lines.filter((l) => !l.task).length;
  return block('Как идёт проектирование', true, undefined, h('dl', { class: 'fields' },
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
    extra: (r, ctx) => stack(
      linesBlock(r, ctx),
      progressBlock(r)), // позиции — один раз, в «Изделия к проектированию» (C052)
  },
};
