import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { buildTree, PAYROLL_CODE, PAYROLL_NAME, PAYROLL_PARENT, seedDocs, type ArticleDoc, type ArticleNode } from './articles-tree';

const COLL = 'expensearticles';

/** Справочник «Статьи расходов» (2 уровня). Правится через «Справочники» (dicts.defs.ts), здесь — чтение дерева и стартовый набор. */
@Injectable()
export class ExpenseArticlesService implements OnModuleInit {
  private readonly log = new Logger(ExpenseArticlesService.name);

  constructor(@InjectConnection() private readonly connection: Connection, @Optional() private readonly versions?: DataVersionService) {}

  private get coll() { return this.connection.db!.collection(COLL); }

  /** Сид: пустая коллекция — загрузить стартовый набор; системная подстатья ФОТ есть всегда. Повторный запуск ничего не меняет. */
  async onModuleInit(): Promise<void> {
    try { await this.seed(); } catch (e) { this.log.warn(`Статьи расходов не засеяны: ${e instanceof Error ? e.message : e}`); }
  }

  async seed(): Promise<{ seeded: number; payroll: boolean }> {
    let seeded = 0;
    if ((await this.coll.estimatedDocumentCount()) === 0) {
      const docs = seedDocs(new Date(), () => new Types.ObjectId());
      await this.coll.insertMany(docs);
      seeded = docs.length;
    }
    const has = await this.coll.findOne({ code: PAYROLL_CODE });
    if (has) return { seeded, payroll: false };
    const parent = await this.coll.findOne({ name: PAYROLL_PARENT, parentId: null, deletedAt: null });
    if (!parent) { this.log.warn(`Нет статьи «${PAYROLL_PARENT}» — подстатья ФОТ не создана`); return { seeded, payroll: false }; }
    const now = new Date();
    await this.coll.insertOne({ name: PAYROLL_NAME, parentId: parent._id, sortOrder: 0, code: PAYROLL_CODE, categoryIds: [], deletedAt: null, createdAt: now, updatedAt: now });
    return { seeded, payroll: true };
  }

  /** Живые записи (удалённые скрыты), плоско. */
  async docs(): Promise<ArticleDoc[]> {
    return (await this.coll.find({ deletedAt: null }).toArray()) as unknown as ArticleDoc[];
  }

  /** Дерево «статья → подстатьи» (кэш по версии коллекции, если включён). */
  async tree(): Promise<ArticleNode[]> {
    const load = async () => buildTree(await this.docs());
    return this.versions ? this.versions.cached('expense-articles.tree', [COLL], '', load) : load();
  }

  async list() {
    const items = await this.tree();
    return { items, total: items.length };
  }
}
