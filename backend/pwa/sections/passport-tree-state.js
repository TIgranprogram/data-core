/** Условия применимости входят в смысл фразы: одинаковый текст ещё не делает записи дублями. */
const sorted = (value) => [...new Set(Array.isArray(value) ? value.map(String) : String(value || '').split(/[,;\s]+/).filter(Boolean))].sort();
const textKey = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');

export function phraseDuplicateKey(row) {
  const text = textKey(row.text);
  if (!text) return '';
  return JSON.stringify([text, !!row.allCategories, row.allCategories ? [] : sorted(row.categories),
    sorted(row.kindIds), sorted(row.facetValueIds), sorted(row.groupIds), sorted(row.partIds),
    row.section || '', row.slot ?? 1, !!row.required, !!row.isDefault, row.installTypeId || null]);
}

export function phraseDuplicates(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = phraseDuplicateKey(row);
    if (key) (groups.get(key) || groups.set(key, []).get(key)).push(row.id);
  }
  return new Map([...groups.values()].filter((ids) => ids.length > 1).flatMap((ids) => ids.map((id) => [id, ids.length])));
}

export const phraseFitsCategory = (row, category) => !category || !!row.allCategories || sorted(row.categories).includes(category);

/** Корень — контейнер. Его общая галочка не требует вариантов для всех чужих категорий. */
export function phraseRootApplies(root, leaves, category) {
  if (!category) return true;
  if (leaves.some((leaf) => leaf.parentId && phraseFitsCategory(leaf, category))) return true;
  return (!root.allCategories && sorted(root.categories).includes(category))
    || (leaves.length === 1 && leaves[0].id === root.id && phraseFitsCategory(root, category));
}
