import { photoToFront } from '../../common/photo-main';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CounterService } from '../counter/counter.service';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { customerNames } from '../partners/customer-names';
import { DICT, type Doc } from '../dicts/dicts.defs';
import { searchTokens, tokenRegex } from '../../common/text/search-norm';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { dateRange, oid, oids, parseList } from '../../common/list-query';
import { CategoryResolver } from '../../common/catalog/category-resolver';
import { materialRequestTitle } from '../../common/catalog/names';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductionOrdersService } from '../salesorders/production-orders.service';
import { StockService } from '../stock/stock.service';
import { ZonesService } from '../zones/zones.service';
import { personLabel } from '../zones/zone-routing';
import { requestReturn, requestReturnText } from './supply-notices';
import { OrgResolver } from './org-resolver';
import { SupplierAliases } from './supplier-aliases';
import { labelFromPriority, labelFromStatus, priorityFromLabel, statusFromLabel } from './supply-labels';
import { SupplyRequest, SupplyRequestDocument } from './supply-request.schema';

export interface SupplyInput {
  title?: string;
  qty?: number;
  unit?: string;
  num?: number;
  requestDate?: string;
  categoryId?: string;
  categoryName?: string;
  materialId?: string;
  supplierName?: string;
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
  ) {}

  private async names(coll: string, ids: unknown[]) {
    const oids = [...new Set(ids.filter(Boolean).map(String))].filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
    if (!oids.length) return new Map<string, string>();
    const docs = await this.connection.db!.collection(coll).find({ _id: { $in: oids } }, { projection: { name: 1, shortName: 1 } }).toArray();
    return new Map(docs.map((d) => [String(d._id), String(d.shortName || d.name)]));
  }

  /** Сумма записи счёта: invoiceId → amount (карточка счёта на доске, когда у позиций нет цены). */
  private async invoiceAmounts(ids: unknown[]) {
    const oids = [...new Set(ids.filter(Boolean).map(String))].filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
    if (!oids.length) return new Map<string, number>();
    const docs = await this.connection.db!.collection('supplyinvoices').find({ _id: { $in: oids }, deletedAt: null }, { projection: { amount: 1 } }).toArray();
    return new Map(docs.filter((d) => typeof d.amount === 'number').map((d) => [String(d._id), d.amount as number]));
  }

  /** Главное фото позиций склада: materialId → { url, thumb }. */
  private async materialPhotos(ids: unknown[]) {
    const oidsList = [...new Set(ids.filter(Boolean).map(String))].filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
    if (!oidsList.length) return new Map<string, { url: string; thumb: string }>();
    const db = this.connection.db!;
    const mats = await db.collection('materials').find({ _id: { $in: oidsList } }, { projection: { mainPhotoId: 1, photoIds: 1 } }).toArray();
    const main = new Map(mats.map((m) => [String(m._id), (m.mainPhotoId ?? (m.photoIds as Types.ObjectId[] | undefined)?.[0]) as Types.ObjectId | undefined]).filter(([, p]) => p) as Array<[string, Types.ObjectId]>);
    return this.photoUrls(main);
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
    const [sup, cat, mat, photo, inv] = await Promise.all([
      this.names('organizations', docs.flatMap((d) => [d.supplierId, d.companyId])),
      this.names('categories', docs.map((d) => d.categoryId)),
      this.names('materials', docs.map((d) => d.materialId)),
      this.materialPhotos(docs.map((d) => d.materialId)),
      this.invoiceAmounts(docs.map((d) => d.invoiceId)),
    ]);
    // Свои фото заявки (загружены в приложении или из «Справочника») — photoIds, вне схемы CRM
    const ownIds = (d: Record<string, unknown>) => (d.photoIds as Types.ObjectId[] | undefined) ?? [];
    const own = await this.photoUrls(new Map(docs.flatMap((d) => ownIds(d)).map((p) => [String(p), p] as [string, Types.ObjectId])));
    return docs.map((d) => ({
      ...d,
      id: String(d._id), _id: String(d._id),
      supplierName: d.supplierId ? sup.get(String(d.supplierId)) ?? null : null,
      companyName: d.companyId ? sup.get(String(d.companyId)) ?? null : null,
      categoryName: d.categoryId ? cat.get(String(d.categoryId)) ?? null : null,
      materialName: d.materialId ? mat.get(String(d.materialId)) ?? null : null,
      statusLabel: labelFromStatus(d.status as string, d.paid as boolean),
      priorityLabel: labelFromPriority(d.priority as string),
      invoiceAmount: d.invoiceId ? inv.get(String(d.invoiceId)) ?? null : null,
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
    const res = await this.model.updateOne({ _id, deletedAt: null }, { ...update, $set: { ...update.$set, editedInApp: true } }, { strict: false }).exec();
    if (!res.matchedCount) throw new NotFoundException('Заявка не найдена');
  }

  async addPhoto(id: string, photoId: string) {
    const _id = oid(id, 'заявки');
    const [pid] = await this.photoOids([photoId]);
    await this.writePhotos(_id, { $addToSet: { photoIds: pid } });
    return this.get(id);
  }

  async mainPhoto(id: string, photoId: string) {
    await photoToFront((f, u) => this.model.updateOne(f, u).exec(), { _id: oid(id, 'заявки'), deletedAt: null }, oid(photoId, 'фото'));
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
  async list(q: Record<string, unknown> = {}) {
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
      this.model.aggregate([{ $match: filter }, { $group: { _id: null, sum: { $sum: { $ifNull: ['$priceHint', 0] } } } }]).exec(),
      this.model.aggregate([{ $match: noStatus }, { $group: { _id: { s: '$status', p: { $eq: ['$paid', true] } }, n: { $sum: 1 } } }]).exec(),
    ]);
    const pure = Object.fromEntries(Object.entries(q).filter(([k]) => !['page', 'limit', 'sort', 'facets'].includes(k)));
    const [docs, total, [agg, byStatus]] = await Promise.all([
      this.model.find(filter).setOptions({ includeSoftDeleted: true }).sort(sort).skip(p.skip).limit(p.limit).lean().exec(),
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

  async get(id: string) {
    const doc = await this.model.findOne({ _id: oid(id, 'заявки'), deletedAt: null }).lean().exec();
    if (!doc) throw new NotFoundException('Заявка не найдена');
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
    const res = await this.model.updateOne({ _id: oid(id, 'заявки'), deletedAt: null }, { $set: { deletedAt: new Date(), editedInApp: true } }).exec();
    if (!res.matchedCount) throw new NotFoundException('Заявка не найдена');
    return { id, deleted: true };
  }

  async restore(id: string) {
    const res = await this.model.updateOne({ _id: oid(id, 'заявки'), deletedAt: { $ne: null } }, { $set: { deletedAt: null, editedInApp: true } })
      .setOptions({ includeSoftDeleted: true }).exec();
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
    if (dto.materialId && Types.ObjectId.isValid(dto.materialId)) f.materialId = new Types.ObjectId(dto.materialId);
    const orgs = new OrgResolver(this.connection);
    if (dto.supplierName !== undefined) f.supplierId = await orgs.resolve(dto.supplierName, 'supplier');
    if (dto.companyName !== undefined) f.companyId = await orgs.resolve(dto.companyName, 'own');
    if (dto.statusLabel !== undefined) {
      const s = statusFromLabel(dto.statusLabel);
      if (s) { f.status = s.status; f.paid = !!s.paid; if (s.paid) f.paidAt = new Date(); }
    }
    if (dto.priorityLabel !== undefined) f.priority = priorityFromLabel(dto.priorityLabel) ?? 'normal';
    if (dto.invoiceType !== undefined) f['sheetExtra.invoiceType'] = String(dto.invoiceType ?? '').trim() || undefined;
    return f;
  }

  async create(dto: SupplyInput, userId?: string) {
    if (dto.clientUid) {
      const dup = await this.model.findOne({ clientUid: dto.clientUid }).lean().exec();
      if (dup) return this.get(String(dup._id));
    }
    const fields = await this.toFields(dto);
    if (fields.status === 'received') throw new BadRequestException('«Получено» ставится только кнопкой «Принять» — так товар приходует на склад и ничего не теряется (создайте заявку «Оплачено», затем «Принять»)');
    if (!fields.title && !fields.materialId) throw new BadRequestException('Укажите наименование');
    // ТИ-8 Н-1: выбрана позиция склада, названия нет — «в счёте», если заполнено, иначе короткое
    if (!fields.title && fields.materialId) {
      const m = await this.connection.db!.collection('materials').findOne({ _id: fields.materialId as Types.ObjectId }, { projection: { name: 1, invoiceName: 1 } });
      if (m) fields.title = materialRequestTitle(m as { name?: string; invoiceName?: string });
    }
    // единый источник (CANON §5): название совпало с позицией склада — заявка сразу ссылается на неё
    if (!fields.materialId && fields.title) {
      const same = await this.stock.findMaterialByName(String(fields.title));
      if (same) fields.materialId = same._id;
    }
    const photoIds = dto.photoIds ? await this.photoOids(dto.photoIds) : [];
    if (fields.num === undefined) {
      // номер из счётчика, засеянного текущим максимумом: два одновременных создателя не получат одно число (HARDEN-1 п.11)
      const last = await this.model.findOne({ num: { $ne: null } }).sort({ num: -1 }).lean().exec();
      await this.counters.setSeqAtLeast('SupplyRequest', 'N', Number(last?.num) || 0);
      fields.num = await this.counters.nextSeq('SupplyRequest', 'N');
    }
    const doc = await this.model.create({
      status: 'requested', priority: 'normal', qty: 1, paid: false, requestDate: todayUtc(),
      ...Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== undefined && k !== 'sheetExtra.invoiceType')),
      ...(fields['sheetExtra.invoiceType'] ? { sheetExtra: { invoiceType: fields['sheetExtra.invoiceType'] } } : {}),
      clientUid: dto.clientUid,
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
    });
    if (photoIds.length) await this.writePhotos(doc._id as Types.ObjectId, { $set: { photoIds } });
    await this.adoptArticle(doc as unknown as Record<string, unknown>);
    await this.afterCreate(doc as unknown as Record<string, unknown>, userId);
    return this.get(String(doc._id));
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

  async update(id: string, dto: SupplyInput, userRole?: string, actorId?: string) {
    // менеджер правит суммы заявок (решение 2026-10-29, docs/CHECKLIST-MANAGER-ROLE.md); роли без денег суммы не пришлют — их срезает MoneyMask
    void userRole;
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id заявки');
    const fields = await this.toFields(dto);
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
    const res = await this.model.updateOne({ _id: id, deletedAt: null }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }).exec();
    if (!res.matchedCount) throw new NotFoundException('Заявка не найдена');
    if (photoIds) await this.writePhotos(new Types.ObjectId(id), { $set: { photoIds } });
    await this.adoptArticle(await this.model.findById(id, { materialId: 1, article: 1, num: 1 }).lean().exec() as Record<string, unknown> | null);
    await this.afterStatus(prev, fields.status as string | undefined, actorId);
    if (dto.responsibleId !== undefined) await this.afterResponsible(id, prevResp, actorId);
    return this.get(id);
  }

  /**
   * Оприходовать: приход на склад по умолчанию + статус «received» (как receive() в CRM).
   * Нет привязанного материала — находим по наименованию или заводим новую позицию склада.
   */
  async receive(id: string, dto: { qty?: number; clientUid?: string; toStock?: boolean; costCenter?: string; costObject?: string; partial?: boolean; materialId?: string }, userId?: string) {
    const out = await this.receiveRaw(id, dto, userId);
    try {
      const so = await this.model.findById(id, { salesOrderId: 1 }).lean().exec() as { salesOrderId?: unknown } | null;
      if (so?.salesOrderId) await this.orders.recheck(so.salesOrderId, userId);
    } catch { /* пересчёт готовности не должен ломать приход */ }
    return out;
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
    const qty = Number(dto.qty ?? doc.qty);
    if (!(qty > 0)) throw new BadRequestException('Укажите количество');

    // Куда пошло: на склад (по умолчанию) или сразу в работу / офис / объект — тогда без прихода, но с отметкой (ничего не «в воздухе»)
    const d0 = doc as unknown as { costCenter?: string; costObject?: string; salesOrderId?: unknown };
    const costCenter = dto.costCenter || d0.costCenter || (d0.salesOrderId ? 'order' : 'workshop');
    const costObject = dto.costObject?.trim() || d0.costObject;
    if (dto.toStock === false) {
      await this.model.updateOne({ _id: doc._id }, { $set: { status: 'received', receivedQty: qty, receivedAt: new Date(), receivedTo: 'direct', costCenter, ...(costObject ? { costObject } : {}), editedInApp: true, ...(dto.clientUid ? { receiveUid: dto.clientUid } : {}) } }).exec();
      return this.get(id);
    }
    let materialId = (dto.materialId && Types.ObjectId.isValid(dto.materialId)) ? dto.materialId : (doc.materialId ? String(doc.materialId) : '');
    if (!materialId) {
      const name = doc.title?.trim();
      if (!name) throw new BadRequestException('У заявки нет наименования');
      const cat = doc.categoryId ? await this.connection.db!.collection('categories').findOne({ _id: doc.categoryId }) : null;
      const item = await this.stock.createItem({ name, unit: doc.unit, article: doc.article, categoryName: cat?.name as string | undefined, invoiceName: name }); // ТИ-8: название из счёта — в invoiceName
      materialId = item.id;
    }
    // ЗП.4: пришла часть — приход, заявка остаётся открытой на остаток (qty уменьшается, receivedQty копится)
    if (dto.partial && qty < Number(doc.qty)) {
      if (dto.clientUid && prevUid === dto.clientUid) return this.get(id); // этот приём уже записан — заявку не трогаем
      await this.stock.move(materialId, { type: 'in', qty, note: `Приход по заявке${doc.num ? ' №' + doc.num : ''} (часть)`, documentRef: `SupplyRequest:${id}`, clientUid: dto.clientUid }, userId);
      const left = Math.round((Number(doc.qty) - qty) * 1000) / 1000;
      await this.model.updateOne({ _id: doc._id }, { $set: { qty: left, receivedQty: Math.round(((Number((doc as { receivedQty?: number }).receivedQty) || 0) + qty) * 1000) / 1000, editedInApp: true, materialId: new Types.ObjectId(materialId), ...(dto.clientUid ? { receiveUid: dto.clientUid } : {}) } }).exec();
      return this.get(id);
    }
    // ключ приёма включает число отменённых приходов заявки: новый приём после отмены не совпадёт со старым движением
    const cancelled = dto.clientUid ? 0 : await this.connection.db!.collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${id}`, cancelledAt: { $ne: null } });
    await this.stock.move(materialId, { type: 'in', qty, note: `Приход по заявке${doc.num ? ' №' + doc.num : ''}`, documentRef: `SupplyRequest:${id}`, clientUid: dto.clientUid ?? `receive:${id}:${(doc as { receivedQty?: number }).receivedQty ?? 0}:${cancelled}` }, userId);
    if (doc.article) await this.stock.adoptArticle(materialId, doc.article, `заявка${doc.num ? ' №' + doc.num : ''}`).catch(() => undefined);
    const done = await this.model.updateOne({ _id: doc._id, status: { $ne: 'received' } }, { $set: { status: 'received', receivedQty: qty, receivedAt: new Date(), receivedTo: 'stock', costCenter, ...(costObject ? { costObject } : {}), editedInApp: true, materialId: new Types.ObjectId(materialId), ...(dto.clientUid ? { receiveUid: dto.clientUid } : {}) } }).exec();
    if (!done.matchedCount) {
      // параллельный вызов успел раньше: тот же ключ — просто тот же результат, иначе 409 (приход по ключу уже не задвоился в stock.move)
      const now = await this.model.findById(id, { receiveUid: 1 }).lean().exec() as { receiveUid?: string } | null;
      if (dto.clientUid && now?.receiveUid === dto.clientUid) return this.get(id);
      throw new ConflictException('Заявка уже отмечена как полученная');
    }
    return this.get(id);
  }

  aliases() { return new SupplierAliases(this.connection); }

  /**
   * Лёгкая подсказка «уже заказывали»: по одной строке на название (последняя заявка), без фото и `present`.
   * count — сколько раз заказывали. search — слова через И по названию и артикулу.
   */
  async lookup(q: Record<string, unknown> = {}) {
    const limit = Math.min(Math.max(parseInt(String(q.limit ?? ''), 10) || 50, 1), 500);
    const and = searchTokens(q.search).map((tk) => { const re = tokenRegex(tk); return { $or: [{ title: re }, { article: re }] }; });
    const rows = await this.model.aggregate<Record<string, unknown>>([
      { $match: { deletedAt: null, title: { $nin: [null, ''] }, ...(and.length ? { $and: and } : {}) } },
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
  async lookups() {
    const orgs = await this.connection.db!.collection('organizations')
      .find({ deletedAt: null, $or: [{ type: 'supplier' }, { isOurCompany: true }] }, { projection: { name: 1, shortName: 1, type: 1, isOurCompany: 1 } })
      .sort({ name: 1 }).toArray();
    const cats = await this.connection.db!.collection('categories').find({ deletedAt: null, type: 'material' }, { projection: { name: 1 } }).sort({ name: 1 }).toArray();
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
