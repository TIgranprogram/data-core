/** Модель рабочей сетки: координаты служат раскладке, запись всегда остаётся отдельным materialId. */
export const workerMaterialId = item => String(item.materialId || item.id || '');
const text = value => String(value ?? '').trim();
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
export const workerUnit = item => text(item.unit) || 'Ед. не указана';
export const workerGrade = item => text(item.materialGrade) || 'Марка не указана';
export const workerWash = item => item.washed === true ? 'Мытая' : item.washed === false ? 'Не мытая' : 'Мойка не указана';
export const workerLength = item => positive(item.dims?.length);
export const workerColumnKey = item => JSON.stringify([item.washed === true ? true : item.washed === false ? false : null, workerLength(item)]);
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
