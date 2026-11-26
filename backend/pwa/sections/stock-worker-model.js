/** Модель рабочей сетки: координаты служат раскладке, запись всегда остаётся отдельным materialId. */
export const workerMaterialId = item => String(item.materialId || item.id || '');
const text = value => String(value ?? '').trim();
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
export const workerUnit = item => text(item.unit) || 'Ед. не указана';
export const workerGrade = item => text(item.materialGrade) || 'Марка не указана';
export const workerWash = item => item.washed === true ? 'Мытая' : item.washed === false ? 'Не мытая' : 'Мойка не указана';
export const workerLength = item => positive(item.dims?.length);
export const workerColumnKey = item => JSON.stringify([item.washed === true ? true : item.washed === false ? false : null, workerLength(item)]);
export const workerItemMatches = (item, context) => !context || item?.metal === context.kind;

/** Только явные оси профиля: название не является источником размеров для записи. */
export function workerCreateContext(item, column) {
  const profile = item.sectionProfile;
  return { categoryId: item.categoryId, categoryName: item.categoryName || '', unit: item.unit, materialGrade: item.materialGrade || '', assortment: item.assortment || '',
    shape: ['rect', 'round'].includes(profile?.shape) ? profile.shape : '', washed: column.washed,
    dims: { length: column.length, width: profile?.widthMm, height: profile?.heightMm, diameter: profile?.diameterMm, thickness: profile?.wallMm } };
}

/** Полный контекст ячейки: можно сразу спросить только количество, без формы. */
export function workerQuickReady(context, kind) {
  if (!context?.categoryId || !text(context.categoryName) || !text(context.unit)) return false;
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
  for (const key of axes) { dims[key] = positive(String(value.dims[key] ?? '').replace(',', '.')); if (!dims[key]) throw new Error('Укажите положительные размеры в миллиметрах.'); }
  const grade = text(value.materialGrade);
  if (grade.length > 100) throw new Error('Марка: не более100 символов.');
  const section = kind === 'sheet' ? `${dims.thickness} × ${dims.width} × ${dims.length}` : value.shape === 'round' ? `Ø${dims.diameter} × ${dims.thickness}` : `${dims.width} × ${dims.height} × ${dims.thickness}`;
  const washed = kind === 'pipe' ? value.washed === true ? true : value.washed === false ? false : null : null;
  const name = [category.name, section, kind === 'pipe' ? `${dims.length} мм` : '', kind === 'pipe' ? workerWash({ washed }) : '', grade].filter(Boolean).join(' · ');
  if (name.length > 300) throw new Error('Название длиннее300 символов: сократите марку.');
  return { name, unit, categoryId: category.id, dims, materialGrade: grade || null, washed, assortment: text(value.assortment).slice(0, 200) || null };
}
/** Один ключ для контекста ячейки и для материала: иначе «Мытая» никогда не найдёт пару. */
const geometryKey = value => {
  const profile = value.sectionProfile;
  if (profile && (profile.state !== 'complete' || value.offcutOf)) return null;
  const dims = value.dims || {}, shape = value.shape || profile?.shape;
  if (!['rect', 'round'].includes(shape)) return null;
  return JSON.stringify([text(value.categoryId), shape,
    positive(profile ? profile.widthMm : dims.width), positive(profile ? profile.heightMm : dims.height),
    positive(profile ? profile.diameterMm : dims.diameter), positive(profile ? profile.wallMm : dims.thickness)]);
};
const gradeKey = value => text(value.materialGrade) || 'Марка не указана';

/**
 * Тот же размер и длина в соседнем столбце «Не мытая»: предложение перенести остаток,
 * когда рабочий вписывает количество в «Мытая». Возвращает только материал с остатком.
 */
export function workerWashCounterpart(target, items) {
  if (!target || target.washed !== true || !Array.isArray(items)) return null;
  const item = 'sectionProfile' in target;
  const unit = item ? workerUnit(target) : text(target.unit);
  const grade = gradeKey(target);
  const length = item ? workerLength(target) : positive(target.dims?.length);
  const geometry = geometryKey(target);
  if (!geometry || !length) return null;
  return items.find(other => other !== target && other.washed === false && workerUnit(other) === unit
    && gradeKey(other) === grade && workerLength(other) === length && geometryKey(other) === geometry
    && Number(other.quantity) > 0) || null;
}

const kindOf = item => /нержав|\baisi\b/i.test(text(item.materialGrade)) ? 'steel'
  : ['rect', 'round'].includes(item.sectionProfile?.shape) ? item.sectionProfile.shape : 'unknown';
const kindNames = { rect: 'Профильная труба', round: 'Круглая труба', steel: 'Нержавеющая труба', unknown: 'Вид трубы не указан' };
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
    if (!block) { block = { kind, grade, unit, title: kindNames[kind], columns: new Map(), groups: new Map() }; blocks.set(blockKey, block); }
    const column = workerColumnKey(item);
    if (!block.columns.has(column)) block.columns.set(column, { key: column, washed: item.washed === true ? true : item.washed === false ? false : null, length: workerLength(item), label: workerWash(item) });
    const rowKey = sectionKey(item);
    let row = block.groups.get(rowKey);
    if (!row) { row = { profile: item.sectionProfile, source: item, cells: new Map() }; block.groups.set(rowKey, row); }
    const same = row.cells.get(column) || [];
    same.push(item); row.cells.set(column, same);
  }
  return [...blocks.values()].map(block => {
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
    if (!blocks.has(key)) blocks.set(key, { grade, surface, unit, rows: [] });
    blocks.get(key).rows.push(item);
  }
  return [...blocks.values()];
}

/** C242: фактическое количество в исходной единице, без умножения/деления на длину. */
export function workerCountBody(item, input, note) {
  if (item.countMode !== 'single') throw new Error('Пересчёт общего остатка недоступен.');
  const quantity = String(input).trim() === '' ? NaN : Number(String(input).replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Введите неотрицательное количество в единице учёта.');
  return { type: 'count', note, lines: [{ materialId: workerMaterialId(item), qty: quantity, expected: item.quantity }] };
}
