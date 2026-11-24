import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types, ClientSession } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Counter } from '../counter/counter.schema';
import { AuditLog } from '../audit/audit-log.schema';
import { getCurrentUser } from '../../common/context/user-context';
import { FinancialArticle } from './financial-article.schema';
import { FinancialArticleWriteDto } from './financial-article.dto';
import { buildFinancialTree, flattenFinancialTree, seedDocs, PAYROLL_CODE, PAYROLL_NAME, type ArticleDoc, type FinancialArticleType } from './articles-tree';
import { sharedFind } from '../../common/shared-collections';
import { financialArticleUsage } from './financial-article-usage';

type Row = Record<string, any>;
const counterKey = { entity: 'financial-articles-tree', prefix: 'TREE', year: 0 };
const norm = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');
export const FINANCIAL_ARTICLE_KEYS = new Set(['financialArticles', 'expenseArticles', 'incomeArticles']);
export const financialAliasType = (key: string): FinancialArticleType | undefined => key === 'expenseArticles' ? 'expense' : key === 'incomeArticles' ? 'income' : undefined;
@Injectable()
export class FinancialArticleWriter {
  constructor(@InjectConnection() private readonly connection: Connection,
    @InjectModel(FinancialArticle.name) private readonly articles: Model<FinancialArticle>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>) {}
  async revision(session?: ClientSession) { const row = await this.counters.findOne(counterKey).session(session || null).lean().exec(); return Number(row?.seq) || 0; }
  async docs(session?: ClientSession): Promise<ArticleDoc[]> { return await this.articles.find({}).setOptions({ includeSoftDeleted: true }).session(session || null).limit(10001).lean().exec() as unknown as ArticleDoc[]; }
  /** Пишущий валидатор ссылки конфликтует с archive/reparent, не повышая ревизию самого дерева. */
  async guardReference(session: ClientSession) {
    await this.counters.updateOne(counterKey, { $inc: { referenceGuard: 1 }, $setOnInsert: { seq: 0 } }, { session, upsert: true }).exec();
  }
  private conflict(version: unknown, revision: number) { return new ConflictException({ message: 'Статья или дерево изменились — обновите справочник', currentVersion: Number(version) || 0, currentTreeRevision: revision }); }
  private parse(body: Record<string, unknown>, exists: boolean) {
    if (['name', 'type', 'nodeKind', 'selectable', 'sortOrder', 'categoryIds', 'version'].some(key => body?.[key] === null)) throw new BadRequestException('Переданы пустые значения полей статьи — проверьте форму и версии');
    const dto = plainToInstance(FinancialArticleWriteDto, body || {}), errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) throw new BadRequestException({ message: 'Проверьте поля статьи и версии справочника', errors: errors.map(e => ({ field: e.property, message: Object.values(e.constraints || {}).join('; ') })) });
    if (exists && dto.version === undefined) throw new BadRequestException('Обновите статью: нужна её версия');
    return dto;
  }
  private async bump(revision: number, session: ClientSession) {
    if (!revision) {
      const present = await this.counters.findOne(counterKey).session(session).lean().exec();
      if (!present) { await this.counters.create([{ ...counterKey, seq: 1 }], { session }); return; }
    }
    const result = await this.counters.updateOne({ ...counterKey, seq: revision }, { $inc: { seq: 1 } }, { session }).exec();
    if (!result.matchedCount) throw this.conflict(0, await this.revision(session));
  }
  private async log(action: string, before: Row | null, after: Row | null, revision: number, session: ClientSession) {
    const user = getCurrentUser();
    await this.audit.create([{ action, entityType: 'DictItem', entityId: after?._id || before?._id,
      ...(user?.userId && Types.ObjectId.isValid(user.userId) ? { userId: new Types.ObjectId(user.userId), userName: user.username } : {}),
      details: { before: before || {}, after: after || {}, meta: { dict: 'financialArticles', previousTreeRevision: revision, treeRevision: revision + 1 } } }], { session });
  }
  private async assertHintChange(next: Row, previous: Row | undefined, session: ClientSession) {
    const effective = (row?: Row): string[] => row && !row.deletedAt && !row.archivedAt && (row.type || 'expense') === 'expense' && (row.nodeKind || (!row.parentId ? 'group' : 'article')) === 'article' && row.selectable !== false ? (row.categoryIds || []).map(String).sort() : [];
    const old = effective(previous), fresh = effective(next);
    if (JSON.stringify(old) === JSON.stringify(fresh)) return;
    const categories = [...new Set([...old, ...fresh])].map(v => new Types.ObjectId(v));
    if (!categories.length) return;
    const db = this.connection.db!;
    // Раньше без deletedAt: снятая заявка всё ещё держит старую оплату.
    const requests = await sharedFind(db.collection('supplyrequests'), 'supplyrequests', { categoryId: { $in: categories }, $or: [{ articleId: null }, { articleId: '' }] }, { projection: { _id: 1, invoiceId: 1, paid: 1 }, findOptions: { session }, includeDeleted: true }).toArray() as Row[];
    const ids = requests.map(r => r.invoiceId).filter(Boolean), invoices = ids.length ? await db.collection('supplyinvoices').find({ _id: { $in: ids } }, { projection: { status: 1, paymentAccountingVersion: 1, paymentSnapshot: 1, legacyClassifications: 1 }, session }).toArray() : [];
    const byId = new Map(invoices.map(i => [String(i._id), i]));
    const unresolved = requests.filter(r => {
      const inv = byId.get(String(r.invoiceId));
      if (inv?.paymentAccountingVersion === 1 || !(r.paid || inv?.status === 'paid' || inv?.paymentSnapshot?.paidAt)) return false;
      if (inv?.legacyClassifications?.[String(r._id)]?.classificationOriginal) return false;
      return !inv?.paymentSnapshot?.lines?.some((line: Row) => String(line.requestId) === String(r._id) && line.articleId);
    });
    if (unresolved.length) throw new ConflictException({ message: 'Подсказка категории влияет на старые оплаты без закреплённой статьи. Сначала нужна сверка классификации.', code: 'LEGACY_CLASSIFICATION_REVIEW_REQUIRED', plan: { readOnly: true, requestsCount: unresolved.length, requestIds: unresolved.slice(0, 20).map(r => String(r._id)), action: 'Закрепите исходные статьи старых оплат по проверенному плану; денежные факты не меняются' } });
  }
  private async validate(next: Row, docs: Row[], session: ClientSession, previous?: Row) {
    if (!String(next.name || '').trim() || String(next.name).length > 300) throw new BadRequestException('Укажите название до300 символов');
    const id = String(next._id), live = docs.filter(d => !d.deletedAt && String(d._id) !== id), children = live.filter(d => String(d.parentId || '') === id);
    if (next.nodeKind === 'article' && !next.parentId) throw new BadRequestException({ message: 'Выберите родительскую группу для статьи. На верхнем уровне можно создать только группу.', code: 'ARTICLE_PARENT_REQUIRED', missing: [{ key: 'parentId', label: 'Родительская группа' }] });
    if (next.nodeKind === 'group' && next.selectable) throw new BadRequestException('Группа не выбирается как новая статья');
    if (next.nodeKind === 'article' && children.length) throw new ConflictException('У статьи есть дочерние узлы — сначала перенесите их');
    if (next.code === PAYROLL_CODE && next.type !== 'expense') throw new ConflictException('Системная статья ФОТ остаётся расходной');
    if (previous?.code && next.code !== previous.code) throw new ConflictException('Машинный код статьи не меняется');
    if (next.parentId) {
      const parent = live.find(d => String(d._id) === String(next.parentId));
      if (!parent || parent.archivedAt || (parent.type || 'expense') !== next.type || (parent.nodeKind || (!parent.parentId || live.some(d => String(d.parentId || '') === String(parent._id)) ? 'group' : 'article')) !== 'group') throw new BadRequestException('Выберите действующую родительскую группу того же направления');
    }
    const affected = new Set([id]); for (let i = 0; i < 32; i++) { const before = affected.size; for (const d of live) if (affected.has(String(d.parentId || ''))) affected.add(String(d._id)); if (affected.size === before) break; }
    const graph = buildFinancialTree([...live, next] as ArticleDoc[], { includeArchived: true });
    const path = flattenFinancialTree(graph.items).find(n => n.id === id)?.pathIds || [];
    if (next.parentId && path.some(k => k !== id && live.find(d => String(d._id) === k)?.archivedAt)) throw new BadRequestException('Родительская ветка архивная — выберите действующую группу');
    if (graph.diagnostics.some(d => affected.has(d.id))) throw new BadRequestException('Перенос создаёт цикл, недоступного родителя или превышает32 уровня');
    const duplicate = live.find(d => !d.archivedAt && !next.archivedAt && (d.type || 'expense') === next.type && String(d.parentId || '') === String(next.parentId || '') && norm(d.name) === norm(next.name));
    if (duplicate) throw new ConflictException('Статья с таким названием уже есть в этой группе');
    if (next.archivedAt && children.some(d => !d.archivedAt)) throw new ConflictException('У группы есть активные дети — сначала перенесите или архивируйте их');
    if (previous && (previous.type || 'expense') !== next.type) {
      const usage = await financialArticleUsage(this.connection, [next._id], session);
      if (children.length || (usage.get(id)?.total || 0) > 0) throw new ConflictException('Направление используемой статьи не меняется — нужна отдельная сверка');
    }
    await this.assertHintChange(next, previous, session);
    const changedCategories = JSON.stringify((previous?.categoryIds || []).map(String).sort()) !== JSON.stringify((next.categoryIds || []).map(String).sort());
    if (changedCategories && next.categoryIds?.length && (next.type !== 'expense' || next.nodeKind !== 'article' || !next.selectable)) throw new BadRequestException('Новые подсказки категорий доступны только выбираемой расходной статье');
    if (next.categoryIds?.length) {
      const count = await this.connection.db!.collection('categories').countDocuments({ _id: { $in: next.categoryIds }, deletedAt: null }, { session });
      if (count !== next.categoryIds.length) throw new BadRequestException('Категория склада не найдена');
    }
  }
  async mutate(key: string, action: 'create' | 'update' | 'remove' | 'restore', id: string | undefined, body: Record<string, unknown>) {
    const dto = this.parse(body, action !== 'create'), aliasType = financialAliasType(key);
    if (id && !Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный ID статьи');
    const session = await this.connection.startSession(); let resultId = id;
    try { await session.withTransaction(async () => {
      const revision = await this.revision(session), docs = await this.docs(session) as Row[];
      const cur = id ? docs.find(d => String(d._id) === id) : null;
      if (id && (!cur || (aliasType && (cur.type || 'expense') !== aliasType))) throw new NotFoundException('Статья не найдена');
      if (dto.expectedTreeRevision !== revision || (cur && dto.version !== Number(cur.version || 0))) throw this.conflict(cur?.version, revision);
      if (cur?.deletedAt && action !== 'restore') throw new ConflictException('Статья удалена — сначала восстановите её');
      const now = new Date(), parentId = dto.parentId === undefined ? cur?.parentId || null : dto.parentId ? new Types.ObjectId(dto.parentId) : null;
      const parent = parentId ? docs.find(d => String(d._id) === String(parentId)) : null;
      const type = dto.type || cur?.type || aliasType || parent?.type || 'expense';
      if (aliasType && type !== aliasType) throw new BadRequestException('Этот адрес справочника принимает только своё направление');
      const next: Row = { ...(cur || {}), _id: cur?._id || new Types.ObjectId(), name: dto.name === undefined ? cur?.name : dto.name.trim(), type, parentId,
        nodeKind: dto.nodeKind || cur?.nodeKind || (cur && (!cur.parentId || docs.some(d => !d.deletedAt && String(d.parentId || '') === String(cur._id))) ? 'group' : parentId ? 'article' : 'group'),
        selectable: dto.selectable ?? cur?.selectable ?? !!parentId, sortOrder: dto.sortOrder ?? cur?.sortOrder ?? 0,
        categoryIds: dto.categoryIds === undefined ? cur?.categoryIds || [] : [...new Set(dto.categoryIds)].map(v => new Types.ObjectId(v)),
        archivedAt: dto.archivedAt === undefined ? cur?.archivedAt || null : dto.archivedAt ? new Date(dto.archivedAt) : null,
        deletedAt: action === 'remove' ? now : null, version: cur ? Number(cur.version || 0) + 1 : 0, ...(cur ? {} : { createdAt: now }), updatedAt: now };
      if (next.nodeKind === 'group') next.selectable = false;
      if ((action === 'remove' || action === 'restore') && Object.keys(body).some(k => !['version', 'expectedTreeRevision'].includes(k))) throw new BadRequestException('Для удаления и восстановления передайте только версии');
      if (action === 'remove') {
        await this.assertHintChange(next, cur || undefined, session);
        if (cur?.code) throw new ConflictException('Системную статью нельзя удалять');
        if (docs.some(d => !d.deletedAt && String(d.parentId || '') === id)) throw new ConflictException('У группы есть дочерние узлы — сначала перенесите их');
        if ((await financialArticleUsage(this.connection, [next._id], session)).get(String(next._id))?.total) throw new ConflictException('Статья используется — архивируйте её вместо удаления');
      } else await this.validate(next, docs, session, cur || undefined);
      await this.bump(revision, session);
      if (cur) {
        const { _id, ...set } = next;
        const versionMatch = cur.version === undefined ? { $or: [{ version: 0 }, { version: { $exists: false } }] } : { version: Number(cur.version) };
        const changed = await this.articles.updateOne({ _id, ...versionMatch }, { $set: set }, { session }).exec();
        if (!changed.matchedCount) throw this.conflict(cur.version, revision);
      } else await this.articles.create([next], { session });
      await this.log('financialArticle.' + action, cur || null, next, revision, session); resultId = String(next._id);
    }); } catch (error) { if ((error as { code?: number }).code === 11000) throw this.conflict(0, await this.revision()); throw error; }
    finally { await session.endSession(); }
    return resultId!;
  }
  async seed() {
    const session = await this.connection.startSession(); let result = { seeded: 0, payroll: false };
    try { await session.withTransaction(async () => {
      const docs = await this.docs(session) as Row[], revision = await this.revision(session), now = new Date();
      let insert: Row[] = [];
      if (!docs.length) insert = seedDocs(now, () => new Types.ObjectId());
      else if (!docs.some(d => d.code === PAYROLL_CODE)) {
        let parent = docs.find(d => d.code === 'payroll-group' && !d.deletedAt);
        if (!parent) { parent = { _id: new Types.ObjectId(), name: 'Оплата труда и персонал', code: 'payroll-group', type: 'expense', nodeKind: 'group', selectable: false, parentId: null, categoryIds: [], version: 0, deletedAt: null, sortOrder: 0, createdAt: now, updatedAt: now }; insert.push(parent); }
        insert.push({ _id: new Types.ObjectId(), name: PAYROLL_NAME, code: PAYROLL_CODE, type: 'expense', nodeKind: 'article', selectable: true, parentId: parent._id, categoryIds: [], version: 0, deletedAt: null, sortOrder: 0, createdAt: now, updatedAt: now });
      }
      if (!insert.length) { if (!(await this.counters.findOne(counterKey).session(session).lean().exec())) await this.counters.create([{ ...counterKey, seq: 0 }], { session }); result = { seeded: 0, payroll: false }; return; }
      const graph = buildFinancialTree([...docs, ...insert] as ArticleDoc[], { includeArchived: true });
      if (graph.diagnostics.some(d => insert.some(n => String(n._id) === d.id))) throw new BadRequestException('Системные статьи требуют сверки дерева');
      await this.bump(revision, session); await this.articles.insertMany(insert, { session, ordered: true });
      await this.log('financialArticle.seed', null, { insertedIds: insert.map(d => d._id) }, revision, session);
      result = { seeded: docs.length ? 0 : insert.length, payroll: !!docs.length };
    }); return result; } finally { await session.endSession(); }
  }
}
