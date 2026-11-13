import { h } from '../core/dom.js';
import { withVars } from './passport-texts.js';
import { badge, button, table, toolbar, stack, section, actions, sku } from '../ui/kit/index.js';

/** Сортировка «Группы изделий»: по номеру (пусто — в конце) или по названию. */
export function sortProductGroups(rows, mode) {
  return rows.slice().sort((a, b) => {
    if (mode === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    const na = Number(a.groupNo); const nb = Number(b.groupNo);
    const aa = Number.isFinite(na) ? na : 999; const bb = Number.isFinite(nb) ? nb : 999;
    return aa - bb || String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });
}

/** Кнопки «По номеру» / «По названию». */
export function productGroupSortBtns(mode, onChange) {
  return [
    button({ label: 'По номеру', kind: mode === 'no' ? 'primary' : 'ghost', size: 'S', onClick: () => onChange('no') }),
    button({ label: 'По названию', kind: mode === 'name' ? 'primary' : 'ghost', size: 'S', onClick: () => onChange('name') }),
  ];
}

const SKIP_COL = new Set(['name', 'groupNo']);

function noCell(r) {
  return r.groupNo ? sku(String(r.groupNo)) : badge('нет', 'warn');
}

function cellOf(key, r, fieldOf, fmt, colorBadge) {
  if (key === 'groupNo') return noCell(r);
  if (key === 'hex' && r.hex) return h('span', null, colorBadge(r.hex), ' ', r.hex);
  if (key === 'passportCategory' || key === 'passportCategoryName') {
    return h('span', { class: 'muted' }, r.passportCategoryName || r.passportCategory || '—');
  }
  if (key === 'parentName') return h('span', { class: 'muted' }, r.parentName || '—');
  if (key === 'code') return r.code ? h('span', { class: 'muted' }, String(r.code)) : '—';
  if (key === 'kind' && (r.kind === 'coating' || r.kind === 'material')) {
    return badge(r.kind === 'coating' ? 'покрытие' : 'материал', r.kind === 'coating' ? 'info' : 'dim');
  }
  const v = fmt(fieldOf(key), r[key]) || (key === 'workTypeName' ? r.workTypeName : '') || r[key];
  if (v === undefined || v === null || v === '') return '—';
  // метки подстановки {maxUsers} — подписями (иначе сторож мусора прячет ячейку)
  if (typeof v === 'string' && /\{[A-Za-z]/.test(v)) return h('span', null, ...withVars(v));
  return typeof v === 'string' || typeof v === 'number' ? String(v) : v;
}

function actCell(r, { canEdit, isLocked, lockBadge, onEdit, onRemove }) {
  const lock = isLocked(r);
  const acts = [];
  if (canEdit) {
    acts.push(button({ label: 'Изменить', kind: 'ghost', size: 'S', onClick: (e) => { e.stopPropagation(); onEdit(r); } }));
    acts.push(lock ? lockBadge()
      : button({ label: 'Удалить', kind: 'ghost', size: 'S', onClick: (e) => { e.stopPropagation(); onRemove(r, e.currentTarget); } }));
  } else if (lock) acts.push(lockBadge());
  return actions(...acts);
}

function rowOf(r, columns, ctx) {
  return {
    data: r.id,
    onClick: ctx.canEdit ? () => ctx.onOpen(r) : undefined,
    cells: columns.map((c) => {
      if (c.key === 'name') return { v: r.name || '—' };
      if (c.key === '_q') return { v: ctx.qualityCell ? ctx.qualityCell(r) : '' };
      if (c.key === '_act') return { v: actCell(r, ctx) };
      return { v: cellOf(c.key, r, ctx.fieldOf, ctx.fmt, ctx.colorBadge) };
    }),
  };
}

function mkTable(columns, list, ctx, label) {
  return table({
    columns,
    rows: list.map((r) => rowOf(r, columns, ctx)),
    clickable: !!ctx.canEdit,
    label,
    cls: 'k-table-stack',
    empty: { title: 'Ничего не найдено.' },
  });
}

/** Группы изделий: секции-разделы (kit.section) + таблица № · Название. */
function productGroupsView(rows, sortMode, ctx, tools) {
  const sorted = sortProductGroups(rows, sortMode);
  const bySec = new Map();
  for (const r of sorted) {
    const key = r.parentName || 'Без раздела';
    if (!bySec.has(key)) bySec.set(key, []);
    bySec.get(key).push(r);
  }
  const cols = [
    { key: 'groupNo', label: '№', num: true, nowrap: true },
    { key: 'name', label: 'Название', wrap: true },
    { key: '_q', label: '', nowrap: true },
    { key: '_act', label: '', nowrap: true },
  ];
  const blocks = [...bySec].map(([sec, list], i) => {
    const nos = list.map((x) => Number(x.groupNo)).filter((n) => Number.isFinite(n));
    const range = nos.length ? `${Math.min(...nos)}–${Math.max(...nos)}` : 'без №';
    return section({
      title: sec,
      count: `${list.length} · ${range}`,
      open: true,
      fixed: true,
      tone: i === 0 ? 'main' : 'info',
      body: mkTable(cols, list, ctx, sec),
    });
  });
  return stack(...(tools.length ? [toolbar(...tools)] : []), ...blocks);
}

/**
 * Эталонная таблица справочника (DESIGN §4 / kit.table).
 * Группы изделий — kit.section по разделу + колонка № (sku), без дубля в названии.
 */
export function dictsTable(opts) {
  const {
    dictKey, rows, cols, sortMode, onSort, canEdit, isLocked, lockBadge, colorBadge,
    fieldOf, fmt, dup, qualityCell, onOpen, onEdit, onRemove, extraTools = [],
  } = opts;
  const ctx = { canEdit, isLocked, lockBadge, colorBadge, fieldOf, fmt, dup, qualityCell, onOpen, onEdit, onRemove };
  const tools = [];
  if (dictKey === 'productGroups') tools.push(...productGroupSortBtns(sortMode, onSort));
  tools.push(...extraTools);

  if (dictKey === 'productGroups') return productGroupsView(rows, sortMode, ctx, tools);

  const columns = [{ key: 'name', label: 'Название', wrap: true }];
  if (dictKey === 'productSections') columns.push({ key: 'passportCategory', label: 'Тип паспорта', wrap: true });
  for (const c of cols) {
    if (SKIP_COL.has(c.key)) continue;
    if (dictKey === 'productSections' && c.key === 'passportCategory') continue;
    columns.push({
      key: c.key,
      label: c.label || c.key,
      num: c.key === 'sortOrder' || c.key === 'order',
      wrap: !['code', 'hex'].includes(c.key),
      nowrap: c.key === 'code',
    });
  }
  if (!columns.some((c) => c.key === 'code') && rows.some((r) => r.code)) {
    columns.splice(1, 0, { key: 'code', label: 'Код', nowrap: true });
  }
  columns.push({ key: '_q', label: '', nowrap: true }, { key: '_act', label: '', nowrap: true });

  const tbl = mkTable(columns, rows, ctx, 'Справочник');
  return tools.length ? stack(toolbar(...tools), tbl) : tbl;
}
