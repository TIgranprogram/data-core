import seed from './articles-seed.json';

/** Запись `expensearticles` в том виде, как её читают сервисы (id — строка). */
export interface ArticleDoc {
  _id: unknown;
  name: string;
  parentId?: unknown;
  sortOrder?: number;
  code?: string | null;
  categoryIds?: unknown[];
}

export interface SubArticle { id: string; name: string; code?: string; sortOrder: number; categoryIds: string[] }
export interface ArticleNode { id: string; name: string; code?: string; sortOrder: number; children: SubArticle[] }

/** Код системной подстатьи ФОТ: выплаты по сотрудникам попадают сюда сами. */
export const PAYROLL_CODE = 'payroll';
export const PAYROLL_NAME = 'З/п сотрудников (ФОТ)';
/** Статья, куда кладётся системная подстатья ФОТ. */
export const PAYROLL_PARENT = 'Организационные расходы и ФОТ (начислено)';

const bySort = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru');

/** Плоский список записей → дерево «статья → подстатьи» (ровно 2 уровня; подстатья без живой статьи отбрасывается). */
export function buildTree(docs: ArticleDoc[]): ArticleNode[] {
  const top = docs.filter((d) => !d.parentId).map((d) => ({ id: String(d._id), name: String(d.name), ...(d.code ? { code: String(d.code) } : {}), sortOrder: Number(d.sortOrder) || 0, children: [] as SubArticle[] }));
  const byId = new Map(top.map((t) => [t.id, t]));
  for (const d of docs) {
    const parent = d.parentId ? byId.get(String(d.parentId)) : undefined;
    if (!parent) continue;
    parent.children.push({ id: String(d._id), name: String(d.name), ...(d.code ? { code: String(d.code) } : {}), sortOrder: Number(d.sortOrder) || 0, categoryIds: (d.categoryIds ?? []).map(String) });
  }
  for (const t of top) t.children.sort(bySort);
  return top.sort(bySort);
}

/** Стартовый набор: статьи и подстатьи из файла + системная подстатья ФОТ. Идемпотентность — снаружи (сеют только в пустую коллекцию). */
export function seedDocs(now: Date, newId: () => unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  (seed as Array<{ name: string; children: string[] }>).forEach((a, i) => {
    const _id = newId();
    out.push({ _id, name: a.name, parentId: null, sortOrder: (i + 1) * 10, categoryIds: [], deletedAt: null, createdAt: now, updatedAt: now });
    const kids = a.name === PAYROLL_PARENT ? [{ name: PAYROLL_NAME, code: PAYROLL_CODE }, ...a.children.map((name) => ({ name, code: undefined }))] : a.children.map((name) => ({ name, code: undefined }));
    kids.forEach((k, j) => out.push({ _id: newId(), name: k.name, parentId: _id, sortOrder: (j + 1) * 10, ...(k.code ? { code: k.code } : {}), categoryIds: [], deletedAt: null, createdAt: now, updatedAt: now }));
  });
  return out;
}

/** Подстатья по умолчанию для категории заявки (`categoryIds` подстатьи содержит категорию); нет — null. */
export function articleOfCategory(tree: ArticleNode[], categoryId: unknown): SubArticle | null {
  if (!categoryId) return null;
  const cid = String(categoryId);
  for (const t of tree) for (const c of t.children) if (c.categoryIds.includes(cid)) return c;
  return null;
}
