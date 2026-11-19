import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection, ClientSession } from 'mongoose';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { buildTree, buildFinancialTree, flattenFinancialTree, assertSelectableArticle, type ArticleDoc, type ArticleNode, type FinancialArticleType } from './articles-tree';
import { FinancialArticleWriter } from './financial-article-writer';
import { financialArticleUsage } from './financial-article-usage';
@Injectable()
export class ExpenseArticlesService implements OnModuleInit {
  private readonly log = new Logger(ExpenseArticlesService.name);
  constructor(@InjectConnection() private readonly connection: Connection, @Optional() private readonly versions?: DataVersionService, @Optional() private readonly writer?: FinancialArticleWriter) {}
  async onModuleInit() { try { await this.seed(); } catch (e) { this.log.warn(`Статьи не засеяны: ${e instanceof Error ? e.message : e}`); } }
  async seed() { if (!this.writer) throw new Error('Транзакционная запись статей не подключена'); return this.writer.seed(); }
  async docs(options: { includeDeleted?: boolean; session?: ClientSession } = {}): Promise<ArticleDoc[]> {
    return await this.connection.db!.collection('expensearticles').find(options.includeDeleted ? {} : { deletedAt: null }, { session: options.session }).limit(10001).toArray() as unknown as ArticleDoc[];
  }
  async revision(session?: ClientSession) { return this.writer ? this.writer.revision(session) : 0; }
  async tree(): Promise<ArticleNode[]> {
    const revision = await this.revision(), load = async () => buildTree(await this.docs());
    return this.versions ? this.versions.cached('expense-articles.tree', ['expensearticles', 'counters'], String(revision), load) : load();
  }
  async list() { const items = await this.tree(); return { items, total: items.length }; }
  async financialList(options: { type?: FinancialArticleType; includeArchived?: boolean; includeUsage?: boolean; session?: ClientSession } = {}) {
    const [docs, revision] = await Promise.all([this.docs({ session: options.session }), this.revision(options.session)]);
    const tree = buildFinancialTree(docs, options), nodes = flattenFinancialTree(tree.items), byId = new Map(docs.map(d => [String(d._id), d]));
    // Тяжёлый подсчёт истории — только по действию редактора, не для каждого picker/денежного запроса.
    if (options.includeUsage) {
      const usage = await financialArticleUsage(this.connection, nodes.map(n => byId.get(n.id)!._id), options.session);
      for (const node of nodes) node.usage = usage.get(node.id) || { total: 0, sources: {} };
    }
    return { ...tree, total: nodes.length, revision };
  }
  async assertSelectable(id: unknown, type: FinancialArticleType, options: { session?: ClientSession } = {}): Promise<ArticleDoc> { const docs = await this.docs(options); assertSelectableArticle(docs, id, type); if (options.session) { if (!this.writer) throw new Error('Транзакционная запись статей не подключена'); await this.writer.guardReference(options.session); } return docs.find(d => String(d._id) === String(id))!; }
  async usage(id: unknown) { return (await financialArticleUsage(this.connection, [id])).get(String(id)) || { total: 0, sources: {} }; }
  async write(key: string, action: 'create' | 'update' | 'remove' | 'restore', id: string | undefined, body: Record<string, unknown>) {
    if (!this.writer) throw new Error('Транзакционная запись статей не подключена'); return this.writer.mutate(key, action, id, body);
  }
}
