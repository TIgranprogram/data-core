import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { CAT_NAMES, kindName } from '../core/passport-kinds.js';
import { withVars } from './passport-texts.js';
import { badge, button, table, toolbar, stack, section, actions, sku } from '../ui/kit/index.js';

/** Справочники, где categories режет выпадающие списки паспорта/книжки. */
export const SCOPE_DICTS = new Set(['passportMaterials', 'passportParts', 'passportElements', 'passportInstall']);

/** Пустое categories = не предлагают (как elementFits / части). */
const STRICT_EMPTY = new Set(['passportParts', 'passportElements']);

/**
 * Как запись попадает в выбор изделия с типом catCode.
 * mode: 'short' — короткий список; 'other' — только «Другие»; 'all' — в т.ч. hideInNew.
 * Части и элементы: пустые categories — НЕ в short.
 * Материалы/покрытия/установка: пусто = для всех; hideInNew — не в новом выборе.
 */
export function offeredInPassportList(dictKey, row, catCode, mode = 'short') {
  if (!catCode) return true;
  const hide = row.hideInNew === true || row.hideInNew === 'true';
  if (hide && mode !== 'all') return false;
  const list = String(row.categories || '').split(/[,;\s]+/).filter(Boolean);
  if (STRICT_EMPTY.has(dictKey)) return mode === 'other' ? false : list.includes(catCode);
  const mine = !list.length || list.includes(catCode);
  if (mode === 'other') return !mine;
  if (mode === 'all') return true;
  return mine;
}

/** Ячейка «Кому предлагают»: метки типов словами + короткая подсказка основания. */
export function categoriesScopeCell(dictKey, raw, codeMap) {
  const codes = String(raw || '').split(/[,;\s]+/).filter(Boolean);
  const nameOf = (c) => (codeMap && codeMap.get(c)) || CAT_NAMES[c] || 'Тип удалён или не найден';
  if (!codes.length) {
    if (dictKey === 'passportParts') {
      return h('span', { class: 'dict-scope', title: 'В таблице материалов при выбранном типе паспорта эту часть не предложат сразу — только после «Показать все части»' },
        badge('Не в коротком списке', 'warn'),
        h('small', { class: 'dict-scope-hint' }, 'Нужна галочка типа — иначе спрятана'));
    }
    if (dictKey === 'passportElements') {
      return h('span', { class: 'dict-scope', title: 'Сервер elementFits: без типа элемент никому не предлагают' },
        badge('Никому не предлагают', 'warn'),
        h('small', { class: 'dict-scope-hint' }, 'Отметьте типы — иначе в «Что это за изделие» не будет'));
    }
    return h('span', { class: 'dict-scope', title: 'Пустые типы = предлагают любому изделию' },
      badge('Для всех типов', 'ok'),
      h('small', { class: 'dict-scope-hint' }, 'В любом выпадающем списке паспорта'));
  }
  return h('span', { class: 'dict-scope', title: 'Предлагают только изделиям этих типов паспорта' },
    h('span', { class: 'dict-scope-tags' },
      ...codes.map((c) => h('span', { class: 'tag dict-scope-tag', title: c }, nameOf(c)))),
    h('small', { class: 'dict-scope-hint' }, 'Только эти типы паспорта'));
}

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

/* C145: описание — вторая строка у названия, не отдельная растянутая колонка */
const SKIP_COL = new Set(['name', 'groupNo', 'description']);

function noCell(r) {
  return r.groupNo ? sku(String(r.groupNo)) : badge('нет', 'warn');
}

function nameCell(r) {
  const sub = String(r.description || '').trim();
  return h('div', { title: sub ? `${r.name || ''} — ${sub}` : (r.name || '') },
    h('div', { class: 't-title' }, r.name || '—'),
    sub ? h('div', { class: 't-sub' }, sub) : null);
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

function cellOf(key, r, fieldOf, fmt, colorBadge, codeNames, dictKey) {
  if (key === 'groupNo') return noCell(r);
  if (key === 'categories' && SCOPE_DICTS.has(dictKey)) {
    return categoriesScopeCell(dictKey, r.categories, codeNames?.get('categories'));
  }
  if (codeNames?.has(key)) return namesOf(codeNames.get(key), r[key]) || '—';
  if (key === 'hex' && r.hex) return colorBadge(r.hex); // кружок цвета с кодом — один раз (приёмка C116: код дублировался)
  if (key === 'passportCategory' || key === 'passportCategoryName') {
    const code = String(r.passportCategory || '');
    const name = r.passportCategoryName || CAT_NAMES[code] || code;
    return h('span', { class: 'muted' }, name || '—');
  }
  if (key === 'parentName') return h('span', { class: 'muted' }, r.parentName || '—');
  if (key === 'code') return r.code ? h('span', { class: 'muted' }, String(r.code)) : '—';
  if (key === 'kind' && (r.kind === 'coating' || r.kind === 'material')) {
    return badge(r.kind === 'coating' ? 'покрытие' : 'материал', r.kind === 'coating' ? 'info' : 'dim');
  }
  if (key === 'hideInNew' && (r.hideInNew === true || r.hideInNew === 'true')) {
    return badge('Не в новых', 'dim');
  }
  const v = fmt(fieldOf(key), r[key]) || (key === 'workTypeName' ? r.workTypeName : '') || r[key];
  if (v === undefined || v === null || v === '') return '—';
  // метки подстановки {maxUsers} — подписями (иначе сторож мусора прячет ячейку)
  if (typeof v === 'string' && /\{[A-Za-z]/.test(v)) return h('span', null, ...withVars(v));
  return typeof v === 'string' || typeof v === 'number' ? String(v) : v;
}

function actCell(r, { canEdit, isLocked, lockBadge, onRemove }) {
  /* C145: «Изменить» не дублируем — клик по строке открывает панель */
  const lock = isLocked(r);
  const acts = [];
  if (canEdit) {
    acts.push(lock ? lockBadge()
      : button({ label: 'Удалить', kind: 'ghost', size: 'S', onClick: (e) => { e.stopPropagation(); onRemove(r, e.currentTarget); } }));
  } else if (lock) acts.push(lockBadge());
  return acts.length ? actions(...acts) : '';
}

function rowOf(r, columns, ctx) {
  return {
    data: r.id,
    selected: !!(ctx.openId && String(ctx.openId) === String(r.id)),
    onClick: ctx.canEdit ? () => ctx.onOpen(r) : undefined,
    cells: columns.map((c) => {
      if (c.key === '_no') return { v: ctx.kindNo?.get(String(r.id)) ? sku(ctx.kindNo.get(String(r.id))) : '—' };
      if (c.key === 'name') return { v: nameCell(r) };
      if (c.key === '_q') return { v: ctx.qualityCell ? ctx.qualityCell(r) : '' };
      if (c.key === '_act') return { v: actCell(r, ctx) };
      return { v: cellOf(c.key, r, ctx.fieldOf, ctx.fmt, ctx.colorBadge, ctx.codeNames, ctx.dictKey) };
    }),
  };
}

/** Виды изделий: № = «номер типа.номер в типе» (каскад сверху вниз). */
const KIND_CAT_ORDER = ['TRN', 'WRK', 'BLG', 'DIO', 'DSP'];
function passportKindsNumbered(rows) {
  const sorted = rows.slice().sort((a, b) => {
    const ia = KIND_CAT_ORDER.indexOf(a.passportCategory); const ib = KIND_CAT_ORDER.indexOf(b.passportCategory);
    const ca = ia < 0 ? 99 : ia; const cb = ib < 0 ? 99 : ib;
    return ca - cb || String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });
  const kindNo = new Map();
  const counts = new Map();
  for (const r of sorted) {
    const cat = r.passportCategory || '';
    const ci = KIND_CAT_ORDER.indexOf(cat);
    const catNo = ci >= 0 ? ci + 1 : KIND_CAT_ORDER.length + 1;
    const n = (counts.get(cat) || 0) + 1;
    counts.set(cat, n);
    kindNo.set(String(r.id), `${catNo}.${n}`);
  }
  return { sorted, kindNo };
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
    { key: 'name', label: 'Название', wrap: true, cls: 'k-dict-col-name' },
    { key: '_q', label: '', nowrap: true, cls: 'k-col-q' },
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
    fieldOf, fmt, dup, qualityCell, onOpen, onEdit, onRemove, extraTools = [], codeNames, openId,
  } = opts;
  const ctx = { dictKey, canEdit, isLocked, lockBadge, colorBadge, fieldOf, fmt, dup, qualityCell, onOpen, onEdit, onRemove, codeNames, openId };
  const tools = [];
  tools.push(...extraTools);

  if (dictKey === 'productGroups') return productGroupsView(rows, sortMode, ctx, tools);

  let list = rows;
  const columns = [];
  if (dictKey === 'passportKinds') {
    const numbered = passportKindsNumbered(rows);
    list = numbered.sorted;
    ctx.kindNo = numbered.kindNo;
    columns.push({ key: '_no', label: '№', num: true, nowrap: true, cls: 'k-col-no' });
  }
  columns.push({ key: 'name', label: 'Название', wrap: true, cls: 'k-dict-col-name' });
  if (dictKey === 'productSections') columns.push({ key: 'passportCategory', label: 'Тип паспорта', wrap: true });
  // C144: у паспортных списков сначала «тип / кому предлагают» — иначе колонка categories уезжает за лимит extra
  const SCOPE_FIRST = ['kind', 'categories', 'hideInNew', 'material'];
  const restCols = cols.filter((c) => !SKIP_COL.has(c.key) && !(dictKey === 'productSections' && c.key === 'passportCategory'));
  const ordered = [
    ...SCOPE_FIRST.map((k) => restCols.find((c) => c.key === k)).filter(Boolean),
    ...restCols.filter((c) => !SCOPE_FIRST.includes(c.key)),
  ];
  // kind — tech на сервере, в columns нет; для материалов всё равно показываем
  if (dictKey === 'passportMaterials' && !ordered.some((c) => c.key === 'kind') && rows.some((r) => r.kind)) {
    ordered.unshift({ key: 'kind', label: 'Тип' });
  }
  if (SCOPE_DICTS.has(dictKey) && !ordered.some((c) => c.key === 'categories')) {
    ordered.unshift({ key: 'categories', label: 'Кому предлагают' });
  }
  let extra = 0;
  for (const c of ordered) {
    const text = !['code', 'hex', 'kind', 'hideInNew'].includes(c.key);
    const isScope = c.key === 'categories';
    if (text && !isScope && ++extra > 2) continue; // таблица не шире: scope всегда оставляем
    columns.push({
      key: c.key,
      label: c.key === 'categories' ? 'Кому предлагают'
        : c.key === 'elementNames' ? 'Функциональные элементы'
          : (c.label || c.key),
      num: c.key === 'sortOrder' || c.key === 'order',
      wrap: text || isScope,
      nowrap: c.key === 'code' || c.key === 'kind',
      hide: text && !isScope,
    });
  }
  if (!columns.some((c) => c.key === 'code') && rows.some((r) => r.code)) {
    columns.splice(1, 0, { key: 'code', label: 'Код', nowrap: true });
  }
  columns.push({ key: '_q', label: '', nowrap: true, cls: 'k-col-q' }, { key: '_act', label: '', nowrap: true, cls: 'k-col-act' });

  const tbl = mkTable(columns, list, ctx, 'Справочник');
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
