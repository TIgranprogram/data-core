/** planner-tree — дерево строк эталона planner: видимые строки, сводные диапазоны узлов. Без DOM. */

/**
 * buildTree(rows, byRow) → { roots, kids, range(id), parents, hasKids }
 *   rows  [{ id, parentId? }] — parentId не из списка → корень;
 *   byRow Map(rowId → [{ s, e, dl?, over? }]) — полосы строки (дни от 1970).
 *   range(id) → { s, e, n, over, dl } по строке и всем её потомкам (null — полос нет).
 */
export function buildTree(rows, byRow) {
  const ids = new Set(rows.map((r) => String(r.id)));
  const kids = new Map(rows.map((r) => [String(r.id), []]));
  const roots = [];
  for (const r of rows) {
    const p = r.parentId == null ? '' : String(r.parentId);
    if (p && ids.has(p) && p !== String(r.id)) kids.get(p).push(r); else roots.push(r);
  }
  const memo = new Map();
  const range = (id, guard = new Set()) => {
    id = String(id);
    if (memo.has(id)) return memo.get(id);
    if (guard.has(id)) return null;
    guard.add(id);
    let acc = null;
    const add = (x) => {
      if (!x) return;
      acc = acc ? { s: Math.min(acc.s, x.s), e: Math.max(acc.e, x.e), n: acc.n + x.n, over: acc.over || x.over, dl: x.dl == null ? acc.dl : acc.dl == null ? x.dl : Math.min(acc.dl, x.dl) } : { ...x };
    };
    for (const it of byRow.get(id) || []) add({ s: it.s, e: it.e, n: 1, over: !!it.over, dl: it.dl ?? null });
    for (const k of kids.get(id) || []) add(range(k.id, guard));
    memo.set(id, acc);
    return acc;
  };
  const parents = rows.filter((r) => kids.get(String(r.id)).length).map((r) => String(r.id));
  return { roots, kids, range, parents, hasKids: parents.length > 0 };
}

/** Видимые строки по порядку обхода: потомки свёрнутого узла скрыты. → [{ row, depth, node, open }] */
export function visible(tree, open) {
  const out = [];
  const walk = (list, depth) => {
    for (const row of list) {
      const id = String(row.id), sub = tree.kids.get(id) || [];
      out.push({ row, depth, node: sub.length > 0, open: open.has(id) });
      if (sub.length && open.has(id)) walk(sub, depth + 1);
    }
  };
  walk(tree.roots, 0);
  return out;
}
