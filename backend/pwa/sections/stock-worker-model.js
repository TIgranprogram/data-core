/** Модель рабочей сетки: координаты служат раскладке, запись всегда остаётся отдельным materialId. */
export const workerMaterialId = item => String(item.materialId || item.id || '');
const text = value => String(value ?? '').trim();
const decimal = value => /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text(value)) ? Number(text(value).replace(',', '.')) : NaN;
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
export const workerUnit = item => text(item.unit) || 'Ед. не указана';
export const workerGrade = item => text(item.materialGrade) || 'Марка не указана';
export const workerWash = item => item.washed === true ? 'Мытая' : item.washed === false ? 'Не мытая' : 'Мойка не указана';
export const workerLength = item => positive(item.dims?.length);
export const workerPieceFactor = item => {
  const unit = text(item.unit).toLowerCase().replace(/\.$/, '');
  if (unit === 'шт') return 1;
  const metres = workerLength(item) / 1000;
  return unit === 'м' && metres > 0 ? metres : null;
};

/** Учитываем только погрешность вычисления, а не дробные трубы в остатке. */
const snapInteger = number => {
  const nearest = Math.round(number);
  return Math.abs(number - nearest) <= Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(number)) * 8) ? nearest : number;
};

export function workerPipePieces(item) {
  const factor = workerPieceFactor(item), quantity = item.quantity;
  if (factor == null || quantity == null || !Number.isFinite(Number(quantity))) return null;
  const pieces = snapInteger(Number(quantity) / factor);
  return Number.isSafeInteger(pieces) && pieces >= 0 ? pieces : null;
}

export function workerPipeMetres(item) {
  const unit = text(item.unit).toLowerCase().replace(/\.$/, ''), length = workerLength(item);
  if (item.quantity == null || !(unit === 'м' || unit === 'шт' && length != null)) return null;
  const metres = unit === 'м' ? Number(item.quantity) : Number(item.quantity) * length / 1000;
  return Number.isFinite(metres) ? metres : null;
}

export const workerQuantityText = (item, kind) => kind === 'pipe' ? String(workerPipePieces(item) ?? '') : String(item.quantity ?? 0);

export function workerInputQuantity(item, input, kind) {
  const value = String(input).trim();
  if (kind === 'pipe') {
    const factor = workerPieceFactor(item), pieces = Number(value);
    if (factor == null) throw new Error('Для пересчёта укажите длину трубы и единицу учёта «м» или «шт».');
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(pieces)) throw new Error('Введите целое неотрицательное количество труб.');
    const quantity = factor === 1 ? pieces : pieces * workerLength(item) / 1000;
    if (!Number.isFinite(quantity)) throw new Error('Количество труб слишком большое.');
    return quantity;
  }
  const quantity = decimal(value);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Введите неотрицательное количество в единице учёта.');
  return quantity;
}

export const workerColumnKey = item => JSON.stringify([item.washed === true ? true : item.washed === false ? false : null, workerLength(item)]);
export const workerItemMatches = (item, context) => !context || item?.metal === context.kind;
export const workerCategoryMatches = (category, kind) => category.id !== 'none' && (kind === 'pipe' ? /труб/i : /лист/i).test(category.name);
export const workerZoneName = kind => ({ pipe: 'Трубы', sheet: 'Листовой материал' })[kind];

/** Только явные оси профиля: название не является источником размеров для записи. */
export function workerCreateContext(item, column) {
  const profile = item.sectionProfile;
  return { categoryId: item.categoryId, categoryName: item.categoryName || '', unit: item.unit, materialGrade: item.materialGrade || '', assortment: item.assortment || '', typeName: item.typeName || '',
    shape: ['rect', 'round'].includes(profile?.shape) ? profile.shape : '', washed: column.washed,
    dims: { length: column.length, width: profile?.widthMm, height: profile?.heightMm, diameter: profile?.diameterMm, thickness: profile?.wallMm } };
}

/** Полный контекст ячейки: можно сразу спросить только количество, без формы. */
export function workerQuickReady(context, kind) {
  if (!context?.categoryId || !text(context.categoryName) || !text(context.unit)) return false;
  if (kind === 'pipe' && workerPieceFactor(context) == null) return false;
  const axes = kind === 'sheet' ? ['thickness', 'width', 'length'] : context.shape === 'round' ? ['diameter', 'thickness', 'length'] : context.shape === 'rect' ? ['width', 'height', 'thickness', 'length'] : [];
  return axes.length > 0 && axes.every(key => positive(context.dims?.[key]));
}

export function workerCreateBody(value, kind, categories) {
  const category = categories.find(item => item.id === value.categoryId);
  if (!category) throw new Error('Выберите категорию своей складской зоны.');
  const unit = text(value.unit);
  if (!unit || unit.length > 30) throw new Error('Укажите единицу учёта (до30 символов).');
  const axes = kind === 'sheet' ? ['thickness', 'width', 'length'] : value.shape === 'round' ? ['diameter', 'thickness', 'length'] : value.shape === 'rect' ? ['width', 'height', 'thickness', 'length'] : [];
  if (!axes.length) throw new Error('Выберите вид сечения трубы.');
  const dims = {};
  for (const key of axes) { dims[key] = positive(decimal(value.dims[key])); if (!dims[key]) throw new Error('Укажите положительные размеры в миллиметрах.'); }
  const grade = text(value.materialGrade);
  if (grade.length > 100) throw new Error('Марка: не более100 символов.');
  const section = kind === 'sheet' ? `${dims.thickness} × ${dims.width} × ${dims.length}` : value.shape === 'round' ? `Ø${dims.diameter} × ${dims.thickness}` : `${dims.width} × ${dims.height} × ${dims.thickness}`;
  const washed = kind === 'pipe' ? value.washed === true ? true : value.washed === false ? false : null : null;
  const name = [category.name, section, kind === 'pipe' ? `${dims.length} мм` : '', kind === 'pipe' ? workerWash({ washed }) : '', grade].filter(Boolean).join(' · ');
  if (name.length > 300) throw new Error('Название длиннее300 символов: сократите марку.');
  return { kind, name, unit, categoryId: category.id, ...(text(value.typeName) ? { typeName: text(value.typeName) } : {}), dims, materialGrade: grade || null, washed, assortment: text(value.assortment).slice(0, 200) || null };
}

const metalOrder = ['ordinary', 'unknown', 'stainless'];
function metalOf(item) {
  const grade = text(item.materialGrade);
  if (/^(?:нерж|aisi\s*[234]\d{2}(?!\d))/i.test(grade)) return 'stainless';
  if (/^(?:сталь(?:$|\s)|ст\s*\d|09г2с(?:$|\s)|оцинкованная сталь)/i.test(grade)) return 'ordinary';
  return 'unknown';
}
const byMetal = (a, b) => metalOrder.indexOf(a.metal) - metalOrder.indexOf(b.metal);
const kindOf = item => ['rect', 'round'].includes(item.sectionProfile?.shape) ? item.sectionProfile.shape : 'unknown';
const kindNames = { rect: 'Профильная труба', round: 'Круглая труба', unknown: 'Вид трубы не указан' };
const sectionKey = item => {
  const p = item.sectionProfile;
  return p?.state === 'complete' && !item.offcutOf ? JSON.stringify([p.shape, p.widthMm, p.heightMm, p.diameterMm, p.wallMm, p.label]) : workerMaterialId(item);
};

/** Серверный порядок первого появления строк сохраняется; колонки берутся из фактических длин/мойки. */
export function workerPipeBlocks(items) {
  const blocks = new Map();
  for (const item of items) {
    const kind = kindOf(item), unit = workerUnit(item), grade = workerGrade(item);
    const blockKey = JSON.stringify([kind, grade, unit]);
    let block = blocks.get(blockKey);
    if (!block) { block = { kind, grade, unit, metal: metalOf(item), title: kindNames[kind], columns: new Map(), groups: new Map() }; blocks.set(blockKey, block); }
    const column = workerColumnKey(item);
    if (!block.columns.has(column)) block.columns.set(column, { key: column, washed: item.washed === true ? true : item.washed === false ? false : null, length: workerLength(item), label: workerWash(item) });
    const rowKey = sectionKey(item);
    let row = block.groups.get(rowKey);
    if (!row) { row = { profile: item.sectionProfile, source: item, cells: new Map() }; block.groups.set(rowKey, row); }
    const same = row.cells.get(column) || [];
    same.push(item); row.cells.set(column, same);
  }
  return [...blocks.values()].sort(byMetal).map(block => {
    const columns = [...block.columns.values()].sort((a, b) => ([true, false, null].indexOf(a.washed) - [true, false, null].indexOf(b.washed)) || (a.length ?? Infinity) - (b.length ?? Infinity));
    const rows = [...block.groups.values()].flatMap(group => {
      const depth = Math.max(...[...group.cells.values()].map(items => items.length));
      return Array.from({ length: depth }, (_, index) => ({ ...group, collision: depth > 1, cells: new Map([...group.cells].filter(([, values]) => values[index]).map(([key, values]) => [key, values[index]])) }));
    });
    return { ...block, columns, rows, groups: undefined };
  });
}

export function workerSheetBlocks(items) {
  const blocks = new Map();
  for (const item of items) {
    const grade = workerGrade(item), unit = workerUnit(item);
    const surface = text(item.surface) || (/рифл/i.test(item.assortment || '') ? 'Рифлёная' : 'Поверхность не указана');
    const key = JSON.stringify([grade, surface, unit]);
    if (!blocks.has(key)) blocks.set(key, { grade, surface, unit, metal: metalOf(item), rows: [] });
    blocks.get(key).rows.push(item);
  }
  return [...blocks.values()].sort(byMetal);
}

/** Каждая строка пересчёта хранит фактическое количество и expected в единице API. */
export function workerCountBody(item, input, note, kind) {
  if (item.countMode !== 'single') throw new Error('Пересчёт общего остатка недоступен.');
  const quantity = workerInputQuantity(item, input, kind);
  return { type: 'count', note, lines: [{ materialId: workerMaterialId(item), qty: quantity, expected: item.quantity }] };
}
