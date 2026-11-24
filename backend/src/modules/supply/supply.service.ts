import { claimStockLinks, withOrderWrite } from '../../common/order-archive/write';
import type { DirectReceiptTarget } from './cost-center';
import { invoicePaymentSummaries as loadInvoicePaymentSummaries } from './invoice-payment-summary';
import { hasUndatedPayment, undatedLocked } from './undated-payment';
import { normText } from '../../common/text/norm-text';
import { ExpenseArticlesService } from '../expense-articles/expense-articles.service';
import { expenseArticleMatch } from './expense-article-filter';
import { photoToFront } from '../../common/photo-main';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CounterService } from '../counter/counter.service';
import { AuditService } from '../audit/audit.service';
import { adminOverride, assertAdminActor, overrideConfirm, type OverridePlan, type OverrideActor } from '../../common/admin-override';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { customerNames } from '../partners/customer-names';
import { DICT, type Doc } from '../dicts/dicts.defs';
import { searchTokens, tokenRegex } from '../../common/text/search-norm';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { dateRange, oid, oids, parseList } from '../../common/list-query';
import type { StockScope } from '../../common/stock-scope';
import { assertDocInScope, assertNewDocInScope, docScopeMatch } from '../../common/supply-scope';
import { createHash } from 'crypto';
import { CategoryResolver } from '../../common/catalog/category-resolver';
import { materialRequestTitle } from '../../common/catalog/names';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductionOrdersService } from '../salesorders/production-orders.service';
import { StockService } from '../stock/stock.service';
import { ZonesService } from '../zones/zones.service';
import { personLabel } from '../zones/zone-routing';
import { requestReturn, requestReturnText } from './supply-notices';
import { OrgResolver } from './org-resolver';
import { topSupplier } from '../stock/purchase-history';
import { SupplierAliases } from './supplier-aliases';
import { labelFromPriority, labelFromStatus, priorityFromLabel, statusFromLabel } from './supply-labels';
import { SupplyRequest, SupplyRequestDocument } from './supply-request.schema';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import { SUPPLY_REQUEST_API_FLAG } from './supply-request-flag';

/** Заявки пачкой: тело `POST /supply/requests/bulk`. */
export interface SupplyBulkInput {
  clientUid: string;
  items: Array<{ materialId: string; qty: number; supplierId?: string }>;
}

export interface SupplyInput {
  title?: string;
  qty?: number;
  unit?: string;
  num?: number;
  requestDate?: string;
  categoryId?: string;
  categoryName?: string;
  /** Статья расхода (id подстатьи); null или '' — снять. */
  articleId?: string | null;
  materialId?: string;
  supplierName?: string;
  /** Поставщик по id (заявки пачкой): организация должна существовать; в публичный DTO не входит. */
  supplierId?: string;
  companyName?: string;
  orderLabel?: string;
  salesOrderId?: string;
  salesOrderLineId?: string;
  costCenter?: string;
  costObject?: string;
  requestedBy?: string;
  responsibleId?: string;
  article?: string;
  color?: string;
  productUrl?: string;
  priceHint?: number;
  invoiceNo?: string;
  /** Дата счёта: ГГГГ-ММ-ДД / дд.мм.гггг; '' — очистить. */
  invoiceDate?: string;
  /** Тип счёта (поля в схеме CRM нет — лежит в sheetExtra.invoiceType, как из таблицы). */
  invoiceType?: string;
  deliveryNote?: string;
  notes?: string;
  /** Русская подпись статуса («✅ Заказать», «💰 Оплачено»…) — переводится в status + paid. */
  statusLabel?: string;
  /** Срочно / Обычный / Низко. */
  priorityLabel?: string;
  /** Фото заявки — весь список (заменяет прежний). */
  photoIds?: string[];
  clientUid?: string;
  /** Причина обхода блока администратором (ЗЯ-1) — в заявку не пишется, уходит в журнал. */
  reason?: string;
}

/** Сегодня, 00:00 UTC — как даты из таблицы и из формы (иначе сортировка «по дате» путает заявки одного дня). */
const todayUtc = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

/** Поля, по которым можно сортировать список заявок. */
const SUPPLY_SORT = ['num', 'requestDate', 'invoiceDate', 'invoiceNo', 'title', 'qty', 'priceHint', 'status', 'requestedBy', 'createdAt', 'updatedAt', 'deletedAt'];

/**
 * Заявки снабжения на ОБЩЕЙ коллекции CRM `supplyrequests`. Поставщик и «наша компания» —
 * организации (находятся по названию или создаются). Оприходование — как receive() в kppdf:
 * приход на склад + статус «received».
 */
@Injectable()
export class SupplyService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SupplyRequest.name) private readonly model: Model<SupplyRequestDocument>,
    private readonly stock: StockService,
    private readonly notices: NotificationsService,
    private readonly orders: ProductionOrdersService,
    private readonly counters: CounterService,
    @Optional() private readonly versions?: DataVersionService,
    @Optional() private readonly zones?: ZonesService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly financialArticles?: ExpenseArticlesService,
    @Optional() private readonly flags?: FeatureFlagService,
  ) {}

  /** C262: выкл — CRM снова может писать Mongo. Маршрут при этом остаётся и отвечает 409. Приход и откат флаг не смотрит. */
  private async assertRequestApi() {
    const on = this.flags ? await this.flags.isEnabled(SUPPLY_REQUEST_API_FLAG) : false;
    if (!on) {
      throw new ConflictException('Флаг c262.supply.requests.api выключен: заявку снова пишет CRM в Mongo. Маршруты API не сняты.');
    }
  }

  /** Итоги оплат счетов для календаря: сумма и число платежей, без истории. */
  invoicePaymentSummaries(ids: unknown[], visibleRequestIds?: unknown[]) {
    return loadInvoicePaymentSummaries(this.connection, ids, visibleRequestIds);
  }

  private async withArticleReference<T>(id: unknown, write: (session?: ClientSession) => Promise<T>, forceSession = false): Promise<T> {
    if (!id && !forceSession) return write();
    const session = await this.connection.startSession(); let result!: T;
    try { await session.withTransaction(async () => { if (id) await this.financialArticles!.assertSelectable(String(id), 'expense', { session }); result = await write(session); }); } finally { await session.endSession(); }
    return result;
  }

  private async claimRequest(id: unknown, session: ClientSession, next: { salesOrderId?: unknown; salesOrderLineId?: unknown } = {}) {
    const row = await this.model.findOne({ _id: id }, { salesOrderId: 1, salesOrderLineId: 1 })
      .setOptions({ includeSoftDeleted: true }).session(session).lean().exec();
    await claimStockLinks(this.connection.db!, session, row ? [row, next] : [next]);
  }

  private async writeRequest<T>(id: Types.ObjectId | string, run: (session: ClientSession) => Promise<T>) {
    return withOrderWrite(this.connection, [], async session => {
      await this.claimRequest(id, session);
      return run(session);
    });
  }

  private async markInvoiceReceiptBoundary(invoiceId: unknown, session: ClientSession) {
    const invoices = this.connection.db!.collection('supplyinvoices');
    const id = typeof invoiceId === 'string' ? oid(invoiceId, 'счёта') : invoiceId as Types.ObjectId;
    const result = await invoices.updateOne(
      { _id: id, deletedAt: null, $or: [{ receiptBoundaryAt: null }, { receiptBoundaryAt: { $exists: false } }] },
      { $set: { receiptBoundaryAt: new Date() }, $inc: { version: 1 } }, { session },
    );
    if (result.matchedCount) return;
    const existing = await invoices.findOne({ _id: id, deletedAt: null }, { projection: { receiptBoundaryAt: 1 }, session });
    if (!existing) throw new BadRequestException('Связанный счёт не найден — приёмка отменена');
    if (!existing.receiptBoundaryAt) throw new ConflictException('Счёт изменился во время приёмки — обновите карточку и повторите');
    await invoices.updateOne({ _id: id, deletedAt: null }, { $inc: { version: 1 } }, { session });
  }

  private async names(coll: string, ids: unknown[]) {
    const oids = [...new Set(ids.filter(Boolean).map(String))].filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
    if (!oids.length) return new Map<string, string>();
    const docs = await this.connection.db!.collection(coll).find({ _id: { $in: oids } }, { projection: { name: 1, shortName: 1 } }).toArray();
    return new Map(docs.map((d) => [String(d._id), String(d.shortName || d.name)]));
  }

  /** Сумма записи счёта: invoiceId → amount (карточка счёта на доске, когда у позиций нет цены). */
  private async invoiceInfo(ids: unknown[]) {
    const oids = [...new Set(ids.filter(Boolean).map(String))].filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
    if (!oids.length) return new Map<string, { amount?: number; note?: string; deliveryDate?: Date; undatedPaymentEvidence?: { state?: string } }>();
    const docs = await this.connection.db!.collection<{ amount?: number; note?: string; deliveryDate?: Date; undatedPaymentEvidence?: { state?: string } }>('supplyinvoices').find({ _id: { $in: oids }, deletedAt: null }, { projection: { amount: 1, note: 1, deliveryDate: 1, 'undatedPaymentEvidence.state': 1 } }).toArray();
    return new Map(docs.map((d) => [String(d._id), d]));
  }

  /** Позиции склада одним запросом: materialId → название и главное фото { url, thumb }. */
  private async materialInfo(ids: unknown[]) {
    const names = new Map<string, string>();
    const oidsList = [...new Set(ids.filter(Boolean).map(String))].filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
    if (!oidsList.length) return { names, photos: new Map<string, { url: string; thumb: string }>() };
    const mats = await this.connection.db!.collection('materials').find({ _id: { $in: oidsList } }, { projection: { name: 1, shortName: 1, mainPhotoId: 1, photoIds: 1 } }).toArray();
    for (const m of mats) names.set(String(m._id), String(m.shortName || m.name));
    const main = new Map(mats.map((m) => [String(m._id), (m.mainPhotoId ?? (m.photoIds as Types.ObjectId[] | undefined)?.[0]) as Types.ObjectId | undefined]).filter(([, p]) => p) as Array<[string, Types.ObjectId]>);
    return { names, photos: await this.photoUrls(main) };
  }

  /** ключ → id фото  ⇒  ключ → { url, thumb } (превью — вариант thumb, иначе оригинал). */
  private async photoUrls(byKey: Map<string, Types.ObjectId>) {
    const out = new Map<string, { url: string; thumb: string }>();
    if (!byKey.size) return out;
    const db = this.connection.db!;
    const pids = [...byKey.values()];
    const [orig, thumbs] = await Promise.all([
      db.collection('photos').find({ _id: { $in: pids } }, { projection: { storageUrl: 1 } }).toArray(),
      db.collection('photos').find({ parentPhotoId: { $in: pids }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    ]);
    const url = new Map(orig.map((p) => [String(p._id), String(p.storageUrl)]));
    const th = new Map(thumbs.map((t) => [String(t.parentPhotoId), String(t.storageUrl)]));
    for (const [k, p] of byKey) { const u = url.get(String(p)); if (u) out.set(k, { url: u, thumb: th.get(String(p)) ?? u }); }
    return out;
  }

  /** Вид для клиента: ObjectId → названия, статус и приоритет — подписями. */
  private async present(docs: Array<Record<string, unknown>>) {
    // Свои фото заявки (загружены в приложении или из «Справочника») — photoIds, вне схемы CRM
    const ownIds = (d: Record<string, unknown>) => (d.photoIds as Types.ObjectId[] | undefined) ?? [];
    // позиции склада читаются один раз (названия + главное фото); все чтения независимы — разом
    const [sup, cat, art, { names: mat, photos: photo }, inv, own] = await Promise.all([
      this.names('organizations', docs.flatMap((d) => [d.supplierId, d.companyId])),
      this.names('categories', docs.map((d) => d.categoryId)),
      this.names('expensearticles', docs.map((d) => d.articleId)),
      this.materialInfo(docs.map((d) => d.materialId)),
      this.invoiceInfo(docs.map((d) => d.invoiceId)),
      this.photoUrls(new Map(docs.flatMap((d) => ownIds(d)).map((p) => [String(p), p] as [string, Types.ObjectId]))),
    ]);
    return docs.map((d) => ({
      ...d,
      id: String(d._id), _id: String(d._id),
      supplierName: d.supplierId ? sup.get(String(d.supplierId)) ?? null : null,
      companyName: d.companyId ? sup.get(String(d.companyId)) ?? null : null,
      categoryName: d.categoryId ? cat.get(String(d.categoryId)) ?? null : null,
      articleId: d.articleId ? String(d.articleId) : null,
      articleName: d.articleId ? art.get(String(d.articleId)) ?? null : null,
      materialName: d.materialId ? mat.get(String(d.materialId)) ?? null : null,
      statusLabel: labelFromStatus(d.status as string, d.paid as boolean),
      priorityLabel: labelFromPriority(d.priority as string),
      invoiceAmount: inv.get(String(d.invoiceId))?.amount ?? null,
      invoiceRequiresPaymentDate: inv.get(String(d.invoiceId))?.undatedPaymentEvidence?.state === 'pending',
      invoicePaymentState: inv.get(String(d.invoiceId))?.undatedPaymentEvidence?.state === 'pending' ? 'date_required' : undefined,
      invoiceNote: inv.get(String(d.invoiceId))?.note ?? null,
      invoiceDeliveryDate: inv.get(String(d.invoiceId))?.deliveryDate ?? null,
      invoiceType: (d.sheetExtra as { invoiceType?: string } | undefined)?.invoiceType ?? null,
      /** Свои фото заявки: [{ id, url, thumb }] — их можно добавлять и убирать. */
      photos: ownIds(d).filter((p) => own.has(String(p))).map((p) => ({ id: String(p), ...own.get(String(p))! })),
      /** Главное фото для списка: первое своё, иначе главное фото позиции склада. */
      photo: own.get(String(ownIds(d).find((p) => own.has(String(p))))) ?? (d.materialId ? photo.get(String(d.materialId)) : undefined) ?? null,
      /** Фото позиции склада (если заявка к ней привязана) — показывается, когда своих нет. */
      materialPhoto: (d.materialId ? photo.get(String(d.materialId)) : undefined) ?? null,
    }));
  }

  /** Проверить, что фото загружены, и вернуть их ObjectId (без дублей, по порядку). */
  private async photoOids(ids: string[]) {
    const list = [...new Set(ids.map(String))].map((i) => oid(i, 'фото'));
    if (!list.length) return list;
    const found = await this.connection.db!.collection('photos').find({ _id: { $in: list } }, { projection: { mimeType: 1 } }).toArray();
    if (found.length !== list.length) throw new NotFoundException('Фото не найдено — загрузите ещё раз');
    if (found.some((p) => p.mimeType === 'application/pdf')) throw new BadRequestException('Нужна картинка');
    return list;
  }

  /** photoIds — поле вне схемы CRM: пишется с strict:false (иначе Mongoose его отбросит), схему не меняем. */
  private async writePhotos(_id: Types.ObjectId, update: { $set?: { photoIds: Types.ObjectId[] }; $addToSet?: { photoIds: Types.ObjectId }; $pull?: { photoIds: Types.ObjectId } }) {
    const res = await this.writeRequest(_id, session => this.model.updateOne({ _id, deletedAt: null }, { ...update, $set: { ...update.$set, editedInApp: true } }, { strict: false, session }).exec());
    if (!res.matchedCount) throw new NotFoundException('Заявка не найдена');
  }

  async addPhoto(id: string, photoId: string) {
    const _id = oid(id, 'заявки');
    const [pid] = await this.photoOids([photoId]);
    await this.writePhotos(_id, { $addToSet: { photoIds: pid } });
    return this.get(id);
  }

  async mainPhoto(id: string, photoId: string) {
    const _id = oid(id, 'заявки');
    await this.writeRequest(_id, session => photoToFront((f, u) => this.model.updateOne(f, u, { session }).exec(), { _id, deletedAt: null }, oid(photoId, 'фото')));
    return this.get(id);
  }

  async removePhoto(id: string, photoId: string) {
    const _id = oid(id, 'заявки');
    await this.writePhotos(_id, { $pull: { photoIds: oid(photoId, 'фото') } });
    return this.get(id);
  }

  /**
   * Список (CANON §4): страницы, поиск, сортировка, фильтры; `sum` — сумма «Цены с НДС» по всему фильтру.
   * status — через запятую; `paid` — подпись «Оплачено» (status=ordered + paid). deleted=1 — корзина.
   */
  async list(q: Record<string, unknown> = {}, scope: StockScope | null = null) {
    const p = parseList(q, { sortable: SUPPLY_SORT, defaultSort: '-requestDate', defaultLimit: 1000 });
    const filter: Record<string, unknown> = { deletedAt: p.deleted ? { $ne: null } : null };
    const and: Record<string, unknown>[] = [];
    let statusCond: Record<string, unknown> | undefined;
    if (q.status) {
      const or = String(q.status).split(',').map((s) => s.trim()).filter(Boolean).map((s) =>
        s === 'paid' ? { status: 'ordered', paid: true } : s === 'ordered' ? { status: 'ordered', paid: { $ne: true } } : { status: s });
      if (or.length) { statusCond = { $or: or }; and.push(statusCond); }
    }
    if (q.supplierId) filter.supplierId = { $in: oids(q.supplierId) };
    // needsFill=1 — «не попадают в выплаты» (те же условия, что «Деньги → Требуют заполнения»): нет суммы при дате счёта,
    // нет даты счёта при сумме, или нет нашей компании; отменённые не считаются
    if (q.needsFill) {
      const ours = (await this.connection.db!.collection('organizations').find({ isOurCompany: true, deletedAt: null }, { projection: { _id: 1 } }).toArray()).map((o) => o._id);
      and.push({ status: { $ne: 'cancelled' } });
      and.push({ $or: [
        { invoiceDate: { $ne: null }, $or: [{ priceHint: null }, { priceHint: { $exists: false } }, { priceHint: { $lte: 0 } }] },
        { priceHint: { $gt: 0 }, $or: [{ invoiceDate: null }, { invoiceDate: { $exists: false } }] }, { paid: true, $or: [{ priceHint: null }, { priceHint: { $exists: false } }, { priceHint: { $lte: 0 } }] }, // оплачено без суммы — в календарь не попало
        { invoiceDate: { $ne: null }, priceHint: { $gt: 0 }, $or: [{ companyId: null }, { companyId: { $exists: false } }, { companyId: { $nin: ours } }] },
      ] });
    }
    if (q.articleId) and.push(await expenseArticleMatch(this.connection, String(q.articleId)));
    if (q.categoryId) filter.categoryId = { $in: oids(q.categoryId) };
    if (q.materialId) filter.materialId = { $in: oids(q.materialId) };
    if (q.salesOrderId) filter.salesOrderId = { $in: oids(q.salesOrderId) };
    if (q.requestedBy) filter.requestedBy = String(q.requestedBy);
    if (q.priority) filter.priority = String(q.priority);
    const range = dateRange(q.from, q.to);
    if (range) filter.requestDate = range;
    // Поиск «как на складе» (2026-10-20): каждое слово отдельно (И), м10 = M10, по наименованию, №, поставщику, артикулу, счёту, заказчику, примечанию
    if (q.search && String(q.search).trim()) {
      const tokens = searchTokens(q.search);
      const fields = ['title', 'article', 'orderLabel', 'notes', 'requestedBy', 'invoiceNo', 'color'];
      const orgs = await this.connection.db!.collection('organizations').find({}, { projection: { name: 1, shortName: 1 } }).toArray();
      for (const tk of tokens) {
        const re = tokenRegex(tk);
        const or: Record<string, unknown>[] = fields.map((fl) => ({ [fl]: re }));
        const sup = orgs.filter((o) => re.test(String(o.name ?? '')) || re.test(String(o.shortName ?? ''))).map((o) => o._id);
        if (sup.length) or.push({ supplierId: { $in: sup } });
        const n = Number(tk.replace(/^№/, ''));
        if (Number.isInteger(n) && n > 0) or.push({ num: n });
        and.push({ $or: or });
      }
    }
    // склады (WZ): заявки только доступных позиций / категорий
    const sc = await docScopeMatch(this.connection, scope);
    if (scope) and.push(sc);
    // Счётчики по статусам (для чипов) — по всем фильтрам, кроме самого статуса
    const noStatus: Record<string, unknown> = { ...filter };
    const restAnd = and.filter((c) => c !== statusCond);
    if (restAnd.length) noStatus.$and = restAnd;
    if (and.length) filter.$and = and;
    // Дополнительный порядок для равных значений — не перебивая выбранное поле
    const sort: Record<string, 1 | -1> = { ...p.sort };
    if (!('num' in sort)) sort.num = -1;
    sort._id = -1;
    // сумма и счётчики не зависят от страницы и сортировки — кэш по версии данных и фильтру (без page/limit/sort)
    const totals = async () => Promise.all([
      // «Итого» без отменённых, если их не выбрали явно (как в подсказке: отменённые в расчёты не идут)
      this.model.aggregate([{ $match: statusCond ? filter : { $and: [filter, { status: { $ne: 'cancelled' } }] } }, { $group: { _id: null, sum: { $sum: { $ifNull: ['$priceHint', 0] } } } }]).exec(),
      this.model.aggregate([{ $match: noStatus }, { $group: { _id: { s: '$status', p: { $eq: ['$paid', true] } }, n: { $sum: 1 } } }]).exec(),
    ]);
    const pure = { ...Object.fromEntries(Object.entries(q).filter(([k]) => !['page', 'limit', 'sort', 'facets'].includes(k))), ...(scope ? { _scope: createHash('sha1').update(JSON.stringify(sc)).digest('hex') } : {}) };
    const [docs, total, [agg, byStatus]] = await Promise.all([
      this.model.find(filter).setOptions({ includeSoftDeleted: true }).sort(sort).allowDiskUse(true).skip(p.skip).limit(p.limit).lean().exec(), // без индекса под сортировку Mongo 4.4 упирается в 32 МБ памяти («Sort operation used more than…») — разрешаем диск
      this.model.countDocuments(filter).setOptions({ includeSoftDeleted: true }).exec(),
      this.versions ? this.versions.cached('supply.totals', ['supplyrequests', 'organizations'], JSON.stringify(pure), totals) : totals(),
    ]);
    const counts: Record<string, number> = { all: 0 };
    for (const g of byStatus as Array<{ _id: { s: string; p: boolean }; n: number }>) {
      const k = g._id.s === 'ordered' && g._id.p ? 'paid' : g._id.s || 'requested';
      counts[k] = (counts[k] ?? 0) + g.n;
      counts.all += g.n;
    }
    const out = { items: await this.present(docs as Array<Record<string, unknown>>), total, page: p.page, limit: p.limit, sum: agg[0]?.sum ?? 0, counts };
    if (q.facets !== '1' && q.facets !== 1) return out;
    // Б4 (воронка): поставщик / категория / кто подал — с числом заявок при остальных выбранных фильтрах; поле дополнительное
    const tally = async (field: string) => {
      const m: Record<string, unknown> = { ...filter }; delete m[field];
      const rows = await this.model.aggregate([{ $match: { ...m, [field]: { $nin: [null, ''] } } }, { $group: { _id: '$' + field, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 200 }]).exec() as Array<{ _id: unknown; n: number }>;
      return rows;
    };
    const [sup, cat, who] = await Promise.all([tally('supplierId'), tally('categoryId'), tally('requestedBy')]);
    const [supN, catN] = await Promise.all([this.names('organizations', sup.map((r) => r._id)), this.names('categories', cat.map((r) => r._id))]);
    return { ...out, facets: {
      supplierId: sup.map((r) => ({ value: String(r._id), label: supN.get(String(r._id)) ?? '—', n: r.n })),
      categoryId: cat.map((r) => ({ value: String(r._id), label: catN.get(String(r._id)) ?? '—', n: r.n })),
      requestedBy: who.map((r) => ({ value: String(r._id), n: r.n })),
    } };
  }

  /** Строки счёта — заявки с invoiceId, в виде для клиента. */
  async byInvoice(invoiceId: Types.ObjectId) {
    const docs = await this.model.find({ invoiceId, deletedAt: null }).sort({ num: 1, _id: 1 }).lean().exec();
    return this.present(docs as Array<Record<string, unknown>>);
  }

  /** Склады (WZ): заявка должна быть доступной позиции / категории, иначе 403 (запись и чтение по id). Корзина тоже. */
  async assertRequest(id: string, scope: StockScope | null): Promise<void> {
    if (!scope) return;
    const doc = await this.model.findOne({ _id: oid(id, 'заявки') }, { materialId: 1, categoryId: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (doc) await assertDocInScope(this.connection, scope, doc);
  }

  /** Склады (WZ): новая заявка или смена позиции / категории — только своего склада. */
  assertNew(dto: SupplyInput, scope: StockScope | null) {
    return assertNewDocInScope(this.connection, scope, dto.materialId || dto.categoryId || dto.categoryName ? dto : {});
  }

  async get(id: string, scope?: StockScope | null) {
    const doc = await this.model.findOne({ _id: oid(id, 'заявки'), deletedAt: null }).lean().exec();
    if (!doc) throw new NotFoundException('Заявка не найдена');
    await assertDocInScope(this.connection, scope, doc);
    const presented = (await this.present([doc as Record<string, unknown>]))[0] as Record<string, unknown>;
    // СКЕ-4/5: текущая цена и история цен из каталога (supplieritems по supplierId+article+color)
    if (doc.supplierId && doc.article) {
      const item = await this.connection.db!.collection('supplieritems').findOne(
        { supplierId: doc.supplierId, article: (doc.article as string).trim(), color: ((doc.color as string) || '').trim(), deletedAt: null },
        { projection: { priceHint: 1, priceHistory: 1 } },
      );
      if (item?.priceHint != null) presented.catalogCurrentPrice = item.priceHint as number;
      if (Array.isArray(item?.priceHistory) && (item.priceHistory as unknown[]).length) {
        presented.catalogPriceHistory = (item.priceHistory as Array<{ price: number; date: Date; source: string }>)
          .slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      }
    }
    return presented;
  }

  /** В корзину (мягко). Приход на склад по заявке, если был, остаётся — его отменяют на складе. */
  async remove(id: string) {
    await this.assertRequestApi();
    // строка счёта: удаление сломало бы сумму счёта и оплату — сначала убрать из счёта (пересчёт и журнал там)
    const cur = await this.model.findOne({ _id: oid(id, 'заявки'), deletedAt: null }, { invoiceId: 1, paid: 1 }).lean().exec() as { invoiceId?: unknown; paid?: boolean } | null;
    if (cur?.invoiceId) throw new BadRequestException('Заявка входит в счёт — сначала уберите её из счёта (кнопка «Убрать» в счёте)');
    if (cur?.paid) throw new BadRequestException('Заявка оплачена — сначала снимите оплату (статус «В работе»), потом удаляйте');
    const res = await this.writeRequest(id, session => this.model.updateOne({ _id: oid(id, 'заявки'), deletedAt: null }, { $set: { deletedAt: new Date(), editedInApp: true } }, { session }).exec());
    if (!res.matchedCount) throw new NotFoundException('Заявка не найдена');
    return { id, deleted: true };
  }

  async restore(id: string) {
    const res = await this.writeRequest(id, session => this.model.updateOne({ _id: oid(id, 'заявки'), deletedAt: { $ne: null } }, { $set: { deletedAt: null, editedInApp: true } }, { session })
      .setOptions({ includeSoftDeleted: true }).exec());
    if (!res.matchedCount) throw new NotFoundException('Заявки нет в корзине');
    return this.get(id);
  }

  /** Поля формы → поля схемы CRM (общая часть create/update). */
  private async toFields(dto: SupplyInput): Promise<Record<string, unknown>> {
    const f: Record<string, unknown> = {};
    const str = (k: keyof SupplyInput, to: string = k) => { if (dto[k] !== undefined) f[to] = String(dto[k] ?? '').trim() || undefined; };
    str('title'); str('unit'); str('orderLabel'); str('requestedBy'); str('article'); str('color'); str('productUrl'); str('invoiceNo'); str('deliveryNote'); str('notes');
    // Привязка к заказу заказчика: id проверяется; подпись заказа пишется в orderLabel — её видит и CRM
    if (dto.salesOrderId !== undefined) {
      if (dto.salesOrderId && Types.ObjectId.isValid(dto.salesOrderId)) {
        const so = await this.connection.db!.collection('salesorders').findOne({ _id: new Types.ObjectId(dto.salesOrderId), deletedAt: null });
        if (!so) throw new BadRequestException('Заказ не найден');
        f.salesOrderId = so._id;
        if (dto.orderLabel === undefined) f.orderLabel = `Заказ № ${so.orderNo}${so.customer ? ' · ' + so.customer : ''}`;
      } else { f.salesOrderId = undefined; f.salesOrderLineId = undefined; }
    }
    if (dto.salesOrderLineId !== undefined) f.salesOrderLineId = dto.salesOrderLineId && Types.ObjectId.isValid(dto.salesOrderLineId) ? new Types.ObjectId(dto.salesOrderLineId) : undefined;
    if (dto.costCenter !== undefined) f.costCenter = dto.costCenter || undefined;
    if (dto.costObject !== undefined) f.costObject = String(dto.costObject ?? '').trim() || undefined;
    if (dto.responsibleId !== undefined) {
      if (!dto.responsibleId) f.responsibleId = undefined;
      else {
        if (!Types.ObjectId.isValid(dto.responsibleId)) throw new BadRequestException('Ответственный — выберите сотрудника из списка');
        const p = await this.connection.db!.collection('persons').findOne({ _id: new Types.ObjectId(dto.responsibleId), deletedAt: null }, { projection: { lastName: 1, firstName: 1, patronymic: 1 } });
        if (!p) throw new BadRequestException('Сотрудник не найден — выберите из списка');
        f.responsibleId = p._id;
        f.responsible = personLabel(p); // текст — для CRM, она читает его
      }
    }
    if (dto.qty !== undefined) f.qty = Number(dto.qty);
    if (dto.priceHint !== undefined) f.priceHint = dto.priceHint === null ? null : Number(dto.priceHint); // null — сумму стёрли (В.7)
    if (dto.num !== undefined) f.num = Number(dto.num);
    if (dto.requestDate) f.requestDate = new Date(dto.requestDate);
    if (dto.invoiceDate !== undefined) {
      const d = parseSheetDate(dto.invoiceDate);
      if (dto.invoiceDate && !d) throw new BadRequestException('Дата счёта — в формате ДД.ММ.ГГГГ');
      f.invoiceDate = d; // undefined → поле очищается
    }
    if (dto.categoryId && Types.ObjectId.isValid(dto.categoryId)) f.categoryId = new Types.ObjectId(dto.categoryId);
    else if (dto.categoryName !== undefined) f.categoryId = await new CategoryResolver(this.connection).resolve(dto.categoryName);
    if (dto.articleId !== undefined) {
      if (!dto.articleId) f.articleId = undefined;
      else {
        const a = await this.financialArticles!.assertSelectable(dto.articleId, 'expense');
        f.articleId = a._id;
      }
    }
    if (dto.materialId && Types.ObjectId.isValid(dto.materialId)) f.materialId = new Types.ObjectId(dto.materialId);
    const orgs = new OrgResolver(this.connection);
    if (dto.supplierId) f.supplierId = new Types.ObjectId(dto.supplierId);
    else if (dto.supplierName !== undefined) f.supplierId = await orgs.resolve(dto.supplierName, 'supplier');
    if (dto.companyName !== undefined) f.companyId = await orgs.resolve(dto.companyName, 'own');
    if (dto.statusLabel !== undefined) {
      const s = statusFromLabel(dto.statusLabel);
      if (s) { f.status = s.status; f.paid = !!s.paid; if (s.paid) f.paidAt = new Date(); }
    }
    if (dto.priorityLabel !== undefined) f.priority = priorityFromLabel(dto.priorityLabel) ?? 'normal';
    if (dto.invoiceType !== undefined) f['sheetExtra.invoiceType'] = String(dto.invoiceType ?? '').trim() || undefined;
    return f;
  }

  async create(dto: SupplyInput, userId?: string, scope?: StockScope | null) {
    await this.assertRequestApi();
    if (dto.clientUid) {
      const dup = await this.model.findOne({ clientUid: dto.clientUid }).lean().exec();
      if (dup) return this.get(String(dup._id), scope);
    }
    const fields = await this.toFields(dto);
    if (fields.status === 'received') throw new BadRequestException('«Получено» ставится только кнопкой «Принять» — так товар приходует на склад и ничего не теряется (создайте заявку, затем нажмите «Принять» в её карточке)');
    if (!fields.title && !fields.materialId) throw new BadRequestException('Укажите наименование');
    // ТИ-8 Н-1: выбрана позиция склада, названия нет — «в счёте», если заполнено, иначе короткое
    if (!fields.title && fields.materialId) {
      const m = await this.connection.db!.collection('materials').findOne({ _id: fields.materialId as Types.ObjectId }, { projection: { name: 1, invoiceName: 1 } });
      if (m) fields.title = materialRequestTitle(m as { name?: string; invoiceName?: string });
    }
    const photoIds = dto.photoIds ? await this.photoOids(dto.photoIds) : [];
    if (fields.num === undefined) {
      // номер из счётчика, засеянного текущим максимумом: два одновременных создателя не получат одно число (HARDEN-1 п.11)
      const last = await this.model.findOne({ num: { $ne: null } }).sort({ num: -1 }).lean().exec();
      await this.counters.setSeqAtLeast('SupplyRequest', 'N', Number(last?.num) || 0);
      fields.num = await this.counters.nextSeq('SupplyRequest', 'N');
    }
    const document = {
      status: 'requested', priority: 'normal', qty: 1, paid: false, requestDate: todayUtc(),
      ...Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== undefined && k !== 'sheetExtra.invoiceType')),
      ...(fields['sheetExtra.invoiceType'] ? { sheetExtra: { invoiceType: fields['sheetExtra.invoiceType'] } } : {}),
      clientUid: dto.clientUid,
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
    };
    const persist = async (session?: ClientSession, materialId?: Types.ObjectId) => {
      const request = materialId ? { ...document, materialId } : document;
      if (!session) return this.model.create(request);
      await claimStockLinks(this.connection.db!, session, [fields]);
      const [created] = await this.model.create([request], { session });
      if (photoIds.length) await this.model.updateOne({ _id: created._id }, { $set: { photoIds } }, { session, strict: false }).exec();
      return created;
    };
    const doc = fields.materialId
      ? await this.withArticleReference(fields.articleId, persist, !!(fields.salesOrderId || fields.salesOrderLineId || photoIds.length))
      : await this.stock.withRequestMaterial({
        name: String(fields.title),
        unit: fields.unit as string | undefined,
        categoryId: fields.categoryId as Types.ObjectId | undefined,
      }, scope, async (materialId, session) => {
        if (dto.clientUid) {
          const previous = await this.model.findOne({ clientUid: dto.clientUid }).session(session).exec();
          if (previous) return previous;
        }
        if (fields.articleId) await this.financialArticles!.assertSelectable(String(fields.articleId), 'expense', { session });
        return persist(session, materialId);
      });
    await this.adoptArticle(doc as unknown as Record<string, unknown>);
    await this.afterCreate(doc as unknown as Record<string, unknown>, userId);
    return this.get(String(doc._id), scope);
  }

  /**
   * Заявки пачкой (C036 Ш3): по строке на позицию. Поставщик — из прошлых закупок (чаще, затем свежее), цена — последняя у него
   * за единицу × количество, иначе из прайса (`supplieritems`). Всё проверяется до записи; повтор с тем же `clientUid` отдаёт те же заявки.
   * Флаг C262 не отдельный: каждая строка идёт через `create()`.
   */
  async createBulk(dto: SupplyBulkInput, scope: StockScope | null, userId?: string) {
    const db = this.connection.db!;
    const ids = dto.items.map((i) => oid(i.materialId, 'позиции'));
    if (new Set(ids.map(String)).size !== ids.length) throw new BadRequestException('Одна позиция указана дважды — объедините количество в одну строку');
    const found = await db.collection('materials').find({ _id: { $in: ids }, deletedAt: null }, { projection: { _id: 1, unit: 1 } }).toArray();
    if (found.length !== ids.length) throw new BadRequestException('Некоторых позиций нет в каталоге — обновите список и повторите');
    const units = new Map(found.map((m) => [String(m._id), String(m.unit ?? '').trim()]));
    for (const i of dto.items) await this.assertNew({ materialId: i.materialId }, scope);
    const given = [...new Set(dto.items.map((i) => i.supplierId).filter(Boolean) as string[])].map((s) => oid(s, 'поставщика'));
    if (given.length && (await db.collection('organizations').countDocuments({ _id: { $in: given }, deletedAt: null })) !== given.length) throw new BadRequestException('Поставщик не найден — выберите из списка');
    const history = await this.stock.purchaseSuppliers(ids);
    const prices = await db.collection('supplieritems').find({ materialId: { $in: ids }, deletedAt: null, priceHint: { $gt: 0 } }, { projection: { materialId: 1, supplierId: 1, priceHint: 1 } }).toArray();
    const items: unknown[] = [];
    for (const [n, line] of dto.items.entries()) {
      const past = history.get(String(ids[n])) ?? [];
      const supplierId = line.supplierId ?? (topSupplier(past)?.supplierId ? String(topSupplier(past)!.supplierId) : undefined);
      const unit = supplierId
        ? past.find((s) => String(s.supplierId) === supplierId)?.lastPrice
          ?? prices.find((p) => String(p.materialId) === String(ids[n]) && String(p.supplierId) === supplierId)?.priceHint
        : undefined;
      items.push(await this.create({
        materialId: line.materialId, qty: line.qty, ...(supplierId ? { supplierId } : {}),
        unit: units.get(String(ids[n])) || undefined,
        ...(Number(unit) > 0 ? { priceHint: Math.round(Number(unit) * line.qty * 100) / 100 } : {}), // в заявке — сумма, не цена за единицу
        clientUid: `${dto.clientUid}:${line.materialId}`,
      }, userId));
    }
    return { items, total: items.length };
  }

  /** ЗО-3/5: новая заявка — личному ответственному, иначе людям зоны «Снабжение», иначе руководству («Не назначено»). Ошибки не пробрасываются. */
  private async afterCreate(doc: Record<string, unknown>, actorId?: string) {
    try {
      if (doc.responsibleId) await this.zones?.recordHandoff({ entity: 'supplyrequest', entityId: doc._id, field: 'responsibleId', to: doc.responsibleId, byUserId: actorId });
      await this.zones?.notifyZone('supply', { type: 'request_new', text: `Новая заявка${doc.num ? ' №' + doc.num : ''}: ${doc.title ?? ''}`, href: `#requests?open=${String(doc._id)}` }, { personId: doc.responsibleId, actorId });
    } catch { /* уведомление не должно ломать создание */ }
  }

  /** ЗО-5: смена ответственного — запись передачи и уведомление новому. */
  private async afterResponsible(id: string, prev: unknown, actorId?: string) {
    try {
      const cur = await this.model.findById(id, { responsibleId: 1, num: 1, title: 1 }).lean().exec() as Record<string, unknown> | null;
      if (!cur || String(cur.responsibleId ?? '') === String(prev ?? '')) return;
      await this.zones?.recordHandoff({ entity: 'supplyrequest', entityId: id, field: 'responsibleId', from: prev, to: cur.responsibleId, byUserId: actorId });
      if (cur.responsibleId) await this.zones?.notifyZone('supply', { type: 'request_assigned', text: `Вам передана заявка${cur.num ? ' №' + cur.num : ''}: ${cur.title ?? ''}`, href: `#requests?open=${id}` }, { personId: cur.responsibleId, actorId });
    } catch { /* история и уведомление не ломают правку */ }
  }

  /** АР.2: артикул заявки → в позицию склада, если у той пусто / автоартикул (правила — stock/article.ts). */
  private async adoptArticle(d: Record<string, unknown> | null) {
    if (d?.materialId && d.article) await this.stock.adoptArticle(d.materialId as Types.ObjectId, d.article, `заявка${d.num ? ' №' + d.num : ''}`).catch(() => undefined);
  }

  /** После смены статуса заявки: вернулась/отменена — автору; пересчёт готовности заказа. Ошибки не пробрасываются. */
  private async afterStatus(prev: Record<string, unknown> | null, next: string | undefined, actorId?: string) {
    try {
      if (!prev) return;
      const kind = requestReturn(prev.status as string | undefined, next);
      if (kind && prev.createdBy) await this.notices.safe({ userId: prev.createdBy as Types.ObjectId, type: 'request_returned', text: requestReturnText(kind, prev.num, prev.title, next!), href: `#requests?open=${String(prev._id)}` }, actorId);
      if (prev.salesOrderId) await this.orders.recheck(prev.salesOrderId, actorId);
      // СВ-11: заказано у поставщика — складу «ждите поставку», бухгалтерии «счёт к оплате» (если не оплачено)
      if (next === 'ordered' && prev.status !== 'ordered') {
        const name = `заявка${prev.num ? ' №' + prev.num : ''}: ${prev.title ?? ''}`, href = `#requests?open=${String(prev._id)}`;
        await this.zones?.notifyZone('stock', { type: 'supply_expected', text: `Ждём поставку — принять на склад: ${name}`, href }, { actorId });
        const paid = (await this.model.findById(prev._id, { paid: 1 }).lean().exec() as { paid?: boolean } | null)?.paid;
        if (!paid) await this.zones?.notifyZone('accounting', { type: 'invoice_to_pay', text: `Счёт к оплате: ${name}`, href }, { actorId });
      }
    } catch { /* уведомление не должно ломать операцию */ }
  }

  /**
   * Карточка заявки шлёт форму целиком. У строки счёта неизменённые сумма, количество и наша компания
   * убираются из правки — иначе любое сохранение (примечание, приоритет) упиралось в финансовый замок счёта.
   */
  async dropUnchanged<T extends SupplyInput>(id: string, dto: T): Promise<T> {
    if (!Types.ObjectId.isValid(id) || !['priceHint', 'qty', 'companyName', 'statusLabel'].some((k) => k in dto)) return dto;
    const cur = await this.model.findById(id, { invoiceId: 1, priceHint: 1, qty: 1, companyId: 1, status: 1, paid: 1 }).lean().exec() as Record<string, unknown> | null;
    if (!cur) return dto;
    const out: T = { ...dto };
    // тот же статус: не трогаем paid/paidAt (иначе дата оплаты сдвигалась на «сейчас», а у «Получено» терялась оплата)
    if ('statusLabel' in out) {
      const s = statusFromLabel(out.statusLabel);
      const same = !s || (s.status === cur.status && (['received', 'cancelled'].includes(s.status) || !!s.paid === !!cur.paid));
      if (same) delete out.statusLabel;
    }
    if (!cur.invoiceId) return out;
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 100) / 100);
    if ('priceHint' in out && num(out.priceHint) === num(cur.priceHint)) delete out.priceHint;
    if ('qty' in out && num(out.qty) === num(cur.qty)) delete out.qty;
    if ('companyName' in out) {
      const name = cur.companyId ? (await this.names('organizations', [cur.companyId])).get(String(cur.companyId)) ?? null : null;
      if ((String(out.companyName ?? '').trim() || null) === (name || null)) delete out.companyName;
    }
    return out;
  }

  async update(id: string, dto: SupplyInput, _userRole?: string, actorId?: string) {
    await this.assertRequestApi();
    // менеджер правит суммы заявок (решение 2026-10-29, docs/CHECKLIST-MANAGER-ROLE.md); роли без денег суммы не пришлют — их срезает MoneyMask
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id заявки');
    // Цена и количество строки счёта — только через PATCH строки с пересчётом amount в транзакции.
    // Финансовая блокировка учитывает приёмку любой строки счёта, а не только текущей заявки.
    const financial = ['priceHint', 'qty', 'invoiceNo', 'invoiceDate', 'supplierName', 'supplierId', 'companyName'].some((k) => k in dto);
    if (financial || dto.statusLabel !== undefined) {
      const cur = await this.model.findById(id, { invoiceId: 1, status: 1, paid: 1, invoiceNo: 1, invoiceDate: 1, supplierName: 1, supplierId: 1, companyId: 1 }).lean().exec() as (Record<string, unknown> & { invoiceId?: unknown; status?: string; paid?: boolean }) | null;
      if (cur?.invoiceId) {
        // строка счёта — часть счёта: сумма и количество идут через правку строки (контроллер), реквизиты — общие для счёта
        if ('priceHint' in dto || 'qty' in dto) throw new BadRequestException('Сумма и количество позиции счёта меняются в самом счёте — откройте счёт');
        if (financial) throw new BadRequestException('Номер, дата, поставщик и наша компания — общие для всего счёта. Измените их в самом счёте');
        const next = dto.statusLabel === undefined ? null : statusFromLabel(dto.statusLabel);
        if (next?.status === 'cancelled') throw new BadRequestException('Сначала уберите позицию из счёта (кнопка «Убрать» в счёте), затем отменяйте заявку');
        // статус строки счёта ведёт сам счёт: «Оплачен» — оплатой счёта, «Получено» — «Принять», выход — «Убрать»
        // исключение: приход отменён в «Движениях» — принятая строка возвращается в «В работе» с той же оплатой (HARDEN-1)
        const rollback = cur.status === 'received' && next?.status === 'ordered' && !!next.paid === !!cur.paid;
        if (next && !rollback && next.status !== 'received' && (next.status !== cur.status || !!next.paid !== !!cur.paid)) {
          throw new BadRequestException('Статус позиции счёта меняется в счёте: «Счёт оплачен», «Принять» или «Убрать из счёта»');
        }
      } else if (dto.statusLabel !== undefined && cur?.paid) {
        // отмена оплаченной заявки молча стирала расход из «Денег»
        const next = statusFromLabel(dto.statusLabel);
        if (next?.status === 'cancelled') throw new BadRequestException('Заявка оплачена — сначала снимите оплату (статус «В работе»), потом отменяйте');
      }
    }
    const analytics = ['articleId', 'categoryId', 'salesOrderId', 'costCenter', 'costObject'] as const;
    if (analytics.some(k => dto[k] !== undefined) || dto.categoryName !== undefined) {
      const source = await this.model.findOne({ _id: id, deletedAt: null }).lean().exec() as Record<string, unknown> | null;
      const header = source?.invoiceId ? await this.connection.db!.collection('supplyinvoices').findOne({ _id: source.invoiceId as Types.ObjectId, deletedAt: null }, { projection: { status: 1, paymentAccountingVersion: 1, paymentSnapshot: 1, undatedPaymentEvidence: 1 } }) : null;
      if (header?.undatedPaymentEvidence?.state === 'pending') throw new ConflictException('Сначала укажите дату оплаты или снимите подтверждение');
      const paidTruth = source?.paid || header?.status === 'paid' || !!header?.paymentSnapshot;
      if (source && paidTruth && header?.paymentAccountingVersion !== 1) {
        const changed = analytics.some(k => dto[k] !== undefined && String(dto[k] || '') !== String(source[k] || ''));
        const category = dto.categoryName !== undefined && source.categoryId ? await this.connection.db!.collection('categories').findOne({ _id: source.categoryId as Types.ObjectId }, { projection: { name: 1 } }) : null;
        if (changed || (dto.categoryName !== undefined && normText(dto.categoryName) !== normText(category?.name))) throw new ConflictException({ message: source.invoiceId ? 'Классификацию старой оплаты меняйте отдельным действием в денежных операциях' : 'Старая оплаченная заявка без счёта пока доступна только для просмотра классификации', code: 'CLASSIFICATION_SOURCE_LOCKED' });
      }
    }
    const savedArticle = dto.articleId !== undefined ? await this.model.findOne({ _id: id, deletedAt: null }, { articleId: 1 }).lean().exec() as { articleId?: unknown } | null : null;
    const fields = await this.toFields({ ...dto, ...(savedArticle && String(savedArticle.articleId || '') === String(dto.articleId || '') ? { articleId: undefined } : {}) });
    // «Получено» без прихода на склад запрещено — иначе товар «висит в воздухе» (решение 2026-10-20)
    let resetReceipt = false;
    if (fields.status) {
      const cur = await this.model.findById(id, { status: 1 }).lean().exec();
      if (cur && fields.status === 'received' && cur.status !== 'received') throw new BadRequestException('«Получено» ставится только кнопкой «Принять» — так товар приходует на склад и ничего не теряется');
      // принятая заявка не откатывается правкой статуса: приход на складе остался бы без заявки (HARDEN-1 п.3)
      if (cur && cur.status === 'received' && fields.status !== 'received') {
        // откат разрешён, только когда приход по заявке уже отменён в «Движениях»; формат ссылки — SupplyRequest:<id>
        const active = await this.connection.db!.collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${id}`, type: 'in', cancelledAt: null, deletedAt: null });
        if (active) throw new BadRequestException('Сначала отмените приход в Движениях');
        resetReceipt = true;
      }
    }
    const prev = fields.status ? await this.model.findOne({ _id: id, deletedAt: null }, { status: 1, createdBy: 1, num: 1, title: 1, salesOrderId: 1, paid: 1 }).lean().exec() as Record<string, unknown> | null : null;
    const prevResp = dto.responsibleId !== undefined ? ((await this.model.findOne({ _id: id, deletedAt: null }, { responsibleId: 1 }).lean().exec()) as { responsibleId?: unknown } | null)?.responsibleId : undefined;
    const photoIds = dto.photoIds ? await this.photoOids(dto.photoIds) : undefined;
    const set: Record<string, unknown> = {}, unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(fields)) (v === undefined ? (unset[k] = '') : (set[k] = v));
    set.editedInApp = true;
    if (resetReceipt) Object.assign(unset, { receivedQty: '', receivedAt: '', receivedTo: '', receiveUid: '' });
    if (fields.paid === false) unset.paidAt = '';
    const analyticsWrite = analytics.some(k => dto[k] !== undefined) || dto.categoryName !== undefined;
    const guardedSourceWrite = analyticsWrite || financial || dto.statusLabel !== undefined;
    const res = await this.withArticleReference(set.articleId, async (session) => {
      await this.claimRequest(id, session!, fields);
      if (session && guardedSourceWrite) {
        const row = await this.model.findOne({ _id: id, deletedAt: null }, { invoiceId: 1, status: 1, paid: 1 }).session(session).lean().exec();
        if (row?.invoiceId) {
          if (financial) throw new BadRequestException('Финансовые поля позиции уже относятся к счёту — откройте счёт');
          const rollback = row.status === 'received' && fields.status === 'ordered' && !!fields.paid === !!row.paid;
          if (dto.statusLabel !== undefined && !rollback && ((fields.status !== undefined && fields.status !== row.status) || (fields.paid !== undefined && !!fields.paid !== !!row.paid))) throw new ConflictException('Статус позиции уже ведёт счёт — обновите карточку');
          const touched = await this.connection.db!.collection('supplyinvoices').updateOne({ _id: row.invoiceId as Types.ObjectId, deletedAt: null, 'undatedPaymentEvidence.state': { $ne: 'pending' } }, { $inc: { version: 1 } }, { session });
          if (!touched.matchedCount) throw new ConflictException('Счёт изменился или оплата подтверждена без даты — перечитайте карточку');
        }
      }
      if (photoIds) set.photoIds = photoIds;
      return this.model.updateOne({ _id: id, deletedAt: null }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session, ...(photoIds ? { strict: false } : {}) }).exec();
    }, true);
    if (!res.matchedCount) throw new NotFoundException('Заявка не найдена');
    await this.adoptArticle(await this.model.findById(id, { materialId: 1, article: 1, num: 1 }).lean().exec() as Record<string, unknown> | null);
    await this.afterStatus(prev, fields.status as string | undefined, actorId);
    if (dto.responsibleId !== undefined) await this.afterResponsible(id, prevResp, actorId);
    return this.get(id);
  }

  /**
   * Оприходовать: приход на склад по умолчанию + статус «received» (как receive() в CRM).
   * Нет привязанного материала — находим по наименованию или заводим новую позицию склада.
   * Флаг C262 не смотрит: приход — срез C265.
   */
  async receive(id: string, dto: { qty?: number; clientUid?: string; toStock?: boolean; costCenter?: string; costObject?: string; partial?: boolean; materialId?: string }, userId?: string) {
    const out = await this.receiveRaw(id, dto, userId);
    try {
      const so = await this.model.findById(id, { salesOrderId: 1 }).lean().exec() as { salesOrderId?: unknown } | null;
      if (so?.salesOrderId) await this.orders.recheck(so.salesOrderId, userId);
    } catch { /* пересчёт готовности не должен ломать приход */ }
    return out;
  }

  /** Прямая поставка отмеченных строк. Назначение и факт получения фиксируются одной транзакцией. */
  async receiveInvoiceDirect(invoiceId: string, requestIds: string[], target: DirectReceiptTarget, userId?: string) {
    if (!requestIds.length) throw new BadRequestException('Отметьте позиции, которые получил объект');
    const invoiceKey = oid(invoiceId, 'счёта');
    const orderKey = target.directOrderId ? oid(target.directOrderId, 'заказа') : undefined;
    const costCenter = target.directCostCenter || 'order';
    const costObject = target.directCostObject?.trim();
    const ids = [...new Set(requestIds.map(value => String(oid(value, 'заявки'))))].map(value => new Types.ObjectId(value));
    const count = await withOrderWrite(this.connection, [], async session => {
      const db = this.connection.db!;
      const invoice = await db.collection('supplyinvoices').findOne({ _id: invoiceKey, deletedAt: null }, { session });
      if (!invoice) throw new NotFoundException('Счёт не найден');
      if (invoice.status === 'cancelled') throw new BadRequestException('Счёт отменён');
      const rows = await this.model.find({ _id: { $in: ids }, invoiceId: invoiceKey, deletedAt: null, status: { $ne: 'cancelled' } }).session(session).lean().exec();
      if (rows.length !== ids.length) throw new BadRequestException('Часть позиций уже убрана из счёта или отменена. Обновите карточку');

      const pending = rows.filter(row => {
        const label = row.num == null ? row.title : `Заявка №${row.num}`;
        const sameOrder = orderKey ? String(row.salesOrderId) === String(orderKey) : !row.salesOrderId && !row.salesOrderLineId;
        const sameDestination = sameOrder && row.costCenter === costCenter && (costObject === undefined || costObject === (row.costObject || ''));
        if (row.status === 'received') {
          if (row.receivedTo === 'direct' && sameDestination) return false;
          throw new ConflictException(`${label} уже получена по другому месту приёмки`);
        }
        if ((row.salesOrderId || (!orderKey && row.salesOrderLineId)) && !sameOrder) {
          throw new ConflictException(orderKey
            ? `${label} связана с другим заказом. Отметьте позиции одного заказа`
            : `${label} уже связана с заказом. Для неё выберите этот заказ`);
        }
        if (Number(row.receivedQty) > 0) throw new ConflictException(`${label} уже частично принята. Для прямой поставки остатка нужна отдельная позиция`);
        if (!(Number(row.qty) > 0)) throw new BadRequestException(`${label}: укажите количество`);
        if (hasUndatedPayment(invoice) && !sameDestination) throw undatedLocked();
        return true;
      });
      if (!pending.length) return 0;
      let orderLabel: string | undefined;
      if (orderKey) {
        await claimStockLinks(db, session, [...pending, { salesOrderId: orderKey }]);
        const order = await db.collection('salesorders').findOne({ _id: orderKey, deletedAt: null, stage: { $ne: 'cancelled' } }, { session });
        if (!order) throw new BadRequestException('Заказ не найден или отменён');
        orderLabel = `Заказ № ${order.productionNo || order.orderNo || '—'}${order.customer ? ' · ' + order.customer : ''}`;
        const lineIds = pending.flatMap(row => row.salesOrderLineId ? [row.salesOrderLineId] : []);
        if (lineIds.length) {
          const count = await db.collection('incomes').countDocuments({ _id: { $in: lineIds }, orderId: orderKey, deletedAt: null }, { session });
          if (count !== new Set(lineIds.map(String)).size) throw new ConflictException('Часть отметок относится к позициям другого заказа');
        }
      }

      await this.markInvoiceReceiptBoundary(invoiceKey, session);
      const at = new Date();
      for (const row of pending) {
        const written = await this.model.updateOne({ _id: row._id, invoiceId: invoiceKey, qty: row.qty, status: row.status, deletedAt: null }, { $set: {
          ...(orderKey ? { salesOrderId: orderKey, orderLabel } : {}),
          costCenter, ...(costObject ? { costObject } : {}), status: 'received', receivedTo: 'direct',
          receivedQty: Number(row.qty), receivedAt: at, editedInApp: true,
        }, ...(!costObject && (costObject === '' || (!orderKey && row.costCenter !== costCenter)) ? { $unset: { costObject: '' } } : {}) }, { session }).exec();
        if (!written.matchedCount) throw new ConflictException('Позиция изменилась во время приёмки. Обновите счёт');
      }
      return pending.length;
    });
    if (count && orderKey) {
      try { await this.orders.recheck(orderKey, userId); } catch { /* пересчёт готовности не меняет факт поставки */ }
    }
    return count;
  }

  /**
   * ЗЯ-1 п.2: «Откатить приёмку» (только администратор). dryRun / без confirm — план с warnings[];
   * confirm + причина — сервер сам отменяет приход на склад (cancelMovement), сбрасывает received*
   * и возвращает заявку в работу. Остатка не хватает (товар уже израсходован) — блок, склад в минус не уходит.
   * Флаг C262 не смотрит: откат прихода — срез C265.
   */
  async rollbackReceipt(id: string, dto: { confirm?: boolean; reason?: string }, actor: OverrideActor, dryRun = false) {
    assertAdminActor(actor, 'Откат приёмки');
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id заявки');
    const doc = await this.model.findOne({ _id: id, deletedAt: null }).lean().exec() as (Record<string, unknown> & { status?: string; title?: string; unit?: string; qty?: number; paid?: boolean; invoiceId?: unknown; receivedQty?: number; receivedTo?: string; salesOrderId?: unknown }) | null;
    if (!doc) throw new NotFoundException('Заявка не найдена');
    if (doc.status !== 'received') throw new BadRequestException('Заявка не принята на склад — откатывать нечего');
    const moves = await this.connection.db!.collection('stockmovements').find({ documentRef: `SupplyRequest:${id}`, type: 'in', cancelledAt: null, deletedAt: null }).toArray();
    const warnings: string[] = [], blockers: string[] = [];
    const unit = doc.unit ? ` ${doc.unit}` : '';
    const byMaterial = new Map<string, number>();
    for (const m of moves) byMaterial.set(String(m.materialId), (byMaterial.get(String(m.materialId)) ?? 0) + (Number(m.delta ?? m.qty) || 0));
    if (!moves.length) warnings.push(`Товар «${doc.title ?? 'позиция'}» не приходовался на склад (${doc.receivedTo === 'direct' ? 'ушёл сразу в работу' : 'приход уже отменён'}) — склад не изменится, заявка вернётся в работу`);
    for (const [materialId, qty] of byMaterial) {
      warnings.push(`Приход ${qty}${unit} «${doc.title ?? 'позиция'}» будет отменён — остаток на складе уменьшится на ${qty}`);
      const have = Number((await this.stock.getItem(materialId) as { quantity?: number }).quantity) || 0;
      if (have < qty) blockers.push(`Остатка не хватает: на складе ${have}${unit}, а приход ${qty}${unit}. Сначала верните или спишите обратно, потом откатывайте приёмку`);
    }
    if (doc.invoiceId) warnings.push('Строка останется в счёте, статус вернётся на «В работе»; если принятых строк в счёте больше нет, счёт снова можно править');
    if (dryRun) return { dryRun: true, canProceed: !blockers.length, warnings, blockers, relatedAction: 'Отмена прихода на склад и возврат заявки в работу' } satisfies OverridePlan;
    const reason = overrideConfirm(dto);
    if (blockers.length) throw new ConflictException(blockers[0]);
    const status = doc.invoiceId || doc.paid ? 'ordered' : 'requested';
    await this.writeRequest(id, async session => {
    for (const m of moves) await this.stock.cancelMovement(String(m._id), actor.id, session);
    const change = await this.model.updateOne({ _id: id, deletedAt: null, status: 'received' }, { $set: { status, editedInApp: true }, $unset: { receivedQty: '', receivedAt: '', receivedTo: '', receiveUid: '' } }, { session }).exec();
    if (!change.matchedCount) throw new ConflictException('Приёмка уже изменилась');
    if (doc.invoiceId) {
      // принятых строк в счёте не осталось — снимаем границу приёмки (счёт снова можно править)
      const left = await this.model.countDocuments({ invoiceId: doc.invoiceId, deletedAt: null, status: 'received' }).session(session).exec();
      if (!(left > 0)) await this.connection.db!.collection('supplyinvoices').updateOne({ _id: doc.invoiceId }, { $unset: { receiptBoundaryAt: '' }, $inc: { version: 1 } }, { session });
    }
    });
    await adminOverride(this.audit, {
      rule: 'supply.receipt_rollback', entityType: 'SupplyRequest', entityId: id,
      before: { status: 'received', receivedQty: doc.receivedQty ?? null, receivedTo: doc.receivedTo ?? null, movements: moves.map((m) => String(m._id)) },
      after: { status, cancelledQty: [...byMaterial.values()].reduce((t, q) => t + q, 0) }, reason, actor,
    });
    try { if (doc.salesOrderId) await this.orders.recheck(doc.salesOrderId, actor.id); } catch { /* пересчёт готовности не должен ломать откат */ }
    return this.get(id);
  }

  private async receiveRaw(id: string, dto: { qty?: number; clientUid?: string; toStock?: boolean; costCenter?: string; costObject?: string; partial?: boolean; materialId?: string }, userId?: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id заявки');
    const doc = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!doc) throw new NotFoundException('Заявка не найдена');
    const prevUid = (doc as unknown as { receiveUid?: string }).receiveUid;
    if (doc.status === 'received') {
      if (dto.clientUid && (doc as unknown as { receiveUid?: string }).receiveUid === dto.clientUid) return this.get(id);
      throw new ConflictException('Заявка уже отмечена как полученная');
    }
    if (doc.status === 'cancelled') throw new BadRequestException('Заявка отменена — принять её нельзя. Верните статус «Заказать» или создайте новую заявку');
    const qty = Number(dto.qty ?? doc.qty);
    if (!(qty > 0)) throw new BadRequestException('Укажите количество');

    if (dto.partial && dto.clientUid && prevUid === dto.clientUid) return this.get(id);
    const initial = doc as unknown as { invoiceId?: Types.ObjectId; costCenter?: string; costObject?: string };
    const assertPendingBasis = (invoice: Record<string, unknown>, source: { qty?: number; costCenter?: string; costObject?: string }) => {
      if (!hasUndatedPayment(invoice)) return;
      if ((dto.partial && qty < Number(source.qty)) || (dto.costCenter !== undefined && dto.costCenter !== (source.costCenter || '')) || (dto.costObject !== undefined && dto.costObject.trim() !== (source.costObject || ''))) throw undatedLocked();
    };
    // Ранний отказ до создания каталога; гарантия от late-attach ниже, внутри транзакции.
    if (initial.invoiceId) {
      const header = await this.connection.db!.collection('supplyinvoices').findOne({ _id: initial.invoiceId, deletedAt: null });
      if (header) assertPendingBasis(header, doc);
    }
    const receiptMaterial: { id?: Types.ObjectId } = {};
    const writeReceipt = async (session: ClientSession) => {
      const fresh = await this.model.findOne({ _id: doc._id, deletedAt: null }).session(session).lean().exec() as (SupplyRequest & { _id: Types.ObjectId; receiveUid?: string }) | null;
      if (!fresh) throw new NotFoundException('Заявка не найдена');
      await claimStockLinks(this.connection.db!, session, [fresh]);
      if (fresh.status === 'received') {
        if (dto.toStock === false && dto.clientUid && fresh.receiveUid === dto.clientUid) return;
        throw new ConflictException('Заявка уже отмечена как полученная');
      }
      if (fresh.status === 'cancelled' || Number(fresh.qty) !== Number(doc.qty)) throw new ConflictException('Заявка изменилась во время приёмки — обновите карточку');
      if (dto.partial && dto.clientUid && fresh.receiveUid === dto.clientUid) throw new ConflictException('Эта часть уже принята — обновите карточку');
      const header = fresh.invoiceId ? await this.connection.db!.collection('supplyinvoices').findOne({ _id: fresh.invoiceId, deletedAt: null }, { session }) : null;
      if (fresh.invoiceId && !header) throw new BadRequestException('Связанный счёт не найден — приёмка отменена');
      if (header) {
        assertPendingBasis(header, fresh);
        await this.markInvoiceReceiptBoundary(fresh.invoiceId, session);
      }
      const partial = dto.toStock !== false && !!dto.partial && qty < Number(fresh.qty);
      const costCenter = dto.costCenter || fresh.costCenter || (fresh.salesOrderId ? 'order' : 'workshop');
      const costObject = dto.costObject?.trim() || fresh.costObject;
      const set = {
        ...(!header || !hasUndatedPayment(header) ? { costCenter, ...(costObject ? { costObject } : {}) } : {}),
        ...(receiptMaterial.id ? { materialId: receiptMaterial.id } : {}),
        ...(partial ? { qty: Math.round((Number(fresh.qty) - qty) * 1000) / 1000, receivedQty: Math.round(((Number(fresh.receivedQty) || 0) + qty) * 1000) / 1000 } : { status: 'received', receivedQty: qty, receivedAt: new Date(), receivedTo: dto.toStock === false ? 'direct' : 'stock' }),
        editedInApp: true, ...(dto.clientUid ? { receiveUid: dto.clientUid } : {}),
      };
      // Пишем саму заявку в той же транзакции: attach/detach тоже пишет её и получает write-conflict.
      const written = await this.model.updateOne({ _id: fresh._id, deletedAt: null, invoiceId: fresh.invoiceId || null, qty: fresh.qty, status: fresh.status }, { $set: set }, { session }).exec();
      if (!written.matchedCount) throw new ConflictException('Привязка или количество заявки изменились — обновите карточку');
    };
    if (dto.toStock === false) {
      const session = await this.connection.startSession();
      try { await session.withTransaction(() => writeReceipt(session)); } finally { await session.endSession(); }
      return this.get(id);
    }
    let materialId = (dto.materialId && Types.ObjectId.isValid(dto.materialId)) ? dto.materialId : (doc.materialId ? String(doc.materialId) : '');
    if (!materialId) {
      const name = doc.title?.trim();
      if (!name) throw new BadRequestException('У заявки нет наименования');
      const cat = doc.categoryId ? await this.connection.db!.collection('categories').findOne({ _id: doc.categoryId }) : null;
      const item = await this.stock.createItem({ name, unit: doc.unit, article: doc.article, categoryName: cat?.name as string | undefined, invoiceName: name });
      materialId = item.id;
    }
    receiptMaterial.id = new Types.ObjectId(materialId);
    const partial = !!dto.partial && qty < Number(doc.qty);
    const cancelled = dto.clientUid || partial ? 0 : await this.connection.db!.collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${id}`, cancelledAt: { $ne: null } });
    const movement = { type: 'in' as const, qty, note: `Приход по заявке${doc.num ? ' №' + doc.num : ''}${partial ? ' (часть)' : ''}`, documentRef: `SupplyRequest:${id}`, clientUid: dto.clientUid ?? (partial ? undefined : `receive:${id}:${doc.receivedQty ?? 0}:${cancelled}`) };
    // Callback обязателен даже для первоначально отдельной заявки: счёт мог появиться во время createItem/move.
    await this.stock.move(materialId, movement, userId, writeReceipt);
    if (!partial && doc.article) await this.stock.adoptArticle(materialId, doc.article, `заявка${doc.num ? ' №' + doc.num : ''}`).catch(() => undefined);
    return this.get(id);
  }

  aliases() { return new SupplierAliases(this.connection); }

  /**
   * Лёгкая подсказка «уже заказывали»: по одной строке на название (последняя заявка), без фото и `present`.
   * count — сколько раз заказывали. search — слова через И по названию и артикулу.
   */
  async lookup(q: Record<string, unknown> = {}, scope: StockScope | null = null) {
    const sc = await docScopeMatch(this.connection, scope);
    const limit = Math.min(Math.max(parseInt(String(q.limit ?? ''), 10) || 50, 1), 500);
    const and = searchTokens(q.search).map((tk) => { const re = tokenRegex(tk); return { $or: [{ title: re }, { article: re }] }; });
    const rows = await this.model.aggregate<Record<string, unknown>>([
      { $match: { deletedAt: null, title: { $nin: [null, ''] }, ...sc, ...(and.length ? { $and: and } : {}) } },
      { $sort: { requestDate: -1, _id: -1 } },
      { $group: { _id: { $toLower: '$title' }, last: { $first: '$$ROOT' }, count: { $sum: 1 } } },
      { $sort: { 'last.requestDate': -1, _id: 1 } },
      { $limit: limit },
      { $project: { count: 1, 'last._id': 1, 'last.title': 1, 'last.unit': 1, 'last.article': 1, 'last.categoryId': 1, 'last.supplierId': 1, 'last.priceHint': 1, 'last.materialId': 1 } },
    ]).exec();
    const [sup, cat] = await Promise.all([this.names('organizations', rows.map((r) => (r.last as Doc).supplierId)), this.names('categories', rows.map((r) => (r.last as Doc).categoryId))]);
    const items = rows.map((r) => {
      const d = r.last as Doc;
      return {
        id: String(d._id), title: d.title, unit: d.unit ?? null, article: d.article ?? null,
        categoryId: d.categoryId ? String(d.categoryId) : null, categoryName: d.categoryId ? cat.get(String(d.categoryId)) ?? null : null,
        supplierName: d.supplierId ? sup.get(String(d.supplierId)) ?? null : null, priceHint: d.priceHint ?? null,
        materialId: d.materialId ? String(d.materialId) : null, count: r.count,
      };
    });
    return { items, total: items.length };
  }

  /** Названия поставщиков и «наших компаний» — для подсказок в форме. */
  async lookups(scope: StockScope | null = null) {
    const orgs = await this.connection.db!.collection('organizations')
      .find({ deletedAt: null, $or: [{ type: 'supplier' }, { isOurCompany: true }] }, { projection: { name: 1, shortName: 1, type: 1, isOurCompany: 1 } })
      .sort({ name: 1 }).toArray();
    const own = scope ? { _id: { $in: scope.categoryIds.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x)) } } : {};
    const cats = await this.connection.db!.collection('categories').find({ deletedAt: null, type: 'material', ...own }, { projection: { name: 1 } }).sort({ name: 1 }).toArray();
    const lists = ((await this.connection.db!.collection('settings').findOne({ key: 'supply.sheetLists' }))?.value ?? {}) as Record<string, string[] | undefined>;
    const uniq = (a: unknown[]) => [...new Map(a.filter(Boolean).map((v) => [String(v).trim().toLowerCase().replace(/\s+/g, ' '), String(v).trim()])).values()].sort((x, y) => x.localeCompare(y, 'ru'));
    const people = uniq([...(await this.model.distinct('requestedBy', { deletedAt: null }).exec()), ...(lists.people ?? [])]);
    // ЗЧ.1: заказчики — один источник (контрагенты + заказы), не «всё, что когда-то вписали» и не список таблицы
    const customers = await customerNames(this.connection.db!);
    const sup = orgs.filter((o) => (o.type as string[] | undefined)?.includes('supplier'));
    // «Справочники» (СП.5): заполненный справочник — единственный источник списка; пустой — старые источники
    const dict = async (k: string) => { const d = DICT.get(k)!; return d.options!((await this.connection.db!.collection(d.coll).find(d.match).toArray()) as Doc[]).filter(Boolean); };
    const [dUnits, dPeople, dInvoice, dServices] = await Promise.all(['units', 'persons', 'invoiceTypes', 'services'].map(dict));
    const or = (d: string[], fallback: string[]) => (d.length ? uniq(d) : fallback);
    return {
      suppliers: sup.map((o) => String(o.shortName || o.name)),
      companies: orgs.filter((o) => o.isOurCompany).map((o) => String(o.shortName || o.name)),
      categories: cats.map((c) => ({ id: String(c._id), name: String(c.name) })),
      /** Для фильтров: поставщики с id и «кто подал». */
      supplierRefs: sup.map((o) => ({ id: String(o._id), name: String(o.shortName || o.name) })),
      requestedBy: or(dPeople, people),
      /** Заказчики — контрагенты-заказчики и заказчики заказов (ЗЧ.1, `partners/customer-names.ts`). */
      customers,
      invoiceTypes: or(dInvoice, uniq(['Счет на оплату', 'Счет-договор', 'Счет', 'УПД', ...(lists.invoiceTypes ?? [])])),
      services: or(dServices, lists.services ?? []),
      units: or(dUnits, uniq(lists.units ?? [])),
    };
  }
}
