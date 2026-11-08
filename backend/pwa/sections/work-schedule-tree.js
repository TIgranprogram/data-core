import { NONE, day, partOf, round } from './work-schedule-shared.js';

/*
 * Модель дерева Ганта: полосы сервера → строки planner (parentId) и полосы.
 *   «По заказам»: заказ › позиция › часть › шаг;  «По людям»: человек › позиция › шаг.
 * Лист — шаг (одна полоса); узлы показывают сводную полосу. Перенести можно только лист; в «По людям» бросок на человека/позицию = другой исполнитель.
 * → { rows, bars, nodeIds }
 */
const count = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'шаг' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'шага' : 'шагов'}`;
const posLabel = (b) => b.productName || b.title || 'Позиция';

export function buildModel({ bars: raw, people, lens }) {
  const bars = raw.slice().sort((a, b) => String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'ru', { numeric: true }) || String(a.start).localeCompare(String(b.start)));
  const rows = [], seen = new Map(), nodeIds = new Set();
  const stepsOf = new Map();
  const node = (row) => { if (!seen.has(row.id)) { seen.set(row.id, row); rows.push(row); nodeIds.add(row.id); } return seen.get(row.id); };
  const bump = (id) => stepsOf.set(id, (stepsOf.get(id) || 0) + 1);
  const peopleBy = new Map(people.map((x) => [String(x.id), x]));
  const who = (b) => (b.assigneeId ? peopleBy.get(String(b.assigneeId))?.name || 'Исполнитель' : 'Без исполнителя');

  if (lens === 'people') {
    const list = people.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    const noOne = bars.some((b) => !b.assigneeId);
    if (noOne) node({ id: NONE, label: 'Без исполнителя' });
    for (const x of list) node({ id: String(x.id), label: x.name, cap: Number(x.capacityHours) || 0, sub: x.capacityHours ? round(x.capacityHours) + ' ч в день' : '' });
  }

  const view = [];
  for (const b of bars) {
    const sid = 's:' + b.stepId;
    const leaf = { id: sid, label: b.workTypeName || 'работа', sub: lens === 'orders' ? who(b) : '', drop: null };
    let parents;
    if (lens === 'orders') {
      const o = node({ id: 'o:' + (b.orderNo || '—'), label: 'Заказ № ' + (b.orderNo || '—') });
      const p = node({ id: 'i:' + b.incomeId, parentId: o.id, label: posLabel(b) });
      const q = node({ id: 'p:' + b.incomeId + ':' + (b.partRowId || '_'), parentId: p.id, label: partOf(b), drop: null });
      parents = [o, p, q];
      leaf.parentId = q.id;
    } else {
      const owner = b.assigneeId ? String(b.assigneeId) : NONE;
      if (!seen.has(owner)) node({ id: owner, label: who(b) });
      const p = node({ id: 'pi:' + owner + ':' + b.incomeId, parentId: owner, label: posLabel(b), sub: b.orderNo ? '№ ' + b.orderNo : '', drop: owner });
      parents = [seen.get(owner), p];
      leaf.parentId = p.id;
    }
    rows.push(leaf);
    for (const n of parents) bump(n.id);
    const sub = b.locked ? 'задание без плана' : [`${round(b.hours)} ч`, b.inDesign ? 'в проектировании' : ''].filter(Boolean).join(' · ');
    view.push({
      id: String(b.stepId), taskId: b.taskId || null, locked: !!b.locked, rowId: sid, ownerId: lens === 'people' ? (b.assigneeId ? String(b.assigneeId) : NONE) : sid,
      start: day(b.start), end: day(b.end), title: b.workTypeName || 'работа', sub,
      hue: b.hue || null, wt: b.workTypeId ? String(b.workTypeId) : null, status: b.status, overdue: !!b.overdue, deadline: b.deadline || null,
      tone: b.status === 'done' ? 'ok' : !b.assigneeId && lens === 'people' ? 'warn' : 'info',
      hint: [`Заказ № ${b.orderNo || '—'}`, posLabel(b), partOf(b), who(b), b.inDesign ? 'в проектировании' : ''].filter(Boolean).join(' · '),
    });
  }
  for (const r of rows) if (stepsOf.has(r.id) && !r.sub) r.sub = count(stepsOf.get(r.id));
  const withKids = new Set(rows.map((r) => r.parentId));
  return { rows, bars: view, nodeIds: [...nodeIds].filter((id) => withKids.has(id)) };
}
