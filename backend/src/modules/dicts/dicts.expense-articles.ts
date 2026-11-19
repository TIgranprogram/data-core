import { ConflictException } from '@nestjs/common';
import type { DictBase } from './dicts.defs';
import { financialArticleUsage } from '../expense-articles/financial-article-usage';
/** Aliases одной коллекции. Все записи выполняет FinancialArticleWriter. */
export function expenseArticlesDef(key = 'expenseArticles'): DictBase {
  const type = key === 'expenseArticles' ? 'expense' : key === 'incomeArticles' ? 'income' : null;
  return { key, group: 'Деньги', title: type === 'expense' ? 'Статьи расходов' : type === 'income' ? 'Статьи доходов' : 'Статьи доходов и расходов',
    hint: 'Группы и статьи можно переименовывать, переносить и архивировать с сохранением ID и денежных фактов.', coll: 'expensearticles',
    match: { deletedAt: null, ...(type === 'expense' ? { $or: [{ type: 'expense' }, { type: { $exists: false } }] } : type ? { type } : {}) },
    columns: [{ key: 'parentName', label: 'Группа' }], fields: [{ key: 'name', label: 'Название', required: true }, { key: 'categoryIds', label: 'Категории склада', type: 'select', ref: 'categories', multi: true }],
    name: d => String(d.name || ''), row: d => ({ name: d.name, type: d.type || 'expense', parentId: d.parentId ? String(d.parentId) : null,
      nodeKind: d.nodeKind || (!d.parentId ? 'group' : 'article'), selectable: d.selectable ?? !!d.parentId, archivedAt: d.archivedAt || null, deletedAt: d.deletedAt || null,
      categoryIds: (d.categoryIds || []).map(String), sortOrder: Number(d.sortOrder) || 0, version: Number(d.version) || 0, ...(d.code ? { code: d.code } : {}) }),
    toDoc: async () => { throw new ConflictException('Изменение статьи выполняется через единый сервис дерева'); },
    usage: async (db, docs) => new Map([...(await financialArticleUsage({ db }, docs.map(d => d._id)))].map(([id, usage]) => [id, usage.total])),
    related: async (db, d) => { const u = (await financialArticleUsage({ db }, [d._id])).get(String(d._id)); return { title: 'Связи статьи', total: u?.total || 0, items: [] }; },
    reassign: async () => { throw new ConflictException('Объединение финансовых статей недоступно — используйте перенос или архив'); } };
}
