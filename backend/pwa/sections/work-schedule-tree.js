import { plural } from '../core/format.js';
import { NONE, day, isLegacyCommonWork, partKeyOf, partOf, round, typeOf, workLabel } from './work-schedule-shared.js';

/*
 * Модель дерева Ганта: полосы сервера → строки planner (parentId) и полосы.
 * «По заказам»: заказ › позиция › часть (если задана) › операция. «По людям»: человек › позиция › операция.
 * Узлы показывают сводный срок. Единственное старое «Изготовление» целиком остаётся полосой позиции.
 * → { rows, bars, nodeIds }
 */
const count = (n) => `${n} ${plural(n, 'операция', 'операции', 'операций')}`;
const posLabel = (b) => b.productName || b.title || 'Позиция';
const personId = (b) => b.assigneeId ? String(b.assigneeId) : NONE;

export function buildModel({ bars: raw, people, lens, allBars = raw }) {
  const bars = raw.slice().sort((a, b) => String(a.orderNo || '').localeCompare(String(b.orderNo || ''), 'ru', { numeric: true }) || String(a.start).localeCompare(String(b.start)));
  const seen = new Map(), operationsOf = new Map(), positionTotals = new Map();
  const node = (row) => {
    if (!seen.has(row.id)) seen.set(row.id, row);
    return seen.get(row.id);
  };
  const bump = (id) => operationsOf.set(id, (operationsOf.get(id) || 0) + 1);
  for (const b of allBars) {
    const position = String(b.incomeId);
    positionTotals.set(position, (positionTotals.get(position) || 0) + 1);
  }
  const peopleBy = new Map(people.map((x) => [String(x.id), x]));
  const who = (b) => (b.assigneeId ? peopleBy.get(String(b.assigneeId))?.name || 'Исполнитель' : 'Без исполнителя');
  const byPeople = lens === 'people';

  if (byPeople) {
    const assigned = new Set(bars.map(personId));
    const list = people.filter((x) => assigned.has(String(x.id))).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    if (assigned.has(NONE)) node({ id: NONE, kind: 'person', label: 'Без исполнителя' });
    for (const x of list) node({ id: String(x.id), kind: 'person', label: x.name, cap: Number(x.capacityHours) || 0, sub: x.capacityHours ? round(x.capacityHours) + ' ч в день' : '' });
  }

  const view = [];
  for (const b of bars) {
    const owner = personId(b), position = String(b.incomeId), step = String(b.stepId);
    const work = workLabel(b), partKey = partKeyOf(b), partName = b.partName?.trim() || 'Часть изделия';
    const compact = isLegacyCommonWork(b) && (b.stepIndex ?? 0) === 0 && positionTotals.get(position) === 1;
    const drop = byPeople ? owner : null;
    // Заказы группируются по своему id, поскольку производственный номер может быть общим.
    const root = byPeople
      ? node({ id: owner, kind: 'person', label: who(b) })
      : node({ id: 'o:' + (b.orderId || b.orderNo || '—'), kind: 'order', label: 'Заказ № ' + (b.orderNo || '—'), sub: b.productionNo ? 'в производстве № ' + b.productionNo : '' });
    const pos = node({
      id: byPeople ? `pi:${owner}:${position}` : `i:${position}`, parentId: root.id, kind: 'position', label: posLabel(b), drop,
      sub: byPeople && b.orderNo ? `№ ${b.orderNo}` : '',
    });
    bump(root.id);

    const details = [byPeople ? (partKey ? partName : '') : who(b), b.hours ? `${round(b.hours)} ч` : '', b.inDesign ? 'в проектировании' : ''].filter(Boolean).join(' · ');
    let rowId = pos.id;
    if (!compact) {
      bump(pos.id);
      if (!byPeople && partKey) {
        const part = node({ id: `p:${position}:${partKey}`, parentId: pos.id, kind: 'part', label: partName, drop });
        bump(part.id);
        rowId = part.id;
      }
      rowId = node({ id: byPeople ? `ps:${owner}:${step}` : `s:${step}`, parentId: rowId, kind: 'operation', label: work, sub: details, drop }).id;
    }

    view.push({
      id: step, taskId: b.taskId || null, stepIndex: b.stepIndex ?? null, locked: !!b.locked, rowId, ownerId: byPeople ? owner : rowId,
      start: day(b.start), end: day(b.end), title: work, sub: details,
      hue: b.hue || (typeOf(b) ? 1 : null), wt: typeOf(b), status: b.status, overdue: !!b.overdue, deadline: b.deadline || null,
      tone: b.status === 'done' ? 'ok' : !b.assigneeId && byPeople ? 'warn' : 'info',
      hint: [`Заказ № ${b.orderNo || '—'}`, posLabel(b), partKey ? partName : partOf(b), who(b), b.hold?.kind === 'materials' ? 'Не хватает материалов' : b.hold ? 'Приостановлено' : '', isLegacyCommonWork(b) ? `По маршруту: ${b.workTypeName.trim()}` : '', b.inDesign ? 'в проектировании' : ''].filter(Boolean).join(' · '),
    });
  }
  const rows = [...seen.values()];
  for (const r of rows) if (operationsOf.has(r.id)) r.sub = [r.sub, count(operationsOf.get(r.id))].filter(Boolean).join(' · ');
  const withKids = new Set(rows.map((r) => r.parentId));
  return { rows, bars: view, nodeIds: rows.filter((r) => withKids.has(r.id)).map((r) => r.id) };
}
