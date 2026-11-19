import { buildTree, buildFinancialTree, type ArticleDoc, type FinancialArticleNode } from '../expense-articles/articles-tree';
import { buildByArticles, type ByArticlesOpts } from './by-articles';
import type { Op } from './cashflow';
export type ReportRow = { id: string; name: string; type: 'income' | 'expense'; children: ReportRow[]; values: number[]; total: number; virtual?: boolean; articleId?: string; archivedAt?: unknown; path?: string[] };
/** Additive recursive BOTH report; legacy rows/incomeRows retain their original meaning. */
export function buildFinancialArticleReport(ops: Op[], docs: ArticleDoc[], from: string, to: string, today: string, diagnostics: unknown[] = [], options: ByArticlesOpts = { mode: 'company' }) {
  const legacy = buildByArticles(ops, buildTree(docs), Number(from.slice(0, 4)), today, { ...options, from, to });
  const count = legacy.months.length, zero = () => Array.from({ length: count }, () => 0), direct = new Map<string, number[]>();
  const add = (values: number[], index: number, amount: number) => { values[index] = Math.round((values[index] + amount) * 100) / 100; };
  const tree = buildFinancialTree(docs, { includeArchived: true }).items, known = new Map<string, FinancialArticleNode>();
  const collect = (nodes: FinancialArticleNode[]) => { for (const n of nodes) { known.set(n.id, n); collect(n.children); } }; collect(tree);
  for (const op of ops) {
    if (op.date > today || op.date < from || op.date > to || !(op.amount > 0)) continue;
    const index = legacy.months.indexOf(op.date.slice(0, 7)); if (index < 0) continue;
    const node = op.articleId ? known.get(op.articleId) : undefined;
    const id = node?.type === op.type ? node.id : op.type + ':none';
    if (!direct.has(id)) direct.set(id, zero()); add(direct.get(id)!, index, op.amount);
  }

  const make = (node: FinancialArticleNode): ReportRow => {
    const own = direct.get(node.id) || zero(), children = node.children.map(make).filter(n => n.total !== 0);
    const values = [...own]; for (const child of children) child.values.forEach((n, i) => add(values, i, n));
    const ownTotal = Math.round(own.reduce((sum, n) => sum + n, 0) * 100) / 100;
    if ((node.nodeKind === 'group' || node.children.length) && ownTotal) children.unshift({ id: node.id + ':self', articleId: node.id, name: 'Без детализации', type: node.type, values: own, total: ownTotal, children: [], virtual: true });
    return { id: node.id, name: node.name, type: node.type, values, total: Math.round(values.reduce((sum, n) => sum + n, 0) * 100) / 100, children, archivedAt: node.archivedAt, path: node.path };
  };
  const articleRows = tree.map(make).filter(n => n.total !== 0);
  for (const type of ['income', 'expense'] as const) { const values = direct.get(type + ':none'); if (values) articleRows.push({ id: type + ':none', name: 'Без статьи / неизвестная ссылка', type, values, total: Math.round(values.reduce((sum, n) => sum + n, 0) * 100) / 100, children: [], virtual: true }); }
  return { ...legacy, from, to, articleRows, diagnostics };
}
