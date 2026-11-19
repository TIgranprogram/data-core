import seed from './articles-seed.json';
import { BadRequestException } from '@nestjs/common';

/** Запись `expensearticles` в том виде, как её читают сервисы (id — строка). */
export interface ArticleDoc {
  _id: unknown;
  name: string;
  parentId?: unknown;
  sortOrder?: number;
  code?: string | null;
  categoryIds?: unknown[];
  type?: FinancialArticleType; nodeKind?: 'group' | 'article'; selectable?: boolean;
  archivedAt?: unknown; deletedAt?: unknown; version?: number;
}
export type FinancialArticleType = 'income' | 'expense';
export interface FinancialArticleNode extends SubArticle {
  type: FinancialArticleType; nodeKind: 'group' | 'article'; selectable: boolean;
  parentId: string | null; archivedAt: unknown; deletedAt: unknown; version: number;
  usage?: { total: number; sources: Record<string, number> };
  path: string[]; pathIds: string[]; invalidHierarchy?: boolean; children: FinancialArticleNode[];
}

export interface SubArticle { id: string; name: string; code?: string; sortOrder: number; categoryIds: string[]; type?: FinancialArticleType; nodeKind?: 'group' | 'article'; selectable?: boolean; parentId?: string | null; path?: string[]; archivedAt?: unknown; ancestorArchived?: boolean; invalidHierarchy?: boolean }
export interface ArticleNode extends Omit<SubArticle, 'categoryIds'> { categoryIds?: string[]; children: SubArticle[] }

/** Код системной подстатьи ФОТ: выплаты по сотрудникам попадают сюда сами. */
export const PAYROLL_CODE = 'payroll';
export const PAYROLL_GROUP_CODE = 'payroll-group';
export const PAYROLL_NAME = 'З/п сотрудников (ФОТ)';
/** Статья, куда кладётся системная подстатья ФОТ. */
export const PAYROLL_PARENT = 'Организационные расходы и ФОТ (начислено)';

const bySort = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru');

/** Каноническое дерево: повреждённые ветки видны диагностикой, но не предлагаются для новых фактов. */
export function buildFinancialTree(docs: ArticleDoc[], options: { type?: FinancialArticleType; includeArchived?: boolean } = {}) {
  if (docs.length > 10000) throw new BadRequestException('В справочнике больше10000 узлов — нужна сверка');
  const live = docs.filter(d => !d.deletedAt), byId = new Map(live.map(d => [String(d._id), d]));
  const parents = new Set(live.filter(d => d.parentId).map(d => String(d.parentId)));
  const diagnostics: { id: string; message: string }[] = [], nodes = new Map<string, FinancialArticleNode>();
  for (const d of live) {
    const id = String(d._id), chain: ArticleDoc[] = [], seen = new Set<string>(); let cur: ArticleDoc | undefined = d, invalid = false;
    const report = (message: string) => { if (!invalid) diagnostics.push({ id, message }); invalid = true; };
    while (cur) {
      const key = String(cur._id);
      if (seen.has(key) || chain.length >= 32) { report('Цикл или глубина больше32 уровней'); break; }
      const kind = cur.nodeKind || (parents.has(key) || !cur.parentId ? 'group' : 'article');
      if (kind === 'article' && (!cur.parentId || parents.has(key))) report(!cur.parentId ? 'На верхнем уровне разрешена только группа — статье нужна родительская группа' : 'Повреждена родительская ветвь: у статьи-листа есть дочерние узлы');
      seen.add(key); chain.unshift(cur);
      if (!cur.parentId) break;
      const parent = byId.get(String(cur.parentId));
      if (!parent || (parent.type || 'expense') !== (d.type || 'expense')) { report('Родитель отсутствует или имеет другое направление'); break; }
      cur = parent;
    }
    const children = parents.has(id);
    const nodeKind = d.nodeKind || (children || !d.parentId ? 'group' : 'article');
    nodes.set(id, { id, name: String(d.name), ...(d.code ? { code: d.code } : {}), type: d.type || 'expense', nodeKind,
      selectable: !invalid && nodeKind === 'article' && d.selectable !== false, parentId: d.parentId ? String(d.parentId) : null,
      categoryIds: (d.categoryIds || []).map(String), sortOrder: Number(d.sortOrder) || 0, archivedAt: d.archivedAt || null, deletedAt: null,
      version: Number(d.version) || 0, path: chain.map(x => x.name), pathIds: chain.map(x => String(x._id)), ...(invalid ? { invalidHierarchy: true } : {}), children: [] });
  }
  const roots: FinancialArticleNode[] = [];
  for (const n of nodes.values()) { const p = n.parentId ? nodes.get(n.parentId) : null; if (p && !n.invalidHierarchy && !p.invalidHierarchy) p.children.push(n); else roots.push(n); }
  const prune = (rows: FinancialArticleNode[]): FinancialArticleNode[] => rows.filter(n => (!options.type || n.type === options.type) && (options.includeArchived || !n.archivedAt)).map(n => ({ ...n, children: prune(n.children) })).sort(bySort);
  return { items: prune(roots), diagnostics };
}
export function flattenFinancialTree(tree: FinancialArticleNode[]): FinancialArticleNode[] { return tree.flatMap(n => [n, ...flattenFinancialTree(n.children)]); }
export function articleDescendants(tree: FinancialArticleNode[], id: unknown): string[] {
  const node = flattenFinancialTree(tree).find(n => n.id === String(id)); return node ? flattenFinancialTree([node]).map(n => n.id) : [];
}
export function assertSelectableArticle(docs: ArticleDoc[], id: unknown, type: FinancialArticleType): FinancialArticleNode {
  const row = flattenFinancialTree(buildFinancialTree(docs, { includeArchived: true }).items).find(n => n.id === String(id));
  if (!row || !row.parentId || row.invalidHierarchy || row.type !== type || !row.selectable || row.children.length || row.pathIds.some(k => docs.find(d => String(d._id) === k)?.archivedAt)) throw new BadRequestException('Выберите действующую статью подходящего направления из справочника');
  return row;
}
/** Совместимый ID lookup: два уровня, но все потомки и архивные ID сохранены; новый выбор — только по selectable. */
export function buildTree(docs: ArticleDoc[]): ArticleNode[] {
  const items = buildFinancialTree(docs, { type: 'expense', includeArchived: true }).items;
  const byId = new Map(flattenFinancialTree(items).map(n => [n.id, n]));
  return items.map(n => ({ ...n, selectable: false, children: flattenFinancialTree(n.children).map(c => {
    const { children, ...row } = c, ancestorArchived = c.pathIds.some(id => id !== c.id && !!byId.get(id)?.archivedAt);
    return { ...row, name: c.path.length > 2 ? c.path.slice(1).join(' → ') : c.name, ancestorArchived,
      selectable: c.selectable && c.nodeKind === 'article' && !children.length && !c.archivedAt && !ancestorArchived && !c.invalidHierarchy };
  }) }));
}

/** Стартовый набор: статьи и подстатьи из файла + системная подстатья ФОТ. Идемпотентность — снаружи (сеют только в пустую коллекцию). */
export function seedDocs(now: Date, newId: () => unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  (seed as Array<{ name: string; children: string[]; code?: string }>).forEach((a, i) => {
    const _id = newId();
    out.push({ _id, name: a.name, parentId: null, sortOrder: (i + 1) * 10, categoryIds: [], type: 'expense', nodeKind: 'group', selectable: false, version: 0, ...(a.code ? { code: a.code } : {}), deletedAt: null, createdAt: now, updatedAt: now });
    const kids = a.code === PAYROLL_GROUP_CODE ? [{ name: PAYROLL_NAME, code: PAYROLL_CODE }, ...a.children.map((name) => ({ name, code: undefined }))] : a.children.map((name) => ({ name, code: undefined }));
    kids.forEach((k, j) => out.push({ _id: newId(), name: k.name, parentId: _id, sortOrder: (j + 1) * 10, ...(k.code ? { code: k.code } : {}), categoryIds: [], type: 'expense', nodeKind: 'article', selectable: true, version: 0, deletedAt: null, createdAt: now, updatedAt: now }));
  });
  return out;
}

/** Подстатья по умолчанию для категории заявки (`categoryIds` подстатьи содержит категорию); нет — null. */
export function articleOfCategory(tree: ArticleNode[], categoryId: unknown): SubArticle | null {
  if (!categoryId) return null;
  const cid = String(categoryId);
  const found = tree.flatMap(t => t.children).filter(c => c.categoryIds.includes(cid) && c.type !== 'income' && c.nodeKind !== 'group' && c.selectable !== false && !c.archivedAt && !c.ancestorArchived && !c.invalidHierarchy);
  return found.length === 1 ? found[0] : null;
}
