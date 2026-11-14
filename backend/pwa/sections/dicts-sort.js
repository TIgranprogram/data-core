import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { kindName } from '../core/passport-kinds.js';
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

/** Поля со ссылкой на коды другого справочника (дефекты, типы паспорта): в таблице — названия, не коды (только русский на экране). */
const CODE_REFS = { categories: 'passportCategories' };
export async function loadCodeNames(dict, apiFn) {
  const out = new Map();
  for (const f of dict?.fields || []) {
    const ds = String(f.ref?.dict || CODE_REFS[f.key] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ds.length) continue;
    const m = new Map();
    for (const d of ds) for (const it of (await apiFn('/dicts/' + d).catch(() => null))?.items || []) if (it.code) m.set(String(it.code), it.name);
    if (m.size) out.set(f.key, m);
  }
  return out;
}
const namesOf = (map, v) => (typeof v === 'string' && v.trim() ? v.split(/[,;\s]+/).filter(Boolean).map((c) => map.get(c) || c).join(', ') : v);

function cellOf(key, r, fieldOf, fmt, colorBadge, codeNames) {
  if (key === 'groupNo') return noCell(r);
  if (codeNames?.has(key)) return namesOf(codeNames.get(key), r[key]) || '—';
  if (key === 'hex' && r.hex) return colorBadge(r.hex); // кружок цвета с кодом — один раз (приёмка C116: код дублировался)
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
      return { v: cellOf(c.key, r, ctx.fieldOf, ctx.fmt, ctx.colorBadge, ctx.codeNames) };
    }),
  };
}

function mkTable(columns, list, ctx, label) {
  return table({
    columns,
    rows: list.map((r) => rowOf(r, columns, ctx)),
    clickable: !!ctx.canEdit,
    label,
    cls: 'k-table-stack k-table-inset', // inset: на телефоне строки с отступами панели
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
    { key: '_act', label: '', nowrap: true, cls: 'k-col-act' },
  ];
  const blocks = [...bySec].map(([sec, list], i) => {
    const nos = list.map((x) => Number(x.groupNo)).filter((n) => Number.isFinite(n));
    const range = nos.length ? `${Math.min(...nos)}–${Math.max(...nos)}` : 'без номеров';
    return section({
      title: sec,
      count: `${list.length} гр. · № ${range}`,
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
    fieldOf, fmt, dup, qualityCell, onOpen, onEdit, onRemove, extraTools = [], codeNames,
  } = opts;
  const ctx = { canEdit, isLocked, lockBadge, colorBadge, fieldOf, fmt, dup, qualityCell, onOpen, onEdit, onRemove, codeNames };
  const tools = [];
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
  columns.push({ key: '_q', label: '', nowrap: true }, { key: '_act', label: '', nowrap: true, cls: 'k-col-act' }); // действия — у правого края строки

  const tbl = mkTable(columns, rows, ctx, 'Справочник');
  return tools.length ? stack(toolbar(...tools), tbl) : tbl;
}

/** Список видов рисунков из текста справочника. */
export const linesToKinds = (v) => [...new Set(String(v || '').replace(/\([^)]*\)/g, ' ').split(/[\s,;]+/).filter((x) => /^[a-z_]+$/.test(x)).map((k) => (k === 'safety_zone' ? 'safety' : k)))];
export const fmt = (f, v, refs) => {
  if (v === undefined || v === null || v === '' || v === 'null' || (Array.isArray(v) && !v.length)) return '';
  if (f?.key === 'requiredImages') return linesToKinds(v).map(kindName).join(', ');
  if (f?.type === 'photo' || f?.type === 'photos') return `картинок: ${Array.isArray(v) ? v.length : 1}`;
  if (f?.type === 'money') return money(v);
  if (f?.type === 'select') return (f.options || refs?.[f.ref] || []).find((o) => String(o.value) === String(v))?.label || '';
  return String(v);
};
