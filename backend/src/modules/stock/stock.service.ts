import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { dateRange, escapeRe, oid, oids, parseList } from '../../common/list-query';
import { isUsedByCrm, isUsedInComposition } from '../catalog/catalog-references';
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
  /** Служебное: это движение отменяет движение с этим id. */
  cancelOf?: Types.ObjectId;
}

/** Поля, по которым можно сортировать позиции склада. */
const ITEM_SORT = ['name', 'categoryName', 'unit', 'article', 'quantity', 'reservedQty', 'free', 'minQuantity', 'status', 'updatedAt', 'deletedAt'];
const MOVE_LABEL: Record<string, string> = { in: 'Приход', out: 'Списание', adjust: 'Корректировка', transfer: 'Перемещение' };

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

  /**
   * Позиции склада: материалы + остаток на складе по умолчанию (материал без остатка → 0).
   * Остаток лежит в другой коллекции, поэтому фильтр по состоянию, сортировка и страницы — в памяти
   * (сотни–тысячи позиций — это быстро). status: ok | low | none | reserved (через запятую). deleted=1 — корзина.
   */
  async listItems(q: Record<string, unknown> & { materialIds?: Types.ObjectId[] } = {}) {
    const wh = await this.defaultWarehouse();
    const p = parseList(q, { sortable: ITEM_SORT, defaultSort: 'name', defaultLimit: 1000, maxLimit: 10000 });
    const filter: Record<string, unknown> = { deletedAt: p.deleted ? { $ne: null } : null };
    if (p.search) filter.$or = [{ name: p.search }, { article: p.search }, { sku: p.search }, { notes: p.search }];
    if (q.categoryId) { const ids = oids(q.categoryId); filter.categoryId = { $in: [...ids, ...ids.map(String)] }; }
    if (q.materialIds) filter._id = { $in: q.materialIds };

    const mats = await this.materials.find(filter).setOptions({ includeSoftDeleted: true }).lean().exec();
    const ids = mats.map((m) => m._id as Types.ObjectId);
    const [stocks, cats] = await Promise.all([
      this.storage.find({ warehouseId: wh._id, materialId: { $in: ids }, deletedAt: p.deleted ? undefined : null }).setOptions({ includeSoftDeleted: true }).lean().exec(),
      this.connection.db!.collection('categories').find({}, { projection: { name: 1 } }).toArray(),
    ]);
    const catName = new Map(cats.map((c) => [String(c._id), String(c.name)]));
    const byMat = new Map<string, { quantity: number; reservedQty: number; minQuantity: number; weightKg?: number; zoneName?: string; id: string }>();
    for (const s of stocks) {
      const k = String(s.materialId);
      const cur = byMat.get(k);
      if (cur) { cur.quantity += s.quantity ?? 0; cur.reservedQty += s.reservedQty ?? 0; continue; }
      byMat.set(k, { id: String(s._id), quantity: s.quantity ?? 0, reservedQty: s.reservedQty ?? 0, minQuantity: s.minQuantity ?? 0, weightKg: s.weightKg, zoneName: s.zoneName });
    }
    let rows = mats.map((m) => {
      const st = byMat.get(String(m._id));
      const quantity = st?.quantity ?? 0, reservedQty = st?.reservedQty ?? 0, minQuantity = st?.minQuantity ?? 0;
      return {
        id: String(m._id), materialId: String(m._id), name: m.name, article: m.article, sku: m.sku, unit: m.unit,
        categoryId: m.categoryId ? String(m.categoryId) : null, categoryName: m.categoryId ? catName.get(String(m.categoryId)) ?? null : null,
        notes: m.notes, quantity, reservedQty, free: quantity - reservedQty, minQuantity,
        weightKg: st?.weightKg ?? m.weightKg, zoneName: st?.zoneName ?? null, storageItemId: st?.id ?? null,
        photoIds: (m.photoIds ?? []) as Types.ObjectId[],
        status: quantity <= 0 ? 'none' : minQuantity > 0 && quantity - reservedQty < minQuantity ? 'low' : 'ok',
        updatedAt: (m as { updatedAt?: Date }).updatedAt,
        deletedAt: (m as { deletedAt?: Date | null }).deletedAt ?? null,
      };
    });
    // Счётчики по состоянию — для чипов фильтра (до фильтра по состоянию)
    const counts = { all: rows.length, ok: 0, low: 0, none: 0, reserved: 0 };
    for (const r of rows) { counts[r.status as 'ok' | 'low' | 'none']++; if (r.reservedQty > 0) counts.reserved++; }
    if (q.status) {
      const want = new Set(String(q.status).split(','));
      rows = rows.filter((r) => want.has(r.status) || (want.has('reserved') && r.reservedQty > 0));
    }
    const [[field, dir]] = Object.entries(p.sort);
    const key = field as keyof (typeof rows)[number];
    rows.sort((a, b) => {
      const x = a[key], y = b[key];
      const c = typeof x === 'number' || typeof y === 'number' ? Number(x ?? 0) - Number(y ?? 0)
        : x instanceof Date || y instanceof Date ? new Date((x as Date) ?? 0).getTime() - new Date((y as Date) ?? 0).getTime()
          : String(x ?? '').localeCompare(String(y ?? ''), 'ru');
      return c * dir || String(a.name).localeCompare(String(b.name), 'ru');
    });
    const page = rows.slice(p.skip, p.skip + p.limit);
    const photos = await this.photoMap(page.flatMap((r) => r.photoIds));
    const items = page.map(({ photoIds, ...r }) => ({ ...r, photos: photoIds.map((id) => photos.get(String(id))).filter(Boolean) }));
    return { items, total: rows.length, page: p.page, limit: p.limit, counts, warehouseId: String(wh._id), warehouseName: wh.name };
  }

  /** Сводка по категориям (плитки «Склада»): сколько позиций, сколько к закупке и сколько нет на складе. */
  async categorySummary() {
    const all = await this.listItems({ limit: 100000 } as Record<string, unknown>);
    const by = new Map<string, { id: string; name: string; total: number; low: number; none: number }>();
    for (const i of all.items) {
      const id = i.categoryId ?? 'none';
      const c = by.get(id) ?? { id, name: i.categoryName ?? 'Без категории', total: 0, low: 0, none: 0 };
      c.total++;
      if (i.status === 'low') c.low++;
      if (i.status === 'none') c.none++;
      by.set(id, c);
    }
    const items = [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ru'));
    return { items, total: all.total };
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
    await this.markEdited(_id);
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
        const movement = (type: 'in' | 'out' | 'adjust', q: number, ref: string | undefined, delta: number) =>
          this.movements.create([{ type, date: new Date(), materialId: matId, warehouseId: wh._id, qty: q, delta, documentRef: ref, notes: note, clientUid: dto.clientUid, createdBy, ...(dto.cancelOf ? { cancelOf: dto.cancelOf } : {}) }], { session });

        if (dto.type === 'in') {
          item.quantity = (item.quantity ?? 0) + qty;
          await item.save({ session });
          await movement('in', qty, dto.documentRef, qty);
        } else if (dto.type === 'out') {
          if ((item.quantity ?? 0) < qty) throw new BadRequestException(`Недостаточно на складе: есть ${item.quantity ?? 0}, нужно ${qty}`);
          item.quantity = (item.quantity ?? 0) - qty;
          if ((item.reservedQty ?? 0) > 0) item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - qty);
          await item.save({ session });
          await movement('out', qty, dto.documentRef, -qty);
        } else if (dto.type === 'adjust') {
          const next = (item.quantity ?? 0) + qty;
          if (next < 0) throw new BadRequestException(`Остаток не может стать отрицательным (${next})`);
          item.quantity = next;
          await item.save({ session });
          await movement('adjust', Math.abs(qty), `ADJUST:${note ?? 'корректировка'}`, qty);
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
    await this.markEdited(matId);
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

  /**
   * В корзину: только пустая позиция (без остатка и брони) и не используемая в CRM.
   * Иначе 409 с объяснением, что сделать.
   */
  async removeItem(materialId: string) {
    const _id = oid(materialId, 'позиции');
    const item = await this.getItem(materialId);
    if (item.quantity > 0) throw new ConflictException(`На складе остаток ${item.quantity} ${item.unit ?? ''} — сначала спишите его или сделайте корректировку до 0`.replace(/\s+—/, ' —'));
    if (item.reservedQty > 0) throw new ConflictException(`По позиции есть бронь ${item.reservedQty} — сначала снимите бронь`);
    const db = this.materials.db;
    if ((await isUsedInComposition(db, 'material', _id)) || (await isUsedByCrm(db, 'material', _id))) {
      throw new ConflictException('Позиция используется в CRM (состав изделий, калькуляции или закупки) — удалить нельзя');
    }
    const now = new Date();
    await this.materials.updateOne({ _id, deletedAt: null }, { $set: { deletedAt: now } }).exec();
    await this.markEdited(_id);
    await this.storage.updateMany({ materialId: _id, deletedAt: null }, { $set: { deletedAt: now } }).exec();
    return { id: materialId, deleted: true };
  }

  async restoreItem(materialId: string) {
    const _id = oid(materialId, 'позиции');
    const mat = await this.materials.findOne({ _id, deletedAt: { $ne: null } }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (!mat) throw new NotFoundException('Позиции нет в корзине');
    const twin = await this.findMaterialByName(mat.name);
    if (twin) throw new ConflictException(`Уже есть позиция «${twin.name}» — переименуйте её или удалите, потом восстановите эту`);
    const when = (mat as { deletedAt?: Date }).deletedAt;
    await this.materials.updateOne({ _id }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    // Строки остатка, удалённые вместе с позицией, возвращаются вместе с ней
    await this.storage.updateMany({ materialId: _id, deletedAt: when }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    return this.getItem(materialId);
  }

  /**
   * Журнал движений по всем позициям (раздел «Движения»): страницы, тип, период, позиция, поиск по наименованию.
   * `delta` — изменение остатка со знаком; у записей из Google-таблицы остаток по ним не менялся (source).
   */
  async listMovements(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: ['date', 'qty', 'type', 'createdAt'], defaultSort: '-date', defaultLimit: 50, maxLimit: 500 });
    const filter: Record<string, unknown> = { deletedAt: null, materialId: { $ne: null } };
    if (q.type) filter.type = { $in: String(q.type).split(',') };
    const range = dateRange(q.from, q.to);
    if (range) filter.date = range;
    if (q.materialId) filter.materialId = { $in: oids(q.materialId) };
    if (q.id) filter._id = oid(q.id, 'движения');
    if (p.search) {
      const mats = await this.materials.find({ $or: [{ name: p.search }, { article: p.search }] }, { _id: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
      filter.$or = [{ materialId: { $in: mats.map((m) => m._id) } }, { notes: p.search }];
    }
    const [docs, total] = await Promise.all([
      this.movements.find(filter).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
      this.movements.countDocuments(filter).exec(),
    ]);
    const mats = await this.materials.find({ _id: { $in: docs.map((d) => d.materialId) } }, { name: 1, unit: 1, deletedAt: 1 })
      .setOptions({ includeSoftDeleted: true }).lean().exec();
    const byId = new Map(mats.map((m) => [String(m._id), m]));
    const users = await this.connection.db!.collection('users')
      .find({ _id: { $in: docs.map((d) => d.createdBy).filter(Boolean) as Types.ObjectId[] } }, { projection: { displayName: 1, username: 1 } }).toArray();
    const userName = new Map(users.map((u) => [String(u._id), String(u.displayName || u.username)]));
    const items = docs.map((m) => {
      const mat = byId.get(String(m.materialId));
      const d = m as typeof m & { delta?: number; cancelledAt?: Date; cancelOf?: Types.ObjectId; source?: string };
      return {
        id: String(m._id), date: m.date, type: m.type, typeLabel: MOVE_LABEL[m.type] ?? m.type, qty: m.qty,
        delta: d.delta ?? (m.type === 'out' ? -m.qty : m.qty),
        materialId: String(m.materialId), materialName: mat?.name ?? '(позиция удалена)', unit: mat?.unit ?? '',
        note: m.notes ?? (m.documentRef?.startsWith('ADJUST:') ? m.documentRef.slice(7) : m.documentRef) ?? '',
        source: d.source ?? null, fromSheet: d.source === 'google-sheets',
        cancelledAt: d.cancelledAt ?? null, cancelOf: d.cancelOf ? String(d.cancelOf) : null,
        createdBy: m.createdBy ? userName.get(String(m.createdBy)) ?? null : null,
        canCancel: d.source !== 'google-sheets' && !d.cancelledAt && !d.cancelOf && m.type !== 'transfer' && d.delta !== undefined,
      };
    });
    return { items, total, page: p.page, limit: p.limit };
  }

  /**
   * Отменить ошибочное движение: проводится обратное (история не стирается), исходное помечается отменённым.
   * Записи из Google-таблицы не отменяются — остаток по ним не менялся.
   */
  async cancelMovement(id: string, userId?: string) {
    const mv = await this.movements.findOne({ _id: oid(id, 'движения'), deletedAt: null }).lean().exec();
    if (!mv) throw new NotFoundException('Движение не найдено');
    const d = mv as typeof mv & { delta?: number; cancelledAt?: Date; cancelOf?: Types.ObjectId; source?: string };
    if (d.source === 'google-sheets') throw new ConflictException('Это запись истории из Google-таблицы: остаток по ней не менялся, отменять нечего');
    if (d.cancelledAt) throw new ConflictException('Движение уже отменено');
    if (d.cancelOf) throw new ConflictException('Это само отмена — проведите новое движение');
    if (d.delta === undefined || !mv.materialId) throw new ConflictException('Это движение создано в CRM — отмените его там или сделайте корректировку');
    const when = new Date(mv.date).toLocaleDateString('ru-RU');
    const note = `Отмена: ${MOVE_LABEL[mv.type] ?? mv.type} от ${when}`;
    const back: MoveInput = d.delta > 0 ? { type: 'out', qty: d.delta, note } : { type: 'in', qty: -d.delta, note };
    if (mv.type === 'adjust') { back.type = 'adjust'; back.qty = -d.delta; }
    back.cancelOf = mv._id as Types.ObjectId;
    const item = await this.move(String(mv.materialId), back, userId);
    await this.movements.updateOne({ _id: mv._id }, { $set: { cancelledAt: new Date() } }).exec();
    return item;
  }

  /** Позиция изменена в приложении — синхронизация Google-таблицы её больше не перезаписывает (поле вне схемы CRM). */
  private markEdited(_id: Types.ObjectId) {
    return this.connection.db!.collection('materials').updateOne({ _id }, { $set: { editedInApp: true } });
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
