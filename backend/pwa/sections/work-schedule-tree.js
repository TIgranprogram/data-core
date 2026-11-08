import { NONE, day, partOf, round } from './work-schedule-shared.js';

/*
 * Модель дерева Ганта: полосы сервера → строки planner (parentId) и полосы.
 *   «По заказам»: заказ › позиция (› часть, если частей больше одной);  «По людям»: человек › позиция. Шаги — полосами в строке позиции.
 * Лист — позиция (или часть) со всеми шагами; узлы показывают сводную полосу. Перенести можно только лист; в «По людям» бросок на человека/позицию = другой исполнитель.
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

  // части позиции: уровень «часть» нужен, только если у позиции больше одной части (иначе «Изделие целиком» — лишний этаж)
  const partsOf = new Map();
  for (const b of bars) { const k = String(b.incomeId); (partsOf.get(k) || partsOf.set(k, new Set()).get(k)).add(b.partRowId || '_'); }
  const view = [];
  for (const b of bars) {
    let rowId, parents;
    if (lens === 'orders') {
      const o = node({ id: 'o:' + (b.orderNo || '—'), label: 'Заказ № ' + (b.orderNo || '—') });
      const multi = (partsOf.get(String(b.incomeId))?.size || 0) > 1;
      const p = node({ id: 'i:' + b.incomeId, parentId: o.id, label: posLabel(b), drop: null });
      parents = [o, p];
      rowId = p.id;
      if (multi) { const q = node({ id: 'p:' + b.incomeId + ':' + (b.partRowId || '_'), parentId: p.id, label: partOf(b), drop: null }); parents.push(q); rowId = q.id; }
    } else {
      const owner = b.assigneeId ? String(b.assigneeId) : NONE;
      if (!seen.has(owner)) node({ id: owner, label: who(b) });
      const p = node({ id: 'pi:' + owner + ':' + b.incomeId, parentId: owner, label: posLabel(b), sub: b.orderNo ? '№ ' + b.orderNo : '', drop: owner });
      parents = [seen.get(owner), p];
      rowId = p.id;
    }
    for (const n of parents) bump(n.id);
    // шаги позиции — полосами в ОДНОЙ строке (как в kppdf), не строкой на каждый шаг
    const sub = [lens === 'orders' ? who(b) : '', b.hours ? `${round(b.hours)} ч` : '', b.inDesign ? 'в проектировании' : ''].filter(Boolean).join(' · ');
    view.push({
      id: String(b.stepId), taskId: b.taskId || null, locked: !!b.locked, rowId, ownerId: lens === 'people' ? (b.assigneeId ? String(b.assigneeId) : NONE) : rowId,
      start: day(b.start), end: day(b.end), title: b.workTypeName || 'работа', sub,
      hue: b.hue || null, wt: b.workTypeId ? String(b.workTypeId) : null, status: b.status, overdue: !!b.overdue, deadline: b.deadline || null,
      tone: b.status === 'done' ? 'ok' : !b.assigneeId && lens === 'people' ? 'warn' : 'info',
      hint: [`Заказ № ${b.orderNo || '—'}`, posLabel(b), partOf(b), who(b), b.inDesign ? 'в проектировании' : '', b.locked ? 'сроки — по маршруту изделия' : ''].filter(Boolean).join(' · '),
    });
  }
  for (const r of rows) if (stepsOf.has(r.id) && !r.sub) r.sub = count(stepsOf.get(r.id));
  const withKids = new Set(rows.map((r) => r.parentId));
  return { rows, bars: view, nodeIds: [...nodeIds].filter((id) => withKids.has(id)) };
}
