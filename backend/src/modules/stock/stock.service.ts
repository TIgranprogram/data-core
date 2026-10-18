import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { CounterService } from '../counter/counter.service';
import { Material, MaterialDocument } from '../material/material.schema';
import { normText } from '../supply/org-resolver';
import { CategoryResolver } from './category-resolver';
import { Reservation, ReservationDocument } from './schemas/reservation.schema';
import { StockMovement, StockMovementDocument } from './schemas/stock-movement.schema';
import { StorageItem, StorageItemDocument } from './schemas/storage-item.schema';
import { Warehouse, WarehouseDocument } from './schemas/warehouse.schema';

export type MoveType = 'in' | 'out' | 'adjust' | 'reserve' | 'unreserve';

export interface StockItemInput {
  name?: string;
  unit?: string;
  article?: string;
  categoryId?: string;
  categoryName?: string;
  minQuantity?: number;
  weightKg?: number;
  notes?: string;
}

export interface MoveInput {
  type: MoveType;
  /** Количество (> 0); для adjust — изменение со знаком. */
  qty: number;
  note?: string;
  clientUid?: string;
  documentRef?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Склад на ОБЩИХ коллекциях CRM: `materials` (номенклатура) + `storageitems` (остаток на складе)
 * + `stockmovements` (журнал) + `reservations` (брони). Правила изменения остатка — как в
 * StockMovementService / StorageItemService / ReservationService kppdf, чтобы CRM и приложение
 * видели одно и то же. Всё в пределах склада по умолчанию (`warehouses.isDefault`).
 */
@Injectable()
export class StockService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<WarehouseDocument>,
    @InjectModel(StorageItem.name) private readonly storage: Model<StorageItemDocument>,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    @InjectModel(Reservation.name) private readonly reservations: Model<ReservationDocument>,
    @InjectModel(Material.name) private readonly materials: Model<MaterialDocument>,
    private readonly counter: CounterService,
  ) {}

  /** Склад по умолчанию; если не назначен — первый действующий («Главный склад») становится им. */
  async defaultWarehouse(): Promise<WarehouseDocument> {
    const active = { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] };
    const def = await this.warehouses.findOne({ isDefault: true, ...active }).exec();
    if (def) return def;
    const first = await this.warehouses.findOne({ isActive: { $ne: false }, ...active }).sort({ createdAt: 1 }).exec();
    if (first) {
      await this.warehouses.updateOne({ _id: first._id }, { $set: { isDefault: true } }).exec();
      first.isDefault = true;
      return first;
    }
    return this.warehouses.create({ name: 'Главный склад', type: 'main', isActive: true, isDefault: true });
  }

  async listWarehouses() {
    const def = await this.defaultWarehouse();
    const items = await this.warehouses.find({ deletedAt: null }).sort({ name: 1 }).lean().exec();
    return { items, total: items.length, defaultId: String(def._id) };
  }

  private async photoMap(ids: Types.ObjectId[]) {
    const map = new Map<string, { id: string; url: string; thumb: string }>();
    if (!ids.length) return map;
    const coll = this.connection.db!.collection('photos');
    const [originals, thumbs] = await Promise.all([
      coll.find({ _id: { $in: ids } }, { projection: { storageUrl: 1 } }).toArray(),
      coll.find({ parentPhotoId: { $in: ids }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    ]);
    const thumbOf = new Map(thumbs.map((t) => [String(t.parentPhotoId), String(t.storageUrl)]));
    for (const p of originals) map.set(String(p._id), { id: String(p._id), url: String(p.storageUrl), thumb: thumbOf.get(String(p._id)) ?? String(p.storageUrl) });
    return map;
  }

  /** Позиции склада: материалы + остаток на складе по умолчанию (материал без остатка → 0). */
  async listItems(q: { search?: string; categoryId?: string; page?: number; limit?: number; materialIds?: Types.ObjectId[] } = {}) {
    const wh = await this.defaultWarehouse();
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(1000, Math.max(1, Number(q.limit) || 1000));
    const filter: Record<string, unknown> = { deletedAt: null };
    if (q.search) {
      const re = new RegExp(escapeRe(q.search.trim()), 'i');
      filter.$or = [{ name: re }, { article: re }, { sku: re }];
    }
    if (q.categoryId && Types.ObjectId.isValid(q.categoryId)) filter.categoryId = { $in: [new Types.ObjectId(q.categoryId), q.categoryId] };
    if (q.materialIds) filter._id = { $in: q.materialIds };

    const [mats, total] = await Promise.all([
      this.materials.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.materials.countDocuments(filter).exec(),
    ]);
    const ids = mats.map((m) => m._id as Types.ObjectId);
    const [stocks, cats, photos] = await Promise.all([
      this.storage.find({ warehouseId: wh._id, materialId: { $in: ids }, deletedAt: null }).lean().exec(),
      this.connection.db!.collection('categories').find({}, { projection: { name: 1 } }).toArray(),
      this.photoMap(mats.flatMap((m) => (m.photoIds ?? []) as Types.ObjectId[])),
    ]);
    const catName = new Map(cats.map((c) => [String(c._id), String(c.name)]));
    const byMat = new Map<string, { quantity: number; reservedQty: number; minQuantity: number; weightKg?: number; zoneName?: string; id: string }>();
    for (const s of stocks) {
      const k = String(s.materialId);
      const cur = byMat.get(k);
      if (cur) { cur.quantity += s.quantity ?? 0; cur.reservedQty += s.reservedQty ?? 0; continue; }
      byMat.set(k, { id: String(s._id), quantity: s.quantity ?? 0, reservedQty: s.reservedQty ?? 0, minQuantity: s.minQuantity ?? 0, weightKg: s.weightKg, zoneName: s.zoneName });
    }
    const items = mats.map((m) => {
      const st = byMat.get(String(m._id));
      const quantity = st?.quantity ?? 0, reservedQty = st?.reservedQty ?? 0, minQuantity = st?.minQuantity ?? 0;
      return {
        id: String(m._id), materialId: String(m._id), name: m.name, article: m.article, sku: m.sku, unit: m.unit,
        categoryId: m.categoryId ? String(m.categoryId) : null, categoryName: m.categoryId ? catName.get(String(m.categoryId)) ?? null : null,
        notes: m.notes, quantity, reservedQty, free: quantity - reservedQty, minQuantity,
        weightKg: st?.weightKg ?? m.weightKg, zoneName: st?.zoneName ?? null, storageItemId: st?.id ?? null,
        photos: ((m.photoIds ?? []) as Types.ObjectId[]).map((p) => photos.get(String(p))).filter(Boolean),
        status: quantity <= 0 ? 'none' : minQuantity > 0 && quantity - reservedQty < minQuantity ? 'low' : 'ok',
        updatedAt: (m as { updatedAt?: Date }).updatedAt,
      };
    });
    return { items, total, page, limit, warehouseId: String(wh._id), warehouseName: wh.name };
  }

  async getItem(materialId: string) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    const r = await this.listItems({ materialIds: [new Types.ObjectId(materialId)] });
    if (!r.items[0]) throw new NotFoundException('Позиция не найдена');
    return r.items[0];
  }

  /** Материал с таким же наименованием (без учёта регистра и лишних пробелов). */
  async findMaterialByName(name: string): Promise<MaterialDocument | null> {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return null;
    const re = new RegExp(`^\\s*${escapeRe(clean).replace(/ /g, '\\s+')}\\s*$`, 'i');
    return this.materials.findOne({ name: re, deletedAt: null }).exec();
  }

  /** Авто-артикул для позиции без артикула (в CRM поле обязательно): СКЛ-<год>-<номер>. */
  autoArticle() {
    return this.counter.next('MaterialArticle', 'СКЛ');
  }

  /** Внутренний код по префиксу категории — как MaterialService. */
  async skuFor(categoryId?: Types.ObjectId): Promise<string | undefined> {
    if (!categoryId) return undefined;
    const cat = await this.connection.db!.collection('categories').findOne({ _id: categoryId });
    return cat?.skuPrefix ? this.counter.next('Material', String(cat.skuPrefix)) : undefined;
  }

  /** Новая позиция: материал + строка остатка (0). Позиция с тем же наименованием не дублируется. */
  async createItem(dto: StockItemInput) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Укажите наименование');
    const existing = await this.findMaterialByName(name);
    if (existing) {
      await this.updateItem(String(existing._id), { ...dto, name: undefined });
      return this.getItem(String(existing._id));
    }
    const categoryId = dto.categoryId && Types.ObjectId.isValid(dto.categoryId)
      ? new Types.ObjectId(dto.categoryId)
      : await new CategoryResolver(this.connection).resolve(dto.categoryName);
    const mat = await this.materials.create({
      name, unit: dto.unit?.trim() || 'шт', article: dto.article?.trim() || (await this.autoArticle()),
      sku: await this.skuFor(categoryId), categoryId, notes: dto.notes, weightKg: dto.weightKg,
    });
    const wh = await this.defaultWarehouse();
    await this.storage.updateOne(
      { warehouseId: wh._id, materialId: mat._id, zoneName: null },
      { $setOnInsert: { warehouseId: wh._id, materialId: mat._id, quantity: 0, reservedQty: 0, isActive: true, deletedAt: null, photos: [] },
        $set: { minQuantity: dto.minQuantity ?? 0, ...(dto.weightKg !== undefined ? { weightKg: dto.weightKg } : {}) } },
      { upsert: true },
    ).exec();
    return this.getItem(String(mat._id));
  }

  async updateItem(materialId: string, dto: StockItemInput) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    const _id = new Types.ObjectId(materialId);
    const mat = await this.materials.findOne({ _id, deletedAt: null }).exec();
    if (!mat) throw new NotFoundException('Позиция не найдена');
    const set: Record<string, unknown> = {};
    if (dto.name?.trim()) set.name = dto.name.trim();
    if (dto.unit?.trim()) set.unit = dto.unit.trim();
    if (dto.article?.trim()) set.article = dto.article.trim();
    if (dto.notes !== undefined) set.notes = dto.notes;
    if (dto.weightKg !== undefined) set.weightKg = dto.weightKg;
    if (dto.categoryId && Types.ObjectId.isValid(dto.categoryId)) set.categoryId = new Types.ObjectId(dto.categoryId);
    else if (dto.categoryName) set.categoryId = await new CategoryResolver(this.connection).resolve(dto.categoryName);
    if (Object.keys(set).length) await this.materials.updateOne({ _id }, { $set: set }).exec();
    if (dto.minQuantity !== undefined || dto.weightKg !== undefined) {
      const wh = await this.defaultWarehouse();
      await this.storage.updateOne(
        { warehouseId: wh._id, materialId: _id, zoneName: null },
        { $setOnInsert: { warehouseId: wh._id, materialId: _id, quantity: 0, reservedQty: 0, isActive: true, deletedAt: null, photos: [] },
          $set: { ...(dto.minQuantity !== undefined ? { minQuantity: dto.minQuantity } : {}), ...(dto.weightKg !== undefined ? { weightKg: dto.weightKg } : {}) } },
        { upsert: true },
      ).exec();
    }
    return this.getItem(materialId);
  }

  async addPhoto(materialId: string, photoId: string) {
    if (!Types.ObjectId.isValid(materialId) || !Types.ObjectId.isValid(photoId)) throw new BadRequestException('Некорректный id');
    const _id = new Types.ObjectId(materialId);
    const pid = new Types.ObjectId(photoId);
    const res = await this.materials.updateOne({ _id, deletedAt: null }, { $addToSet: { photoIds: pid } }).exec();
    if (!res.matchedCount) throw new NotFoundException('Позиция не найдена');
    await this.materials.updateOne({ _id, $or: [{ mainPhotoId: null }, { mainPhotoId: { $exists: false } }] }, { $set: { mainPhotoId: pid } }).exec();
    return this.getItem(materialId);
  }

  /**
   * Движение по позиции. in/out/adjust — как в CRM (остаток в storageitems + запись в stockmovements);
   * reserve/unreserve — reservedQty + reservations. Повтор с тем же clientUid ничего не меняет.
   */
  async move(materialId: string, dto: MoveInput, userId?: string) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    const qty = Number(dto.qty);
    if (!Number.isFinite(qty) || (dto.type !== 'adjust' && qty <= 0) || (dto.type === 'adjust' && qty === 0)) {
      throw new BadRequestException('Укажите количество');
    }
    if (dto.clientUid) {
      const done = (await this.movements.exists({ clientUid: dto.clientUid })) || (await this.reservations.exists({ clientUid: dto.clientUid }));
      if (done) return this.getItem(materialId);
    }
    const matId = new Types.ObjectId(materialId);
    if (!(await this.materials.exists({ _id: matId, deletedAt: null }))) throw new NotFoundException('Позиция не найдена');
    const wh = await this.defaultWarehouse();
    const note = dto.note?.trim() || undefined;
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const item = await this.loadStorage(wh._id as Types.ObjectId, matId, session);
        const movement = (type: 'in' | 'out' | 'adjust', q: number, ref?: string) =>
          this.movements.create([{ type, date: new Date(), materialId: matId, warehouseId: wh._id, qty: q, documentRef: ref, notes: note, clientUid: dto.clientUid, createdBy }], { session });

        if (dto.type === 'in') {
          item.quantity = (item.quantity ?? 0) + qty;
          await item.save({ session });
          await movement('in', qty, dto.documentRef);
        } else if (dto.type === 'out') {
          if ((item.quantity ?? 0) < qty) throw new BadRequestException(`Недостаточно на складе: есть ${item.quantity ?? 0}, нужно ${qty}`);
          item.quantity = (item.quantity ?? 0) - qty;
          if ((item.reservedQty ?? 0) > 0) item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - qty);
          await item.save({ session });
          await movement('out', qty, dto.documentRef);
        } else if (dto.type === 'adjust') {
          const next = (item.quantity ?? 0) + qty;
          if (next < 0) throw new BadRequestException(`Остаток не может стать отрицательным (${next})`);
          item.quantity = next;
          await item.save({ session });
          await movement('adjust', Math.abs(qty), `ADJUST:${note ?? 'корректировка'}`);
        } else if (dto.type === 'reserve') {
          const free = (item.quantity ?? 0) - (item.reservedQty ?? 0);
          if (free < qty) throw new BadRequestException(`Недостаточно свободного остатка: ${free}, нужно ${qty}`);
          item.reservedQty = (item.reservedQty ?? 0) + qty;
          await item.save({ session });
          await this.reservations.create([{ orderId: note ?? 'Бронь', materialId: matId, warehouseId: wh._id, qty, isActive: true, status: 'active', notes: note, clientUid: dto.clientUid }], { session });
        } else if (dto.type === 'unreserve') {
          let left = Math.min(qty, item.reservedQty ?? 0);
          if (left <= 0) throw new BadRequestException('Брони по позиции нет');
          item.reservedQty = (item.reservedQty ?? 0) - left;
          await item.save({ session });
          const active = await this.reservations.find({ materialId: matId, warehouseId: wh._id, status: 'active', deletedAt: null }).sort({ createdAt: 1 }).session(session).exec();
          for (const r of active) {
            if (left <= 0) break;
            if (r.qty <= left) { left -= r.qty; r.status = 'released'; r.isActive = false; }
            else { r.qty -= left; left = 0; }
            await r.save({ session });
          }
          // Запись-след снятия брони (история + защита от повтора по clientUid)
          await this.reservations.create([{ orderId: note ?? 'Снятие брони', materialId: matId, warehouseId: wh._id, qty, isActive: false, status: 'released', notes: note ?? 'снятие брони', clientUid: dto.clientUid }], { session });
        } else {
          throw new BadRequestException('Неизвестный тип движения');
        }
      });
    } finally {
      await session.endSession();
    }
    return this.getItem(materialId);
  }

  private async loadStorage(warehouseId: Types.ObjectId, materialId: Types.ObjectId, session: ClientSession): Promise<StorageItemDocument> {
    const found = await this.storage.findOne({ warehouseId, materialId, deletedAt: null }).sort({ zoneName: 1 }).session(session).exec();
    if (found) return found;
    const [created] = await this.storage.create([{ warehouseId, materialId, quantity: 0, reservedQty: 0, isActive: true }], { session });
    return created;
  }

  /** История позиции: движения склада и брони, новые сверху. */
  async history(materialId: string) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    const matId = new Types.ObjectId(materialId);
    const [mv, rs] = await Promise.all([
      this.movements.find({ materialId: matId, deletedAt: null }).sort({ date: -1 }).limit(200).lean().exec(),
      this.reservations.find({ materialId: matId, deletedAt: null }).sort({ createdAt: -1 }).limit(200).lean().exec(),
    ]);
    const items = [
      ...mv.map((m) => ({ kind: 'movement', type: m.type, qty: m.qty, date: m.date, note: m.notes ?? (m.documentRef?.startsWith('ADJUST:') ? m.documentRef.slice(7) : m.documentRef), source: (m as { source?: string }).source })),
      ...rs.map((r) => ({ kind: 'reservation', type: r.status === 'released' && r.isActive === false && /снят/i.test(r.notes ?? r.orderId) ? 'unreserve' : 'reserve', status: r.status, qty: r.qty, date: (r as { createdAt?: Date }).createdAt, note: r.notes ?? r.orderId })),
    ].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
    return { items, total: items.length };
  }

  /** Для сверки/тестов: суммарно по складу. */
  async totals() {
    const wh = await this.defaultWarehouse();
    const [items, materials] = await Promise.all([
      this.storage.countDocuments({ warehouseId: wh._id, materialId: { $ne: null }, deletedAt: null }).exec(),
      this.materials.countDocuments({ deletedAt: null }).exec(),
    ]);
    return { warehouse: wh.name, storageItems: items, materials };
  }

  static norm = normText;
}
