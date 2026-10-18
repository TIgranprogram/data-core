import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { CategoryResolver } from '../stock/category-resolver';
import { StockService } from '../stock/stock.service';
import { OrgResolver } from './org-resolver';
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
  requestedBy?: string;
  article?: string;
  color?: string;
  productUrl?: string;
  priceHint?: number;
  invoiceNo?: string;
  deliveryNote?: string;
  notes?: string;
  /** Русская подпись статуса («✅ Заказать», «💰 Оплачено»…) — переводится в status + paid. */
  statusLabel?: string;
  /** Срочно / Обычный / Низко. */
  priorityLabel?: string;
  clientUid?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

  /** Вид для клиента: ObjectId → названия, статус и приоритет — подписями. */
  private async present(docs: Array<Record<string, unknown>>) {
    const [sup, cat, mat] = await Promise.all([
      this.names('organizations', docs.flatMap((d) => [d.supplierId, d.companyId])),
      this.names('categories', docs.map((d) => d.categoryId)),
      this.names('materials', docs.map((d) => d.materialId)),
    ]);
    return docs.map((d) => ({
      ...d,
      id: String(d._id), _id: String(d._id),
      supplierName: d.supplierId ? sup.get(String(d.supplierId)) ?? null : null,
      companyName: d.companyId ? sup.get(String(d.companyId)) ?? null : null,
      categoryName: d.categoryId ? cat.get(String(d.categoryId)) ?? null : null,
      materialName: d.materialId ? mat.get(String(d.materialId)) ?? null : null,
      statusLabel: labelFromStatus(d.status as string, d.paid as boolean),
      priorityLabel: labelFromPriority(d.priority as string),
    }));
  }

  async list(q: { search?: string; status?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(1000, Math.max(1, Number(q.limit) || 1000));
    const filter: Record<string, unknown> = { deletedAt: null };
    if (q.status) filter.status = q.status;
    if (q.search) { const re = new RegExp(escapeRe(q.search.trim()), 'i'); filter.$or = [{ title: re }, { article: re }, { orderLabel: re }, { notes: re }]; }
    const [docs, total] = await Promise.all([
      this.model.find(filter).sort({ requestDate: -1, num: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items: await this.present(docs as Array<Record<string, unknown>>), total, page, limit };
  }

  async get(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id заявки');
    const doc = await this.model.findOne({ _id: id, deletedAt: null }).lean().exec();
    if (!doc) throw new NotFoundException('Заявка не найдена');
    return (await this.present([doc as Record<string, unknown>]))[0];
  }

  /** Поля формы → поля схемы CRM (общая часть create/update). */
  private async toFields(dto: SupplyInput): Promise<Record<string, unknown>> {
    const f: Record<string, unknown> = {};
    const str = (k: keyof SupplyInput, to: string = k) => { if (dto[k] !== undefined) f[to] = String(dto[k] ?? '').trim() || undefined; };
    str('title'); str('unit'); str('orderLabel'); str('requestedBy'); str('article'); str('color'); str('productUrl'); str('invoiceNo'); str('deliveryNote'); str('notes');
    if (dto.qty !== undefined) f.qty = Number(dto.qty);
    if (dto.priceHint !== undefined) f.priceHint = Number(dto.priceHint);
    if (dto.num !== undefined) f.num = Number(dto.num);
    if (dto.requestDate) f.requestDate = new Date(dto.requestDate);
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
    return f;
  }

  async create(dto: SupplyInput, userId?: string) {
    if (dto.clientUid) {
      const dup = await this.model.findOne({ clientUid: dto.clientUid }).lean().exec();
      if (dup) return this.get(String(dup._id));
    }
    const fields = await this.toFields(dto);
    if (!fields.title && !fields.materialId) throw new BadRequestException('Укажите наименование');
    if (fields.num === undefined) {
      const last = await this.model.findOne({ num: { $ne: null } }).sort({ num: -1 }).lean().exec();
      fields.num = (Number(last?.num) || 0) + 1;
    }
    const doc = await this.model.create({
      status: 'requested', priority: 'normal', qty: 1, paid: false, requestDate: new Date(),
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
      clientUid: dto.clientUid,
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
    });
    return this.get(String(doc._id));
  }

  async update(id: string, dto: SupplyInput) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id заявки');
    const fields = await this.toFields(dto);
    const set: Record<string, unknown> = {}, unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(fields)) (v === undefined ? (unset[k] = '') : (set[k] = v));
    if (fields.paid === false) unset.paidAt = '';
    const res = await this.model.updateOne({ _id: id, deletedAt: null }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }).exec();
    if (!res.matchedCount) throw new NotFoundException('Заявка не найдена');
    return this.get(id);
  }

  /**
   * Оприходовать: приход на склад по умолчанию + статус «received» (как receive() в CRM).
   * Нет привязанного материала — находим по наименованию или заводим новую позицию склада.
   */
  async receive(id: string, dto: { qty?: number; clientUid?: string }, userId?: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id заявки');
    const doc = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!doc) throw new NotFoundException('Заявка не найдена');
    if (doc.status === 'received') {
      if (dto.clientUid && (doc as unknown as { receiveUid?: string }).receiveUid === dto.clientUid) return this.get(id);
      throw new ConflictException('Заявка уже отмечена как полученная');
    }
    const qty = Number(dto.qty ?? doc.qty);
    if (!(qty > 0)) throw new BadRequestException('Укажите количество');

    let materialId = doc.materialId ? String(doc.materialId) : '';
    if (!materialId) {
      const name = doc.title?.trim();
      if (!name) throw new BadRequestException('У заявки нет наименования');
      const cat = doc.categoryId ? await this.connection.db!.collection('categories').findOne({ _id: doc.categoryId }) : null;
      const item = await this.stock.createItem({ name, unit: doc.unit, article: doc.article, categoryName: cat?.name as string | undefined });
      materialId = item.id;
    }
    await this.stock.move(materialId, { type: 'in', qty, note: `Приход по заявке${doc.num ? ' №' + doc.num : ''}`, documentRef: `SupplyRequest:${id}`, clientUid: dto.clientUid }, userId);
    await this.model.updateOne({ _id: doc._id }, { $set: { status: 'received', receivedQty: qty, materialId: new Types.ObjectId(materialId), ...(dto.clientUid ? { receiveUid: dto.clientUid } : {}) } }).exec();
    return this.get(id);
  }

  /** Названия поставщиков и «наших компаний» — для подсказок в форме. */
  async lookups() {
    const orgs = await this.connection.db!.collection('organizations')
      .find({ deletedAt: null, $or: [{ type: 'supplier' }, { isOurCompany: true }] }, { projection: { name: 1, shortName: 1, type: 1, isOurCompany: 1 } })
      .sort({ name: 1 }).toArray();
    const cats = await this.connection.db!.collection('categories').find({ deletedAt: null, type: 'material' }, { projection: { name: 1 } }).sort({ name: 1 }).toArray();
    return {
      suppliers: orgs.filter((o) => (o.type as string[] | undefined)?.includes('supplier')).map((o) => String(o.shortName || o.name)),
      companies: orgs.filter((o) => o.isOurCompany).map((o) => String(o.shortName || o.name)),
      categories: cats.map((c) => ({ id: String(c._id), name: String(c.name) })),
    };
  }
}
