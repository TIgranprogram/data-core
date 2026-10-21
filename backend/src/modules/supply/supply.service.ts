import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { searchTokens, tokenRegex } from '../stock/search-norm';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { dateRange, oid, oids, parseList } from '../../common/list-query';
import { CategoryResolver } from '../stock/category-resolver';
import { StockService } from '../stock/stock.service';
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
const SUPPLY_SORT = ['num', 'requestDate', 'invoiceDate', 'title', 'qty', 'priceHint', 'status', 'requestedBy', 'createdAt', 'updatedAt', 'deletedAt'];

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
  ) {}

  private async names(coll: string, ids: unknown[]) {
    const oids = [...new Set(ids.filter(Boolean).map(String))].filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
    if (!oids.length) return new Map<string, string>();
    const docs = await this.connection.db!.collection(coll).find({ _id: { $in: oids } }, { projection: { name: 1, shortName: 1 } }).toArray();
    return new Map(docs.map((d) => [String(d._id), String(d.shortName || d.name)]));
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
    const [sup, cat, mat, photo] = await Promise.all([
      this.names('organizations', docs.flatMap((d) => [d.supplierId, d.companyId])),
      this.names('categories', docs.map((d) => d.categoryId)),
      this.names('materials', docs.map((d) => d.materialId)),
      this.materialPhotos(docs.map((d) => d.materialId)),
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
    const found = await this.connection.db!.collection('photos').countDocuments({ _id: { $in: list } });
    if (found !== list.length) throw new NotFoundException('Фото не найдено — загрузите ещё раз');
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
        { priceHint: { $gt: 0 }, $or: [{ invoiceDate: null }, { invoiceDate: { $exists: false } }] },
        { invoiceDate: { $ne: null }, priceHint: { $gt: 0 }, $or: [{ companyId: null }, { companyId: { $exists: false } }, { companyId: { $nin: ours } }] },
      ] });
    }
    if (q.categoryId) filter.categoryId = { $in: oids(q.categoryId) };
    if (q.materialId) filter.materialId = { $in: oids(q.materialId) };
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
    const [docs, total, agg, byStatus] = await Promise.all([
      this.model.find(filter).setOptions({ includeSoftDeleted: true }).sort(sort).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(filter).setOptions({ includeSoftDeleted: true }).exec(),
      this.model.aggregate([{ $match: filter }, { $group: { _id: null, sum: { $sum: { $ifNull: ['$priceHint', 0] } } } }]).exec(),
      this.model.aggregate([{ $match: noStatus }, { $group: { _id: { s: '$status', p: { $eq: ['$paid', true] } }, n: { $sum: 1 } } }]).exec(),
    ]);
    const counts: Record<string, number> = { all: 0 };
    for (const g of byStatus as Array<{ _id: { s: string; p: boolean }; n: number }>) {
      const k = g._id.s === 'ordered' && g._id.p ? 'paid' : g._id.s || 'requested';
      counts[k] = (counts[k] ?? 0) + g.n;
      counts.all += g.n;
    }
    return { items: await this.present(docs as Array<Record<string, unknown>>), total, page: p.page, limit: p.limit, sum: agg[0]?.sum ?? 0, counts };
  }

  async get(id: string) {
    const doc = await this.model.findOne({ _id: oid(id, 'заявки'), deletedAt: null }).lean().exec();
    if (!doc) throw new NotFoundException('Заявка не найдена');
    return (await this.present([doc as Record<string, unknown>]))[0];
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
    if (dto.qty !== undefined) f.qty = Number(dto.qty);
    if (dto.priceHint !== undefined) f.priceHint = Number(dto.priceHint);
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
    const photoIds = dto.photoIds ? await this.photoOids(dto.photoIds) : [];
    if (fields.num === undefined) {
      const last = await this.model.findOne({ num: { $ne: null } }).sort({ num: -1 }).lean().exec();
      fields.num = (Number(last?.num) || 0) + 1;
    }
    const doc = await this.model.create({
      status: 'requested', priority: 'normal', qty: 1, paid: false, requestDate: todayUtc(),
      ...Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== undefined && k !== 'sheetExtra.invoiceType')),
      ...(fields['sheetExtra.invoiceType'] ? { sheetExtra: { invoiceType: fields['sheetExtra.invoiceType'] } } : {}),
      clientUid: dto.clientUid,
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
    });
    if (photoIds.length) await this.writePhotos(doc._id as Types.ObjectId, { $set: { photoIds } });
    return this.get(String(doc._id));
  }

  async update(id: string, dto: SupplyInput) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id заявки');
    const fields = await this.toFields(dto);
    // «Получено» без прихода на склад запрещено — иначе товар «висит в воздухе» (решение 2026-10-20)
    if (fields.status === 'received') {
      const cur = await this.model.findById(id, { status: 1 }).lean().exec();
      if (cur && cur.status !== 'received') throw new BadRequestException('«Получено» ставится только кнопкой «Принять» — так товар приходует на склад и ничего не теряется');
    }
    const photoIds = dto.photoIds ? await this.photoOids(dto.photoIds) : undefined;
    const set: Record<string, unknown> = {}, unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(fields)) (v === undefined ? (unset[k] = '') : (set[k] = v));
    set.editedInApp = true;
    if (fields.paid === false) unset.paidAt = '';
    const res = await this.model.updateOne({ _id: id, deletedAt: null }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }).exec();
    if (!res.matchedCount) throw new NotFoundException('Заявка не найдена');
    if (photoIds) await this.writePhotos(new Types.ObjectId(id), { $set: { photoIds } });
    return this.get(id);
  }

  /**
   * Оприходовать: приход на склад по умолчанию + статус «received» (как receive() в CRM).
   * Нет привязанного материала — находим по наименованию или заводим новую позицию склада.
   */
  async receive(id: string, dto: { qty?: number; clientUid?: string; toStock?: boolean; costCenter?: string; costObject?: string }, userId?: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id заявки');
    const doc = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!doc) throw new NotFoundException('Заявка не найдена');
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
    let materialId = doc.materialId ? String(doc.materialId) : '';
    if (!materialId) {
      const name = doc.title?.trim();
      if (!name) throw new BadRequestException('У заявки нет наименования');
      const cat = doc.categoryId ? await this.connection.db!.collection('categories').findOne({ _id: doc.categoryId }) : null;
      const item = await this.stock.createItem({ name, unit: doc.unit, article: doc.article, categoryName: cat?.name as string | undefined });
      materialId = item.id;
    }
    await this.stock.move(materialId, { type: 'in', qty, note: `Приход по заявке${doc.num ? ' №' + doc.num : ''}`, documentRef: `SupplyRequest:${id}`, clientUid: dto.clientUid }, userId);
    await this.model.updateOne({ _id: doc._id }, { $set: { status: 'received', receivedQty: qty, receivedAt: new Date(), receivedTo: 'stock', costCenter, ...(costObject ? { costObject } : {}), editedInApp: true, materialId: new Types.ObjectId(materialId), ...(dto.clientUid ? { receiveUid: dto.clientUid } : {}) } }).exec();
    return this.get(id);
  }

  aliases() { return new SupplierAliases(this.connection); }

  /** Названия поставщиков и «наших компаний» — для подсказок в форме. */
  async lookups() {
    const orgs = await this.connection.db!.collection('organizations')
      .find({ deletedAt: null, $or: [{ type: 'supplier' }, { isOurCompany: true }] }, { projection: { name: 1, shortName: 1, type: 1, isOurCompany: 1 } })
      .sort({ name: 1 }).toArray();
    const cats = await this.connection.db!.collection('categories').find({ deletedAt: null, type: 'material' }, { projection: { name: 1 } }).sort({ name: 1 }).toArray();
    const lists = ((await this.connection.db!.collection('settings').findOne({ key: 'supply.sheetLists' }))?.value ?? {}) as Record<string, string[] | undefined>;
    const uniq = (a: unknown[]) => [...new Map(a.filter(Boolean).map((v) => [String(v).trim().toLowerCase().replace(/\s+/g, ' '), String(v).trim()])).values()].sort((x, y) => x.localeCompare(y, 'ru'));
    const people = uniq([...(await this.model.distinct('requestedBy', { deletedAt: null }).exec()), ...(lists.people ?? [])]);
    const customers = uniq([...(await this.model.distinct('orderLabel', { deletedAt: null }).exec()), ...(lists.customers ?? [])]);
    const sup = orgs.filter((o) => (o.type as string[] | undefined)?.includes('supplier'));
    return {
      suppliers: sup.map((o) => String(o.shortName || o.name)),
      companies: orgs.filter((o) => o.isOurCompany).map((o) => String(o.shortName || o.name)),
      categories: cats.map((c) => ({ id: String(c._id), name: String(c.name) })),
      /** Для фильтров: поставщики с id и «кто подал». */
      supplierRefs: sup.map((o) => ({ id: String(o._id), name: String(o.shortName || o.name) })),
      requestedBy: people,
      /** Списки «Справочника» Google-таблицы (+ то, что уже встречалось в заявках). */
      customers,
      invoiceTypes: uniq(['Счет на оплату', 'Счет-договор', 'Счет', 'УПД', ...(lists.invoiceTypes ?? [])]),
      services: lists.services ?? [],
      units: uniq(lists.units ?? []),
    };
  }
}
