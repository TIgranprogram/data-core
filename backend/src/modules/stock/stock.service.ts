import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { dateRange, escapeRe, oid, oids, parseList } from '../../common/list-query';
import { isUsedByCrm, isUsedInComposition } from '../catalog/catalog-references';
import { CounterService } from '../counter/counter.service';
import { Material, MaterialDocument } from '../material/material.schema';
import { normText } from '../supply/org-resolver';
import { matchesAll, searchTokens } from './search-norm';
import { CategoryResolver } from './category-resolver';
import { type Dims, dimsOf, mergeDims, metalKind, offcutName } from './metal';
import { type ByWeight, gramsToKg, weightCount, weightGOf, weightNote } from './weight';
import { type ArticleDecision, articleView, decideArticle, isAutoArticle } from './article';
import { Reservation, ReservationDocument } from './schemas/reservation.schema';
import { StockMovement, StockMovementDocument } from './schemas/stock-movement.schema';
import { StorageItem, StorageItemDocument } from './schemas/storage-item.schema';
import { Warehouse, WarehouseDocument } from './schemas/warehouse.schema';

export type MoveType = 'in' | 'out' | 'adjust' | 'reserve' | 'unreserve' | 'count';

export interface StockItemInput {
  name?: string;
  unit?: string;
  article?: string;
  categoryId?: string;
  categoryName?: string;
  minQuantity?: number;
  weightKg?: number;
  /** Вес 1 шт., г (НО): пишется в weightKg (кг) с пометкой weightUnit 'kg'; null — стереть. */
  weightG?: number | null;
  notes?: string;
  /** Металл (СМ.1): сортамент / сечение, марка стали, размеры в мм (null — стереть). */
  assortment?: string | null;
  materialGrade?: string | null;
  dims?: Dims;
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
  /** Списание: кому выдано (TASKS Л.3) — сотрудник и/или текстом. */
  personId?: string;
  issuedTo?: string;
  /** Пересчёт (ФИ.4): остаток, который видел человек, — разошёлся с сервером → 409 «обновите». */
  expected?: number;
  /** Пересчёт / корректировка ниже брони — только с явным подтверждением. */
  force?: boolean;
  /** Количество по весу (НО): приход / пересчёт; штуки считает сервер, вес 1 шт. может сохранить в позицию. */
  byWeight?: ByWeight & { saveUnitWeight?: boolean };
}

/**
 * Пересчёт (TASKS ФИ.4): проверки до записи. «Сколько лежит» — ВСЕГО, вместе с бронью (бронь лежит на складе).
 * Меньше 0 — нельзя; меньше брони — только с force (иначе свободно станет минусом).
 */
export function countGuard(target: number, current: number, reserved: number, force?: boolean): string | null {
  if (!Number.isFinite(target) || target < 0) return 'Остаток не может быть меньше 0';
  if (target < reserved && !force) return `Меньше, чем в брони (${reserved}): свободно станет ${Math.round((target - reserved) * 1000) / 1000}. Сначала снимите или выдайте бронь — или подтвердите`;
  return null;
}

/** ФИО сотрудника из persons (как в «Справочниках»). */
const personName = (p: { lastName?: unknown; firstName?: unknown; patronymic?: unknown }) =>
  [p.lastName, p.firstName, p.patronymic].map((x) => (x == null ? '' : String(x).trim())).filter(Boolean).join(' ');

/** Поля, по которым можно сортировать позиции склада. */
const ITEM_SORT = ['name', 'categoryName', 'unit', 'article', 'quantity', 'reservedQty', 'free', 'minQuantity', 'status', 'updatedAt', 'deletedAt', 'lastCountedAt'];
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
    // Поиск — в памяти (search-norm): «м10 гайка» = «Гайка …, M10 …», слова в любом порядке
    const tokens = q.search ? searchTokens(q.search) : [];
    if (q.categoryId) { const ids = oids(q.categoryId); filter.categoryId = { $in: [...ids, ...ids.map(String)] }; }
    if (q.materialIds) filter._id = { $in: q.materialIds };

    // металл (СМ.1): марка, сечение, толщина — фильтры «Остатков»
    if (q.grade) filter.materialGrade = String(q.grade);
    if (q.section) filter.assortment = String(q.section);
    if (q.thickness && Number(q.thickness) > 0) filter.dimensions = { $elemMatch: { type: 'thickness', value: Number(q.thickness) } };
    const mats = (await this.materials.find(filter).setOptions({ includeSoftDeleted: true }).lean().exec())
      .filter((m) => matchesAll(tokens, m.name, m.article, m.sku, m.notes, m.assortment, m.materialGrade, (m as { internalArticle?: string }).internalArticle));
    const ids = mats.map((m) => m._id as Types.ObjectId);
    const [stocks, cats] = await Promise.all([
      this.storage.find({ warehouseId: wh._id, materialId: { $in: ids }, deletedAt: p.deleted ? undefined : null }).setOptions({ includeSoftDeleted: true }).lean().exec(),
      this.connection.db!.collection('categories').find({}, { projection: { name: 1 } }).toArray(),
    ]);
    const catName = new Map(cats.map((c) => [String(c._id), String(c.name)]));
    // «уже заказано» (ЗП.2): открытые заявки на позицию — по materialId или по тому же наименованию
    const openReq = await this.openRequests(mats as { _id: Types.ObjectId; name?: string }[]);
    // обрезки этих позиций (СМ.2): родитель → [{ id, name, qty }] с остатком > 0 — «сначала брать обрезки»
    const kids = await this.connection.db!.collection('materials').find({ offcutOf: { $in: ids }, deletedAt: null }, { projection: { name: 1, offcutOf: 1, dimensions: 1 } }).toArray();
    const kidStock = kids.length ? await this.storage.find({ warehouseId: wh._id, materialId: { $in: kids.map((k) => k._id) }, deletedAt: null }).lean().exec() : [];
    const kidQty = new Map<string, number>();
    for (const s of kidStock) kidQty.set(String(s.materialId), (kidQty.get(String(s.materialId)) ?? 0) + (s.quantity ?? 0));
    const offcutsOf = new Map<string, { id: string; name: string; qty: number; length: number | null }[]>();
    for (const k of kids) {
      const n = kidQty.get(String(k._id)) ?? 0;
      if (n <= 0) continue;
      const list = offcutsOf.get(String(k.offcutOf)) ?? [];
      list.push({ id: String(k._id), name: String(k.name), qty: n, length: dimsOf(k.dimensions).length ?? null });
      offcutsOf.set(String(k.offcutOf), list);
    }
    const byMat = new Map<string, { quantity: number; reservedQty: number; minQuantity: number; weightKg?: number; zoneName?: string; id: string; lastCountedAt?: Date }>();
    for (const s of stocks) {
      const k = String(s.materialId);
      const cur = byMat.get(k);
      if (cur) { cur.quantity += s.quantity ?? 0; cur.reservedQty += s.reservedQty ?? 0; continue; }
      byMat.set(k, { id: String(s._id), quantity: s.quantity ?? 0, reservedQty: s.reservedQty ?? 0, minQuantity: s.minQuantity ?? 0, weightKg: s.weightKg, zoneName: s.zoneName, lastCountedAt: (s as { lastCountedAt?: Date }).lastCountedAt });
    }
    let rows = mats.map((m) => {
      const st = byMat.get(String(m._id));
      const quantity = st?.quantity ?? 0, reservedQty = st?.reservedQty ?? 0, minQuantity = st?.minQuantity ?? 0;
      return {
        id: String(m._id), materialId: String(m._id), name: m.name, article: m.article, sku: m.sku, unit: m.unit,
        // АР.1: артикул поставщика и внутренний код (СКЛ-… / sku) — раздельно; откуда взят артикул
        ...articleView(m as { article?: unknown; sku?: unknown; internalArticle?: unknown }), articleSource: (m as { articleSource?: string }).articleSource ?? null,
        categoryId: m.categoryId ? String(m.categoryId) : null, categoryName: m.categoryId ? catName.get(String(m.categoryId)) ?? null : null,
        notes: m.notes, quantity, reservedQty, free: quantity - reservedQty, minQuantity,
        ordered: Math.round((openReq.get(String(m._id)) ?? []).reduce((s, r) => s + (r.qty || 0), 0) * 1000) / 1000,
        assortment: m.assortment ?? null, materialGrade: m.materialGrade ?? null, dims: dimsOf(m.dimensions),
        metal: metalKind(m.categoryId ? catName.get(String(m.categoryId)) : null, m.unit),
        offcutOf: (m as { offcutOf?: Types.ObjectId }).offcutOf ? String((m as { offcutOf?: Types.ObjectId }).offcutOf) : null,
        offcuts: offcutsOf.get(String(m._id)) ?? [],
        weightKg: st?.weightKg ?? m.weightKg, weightG: weightGOf(m as { weightKg?: unknown; weightUnit?: unknown }), zoneName: st?.zoneName ?? null, storageItemId: st?.id ?? null,
        lastCountedAt: st?.lastCountedAt ?? null,
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

  /**
   * Открытые заявки снабжения (ожидает / заказать / в работе) по позициям (ЗП.1–ЗП.3): заявка привязана `materialId`
   * или (заявки из Google-таблицы) совпадает наименованием. materialId → заявки.
   */
  async openRequests(mats: { _id: Types.ObjectId; name?: string }[]) {
    const out = new Map<string, { id: string; num: number | null; title: string; qty: number; unit: string; status: string; paid: boolean; invoiceDate: Date | null; requestDate: Date | null; requestedBy: string | null; supplierId: Types.ObjectId | null }[]>();
    if (!mats.length) return out;
    const byName = new Map(mats.map((m) => [normText(String(m.name ?? '')), String(m._id)]));
    const ids = mats.map((m) => m._id);
    const docs = await this.connection.db!.collection('supplyrequests').find({ deletedAt: null, status: { $in: ['in_progress', 'requested', 'ordered'] },
      $or: [{ materialId: { $in: ids } }, { materialId: null }, { materialId: { $exists: false } }] },
    { projection: { num: 1, title: 1, qty: 1, unit: 1, status: 1, paid: 1, invoiceDate: 1, requestDate: 1, requestedBy: 1, supplierId: 1, materialId: 1 } }).toArray();
    for (const d of docs) {
      const key = d.materialId ? String(d.materialId) : byName.get(normText(String(d.title ?? '')));
      if (!key) continue;
      const list = out.get(key) ?? [];
      list.push({ id: String(d._id), num: (d.num as number) ?? null, title: String(d.title ?? ''), qty: Number(d.qty) || 0, unit: String(d.unit ?? ''), status: String(d.status), paid: !!d.paid,
        invoiceDate: (d.invoiceDate as Date) ?? null, requestDate: (d.requestDate as Date) ?? null, requestedBy: (d.requestedBy as string) ?? null, supplierId: (d.supplierId as Types.ObjectId) ?? null });
      out.set(key, list);
    }
    return out;
  }

  /**
   * «Заказано» и «Поставщики / цены» в карточке позиции (ЗП.1, ЗП.5): открытые заявки (№, кол-во, статус, дата счёта, кто),
   * «в пути» итогом; полученные заявки — у кого брали и почём (последняя цена за ед.; деньги — только деньги-ролям).
   */
  async itemOrdered(materialId: string, canMoney: boolean) {
    const mat = await this.materials.findOne({ _id: oid(materialId, 'позиции'), deletedAt: null }, { name: 1 }).lean().exec();
    if (!mat) throw new NotFoundException('Позиция не найдена');
    const open = (await this.openRequests([mat as { _id: Types.ObjectId; name?: string }])).get(String(mat._id)) ?? [];
    const db = this.connection.db!;
    const got = await db.collection('supplyrequests').find({ deletedAt: null, status: 'received', $or: [{ materialId: mat._id }, { title: { $regex: `^\\s*${escapeRe(String(mat.name))}\\s*$`, $options: 'i' } }] },
      { projection: { qty: 1, priceHint: 1, supplierId: 1, receivedAt: 1, invoiceDate: 1, requestDate: 1 } }).sort({ receivedAt: -1, invoiceDate: -1 }).limit(200).toArray();
    const orgIds = [...open.map((r) => r.supplierId), ...got.map((g) => g.supplierId)].filter(Boolean) as Types.ObjectId[];
    const orgs = orgIds.length ? await db.collection('organizations').find({ _id: { $in: orgIds } }, { projection: { name: 1, shortName: 1 } }).toArray() : [];
    const on = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const LBL: Record<string, string> = { in_progress: 'Ожидает', requested: 'Заказать', ordered: 'В работе' };
    const sup = new Map<string, { name: string; count: number; lastDate: Date | null; lastPrice: number | null }>();
    for (const g of got) {
      const name = g.supplierId ? on.get(String(g.supplierId)) ?? 'Поставщик не указан' : 'Поставщик не указан';
      const s = sup.get(name) ?? { name, count: 0, lastDate: null, lastPrice: null };
      s.count++;
      const when = (g.receivedAt ?? g.invoiceDate ?? g.requestDate) as Date | null;
      if (s.count === 1) { s.lastDate = when ?? null; s.lastPrice = canMoney && Number(g.priceHint) > 0 && Number(g.qty) > 0 ? Math.round((Number(g.priceHint) / Number(g.qty)) * 100) / 100 : null; }
      sup.set(name, s);
    }
    return {
      open: open.map(({ supplierId, ...r }) => ({ ...r, statusLabel: r.status === 'ordered' && r.paid ? 'Оплачено' : LBL[r.status] ?? r.status, supplier: supplierId ? on.get(String(supplierId)) ?? null : null })),
      inTransit: Math.round(open.reduce((s, r) => s + r.qty, 0) * 1000) / 1000,
      suppliers: [...sup.values()].sort((a, b) => b.count - a.count),
    };
  }

  /** Сводка по категориям (плитки «Склада»): сколько позиций, сколько к закупке и сколько нет на складе. */
  async categorySummary() {
    const all = await this.listItems({ limit: 100000 } as Record<string, unknown>);
    const by = new Map<string, { id: string; name: string; total: number; low: number; none: number; ordered: number }>();
    for (const i of all.items) {
      const id = i.categoryId ?? 'none';
      const c = by.get(id) ?? { id, name: i.categoryName ?? 'Без категории', total: 0, low: 0, none: 0, ordered: 0 };
      c.total++;
      if (i.ordered > 0) c.ordered++;
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
    if (!existing && dto.article?.trim()) await this.assertArticleFree(dto.article.trim());
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
      ...(dto.assortment?.trim() ? { assortment: dto.assortment.trim() } : {}), ...(dto.materialGrade?.trim() ? { materialGrade: dto.materialGrade.trim() } : {}),
      ...(dto.dims ? { dimensions: mergeDims([], dto.dims) } : {}),
    });
    if (dto.weightG !== undefined) await this.setWeightG(mat._id as Types.ObjectId, dto.weightG);
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
    if (dto.article?.trim() && dto.article.trim() !== mat.article) {
      // АР.3: артикул уникален; прежний автоартикул остаётся внутренним кодом; откуда — «вручную»
      await this.assertArticleFree(dto.article.trim(), _id);
      set.article = dto.article.trim();
      await this.connection.db!.collection('materials').updateOne({ _id }, { $set: { articleSource: 'вручную', articleSetAt: new Date(), ...(isAutoArticle(mat.article) && mat.article ? { internalArticle: mat.article } : {}) } });
    }
    if (dto.notes !== undefined) set.notes = dto.notes;
    if (dto.weightKg !== undefined) set.weightKg = dto.weightKg;
    for (const k of ['assortment', 'materialGrade'] as const) if (dto[k] !== undefined) set[k] = dto[k]?.trim() || null;
    if (dto.dims) set.dimensions = mergeDims(mat.dimensions, dto.dims);
    if (dto.categoryId && Types.ObjectId.isValid(dto.categoryId)) set.categoryId = new Types.ObjectId(dto.categoryId);
    else if (dto.categoryName) set.categoryId = await new CategoryResolver(this.connection).resolve(dto.categoryName);
    if (Object.keys(set).length) await this.materials.updateOne({ _id }, { $set: set }).exec();
    if (dto.weightG !== undefined) await this.setWeightG(_id, dto.weightG);
    await this.markEdited(_id);
    if (dto.minQuantity !== undefined || dto.weightKg !== undefined) {
      const wh = await this.defaultWarehouse();
      await this.storage.updateOne(
        { warehouseId: wh._id, materialId: _id, zoneName: null },
        { $setOnInsert: { warehouseId: wh._id, materialId: _id, quantity: 0, reservedQty: 0, isActive: true, deletedAt: null, photos: [] },
          $set: { ...(dto.minQuantity !== undefined ? { minQuantity: dto.minQuantity ?? 0 } : {}), ...(dto.weightKg !== undefined ? { weightKg: dto.weightKg } : {}) } },
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

  async removePhoto(materialId: string, photoId: string) {
    const _id = oid(materialId, 'позиции'); const pid = oid(photoId, 'фото');
    const m = await this.materials.findOne({ _id, deletedAt: null }, { photoIds: 1, mainPhotoId: 1 }).lean().exec();
    if (!m) throw new NotFoundException('Позиция не найдена');
    const rest = ((m.photoIds ?? []) as Types.ObjectId[]).filter((p) => String(p) !== String(pid));
    const main = String(m.mainPhotoId ?? '') === String(pid) ? rest[0] ?? null : m.mainPhotoId ?? null;
    await this.materials.updateOne({ _id }, { $set: { photoIds: rest, mainPhotoId: main } }).exec();
    await this.markEdited(_id);
    return this.getItem(materialId);
  }

  /**
   * Движение по позиции. in/out/adjust — как в CRM (остаток в storageitems + запись в stockmovements);
   * reserve/unreserve — reservedQty + reservations. Повтор с тем же clientUid ничего не меняет.
   */
  async move(materialId: string, dto: MoveInput, userId?: string) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    if (dto.byWeight) dto = await this.applyWeight(materialId, dto);
    const qty = Number(dto.qty);
    if (!Number.isFinite(qty) || (!['adjust', 'count'].includes(dto.type) && qty <= 0) || (dto.type === 'adjust' && qty === 0) || (dto.type === 'count' && qty < 0)) {
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
    const target = dto.type === 'out' ? await this.issueTarget(dto.personId, dto.issuedTo) : {};

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const item = await this.loadStorage(wh._id as Types.ObjectId, matId, session);
        const before = item.quantity ?? 0;
        // «было → стало» у каждого движения (ФИ.5)
        const movement = (type: 'in' | 'out' | 'adjust', q: number, ref: string | undefined, delta: number) =>
          this.movements.create([{ type, date: new Date(), materialId: matId, warehouseId: wh._id, qty: q, delta, documentRef: ref, notes: note, clientUid: dto.clientUid, createdBy,
            qtyBefore: before, qtyAfter: Math.round((before + delta) * 1000) / 1000, ...(dto.cancelOf ? { cancelOf: dto.cancelOf } : {}), ...(type === 'out' ? target : {}) }], { session });

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
        } else if (dto.type === 'count') {
          // ФИ.4: человек ввёл, сколько лежит ВСЕГО; разницу считает сервер от своего остатка (не от числа на экране)
          if (dto.expected !== undefined && Math.abs(Number(dto.expected) - before) > 1e-9) {
            throw new ConflictException(`Остаток изменился, пока была открыта карточка: было ${dto.expected}, сейчас ${before}. Обновите карточку и пересчитайте ещё раз`);
          }
          const why = countGuard(qty, before, item.reservedQty ?? 0, dto.force);
          if (why) throw qty < 0 ? new BadRequestException(why) : new ConflictException(why);
          const delta = Math.round((qty - before) * 1000) / 1000;
          if (delta !== 0) {
            item.quantity = qty;
            await item.save({ session });
            await movement('adjust', Math.abs(delta), `ADJUST:${note ?? 'пересчёт'}`, delta);
          }
          await this.connection.db!.collection('storageitems').updateOne({ _id: item._id }, { $set: { lastCountedAt: new Date() } }, { session });
        } else if (dto.type === 'adjust') {
          const next = (item.quantity ?? 0) + qty;
          if (next < 0) throw new BadRequestException(`Остаток не может стать отрицательным (${next})`);
          const why = countGuard(next, before, item.reservedQty ?? 0, dto.force);
          if (why) throw new ConflictException(why);
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

  /**
   * Пакет операций (экран «Операции»): несколько позиций одной транзакцией — всё или ничего.
   * out — проверяет все позиции заранее и называет каждую, где не хватает; count — qty = сколько лежит
   * фактически: проводит корректировку на разницу и ставит дату пересчёта (`lastCountedAt`, поле вне схемы CRM).
   * Все движения пакета помечены `batchId` — отменяются одной кнопкой.
   */
  async batch(dto: { type: 'in' | 'out' | 'count'; lines: { materialId: string; qty: number; note?: string }[]; note?: string; documentRef?: string; clientUid?: string; salesOrderId?: string; salesOrderLineId?: string; personId?: string; issuedTo?: string; force?: boolean }, userId?: string) {
    if (dto.clientUid) {
      const prev = await this.movements.findOne({ clientUid: dto.clientUid, batchId: { $ne: null } }).lean().exec();
      if (prev) return this.batchResult(String((prev as { batchId?: Types.ObjectId }).batchId), dto.type);
    }
    // Одна позиция дважды — складываем (приход/списание) или берём последнюю (пересчёт)
    const merged = new Map<string, number>();
    const lineNote = new Map<string, string>(); // расчёт по весу у строки (НО)
    for (const l of dto.lines) {
      if (l.note?.trim()) lineNote.set(l.materialId, l.note.trim());
      const n = Number(l.qty);
      if (!Number.isFinite(n) || n < 0 || (dto.type !== 'count' && n === 0)) throw new BadRequestException('Укажите количество больше нуля в каждой строке');
      merged.set(l.materialId, dto.type === 'count' ? n : (merged.get(l.materialId) ?? 0) + n);
    }
    const matIds = [...merged.keys()].map((id) => oid(id, 'позиции'));
    const mats = await this.materials.find({ _id: { $in: matIds }, deletedAt: null }, { name: 1 }).lean().exec();
    if (mats.length !== matIds.length) throw new NotFoundException('Часть позиций не найдена (удалены?) — обновите страницу');
    const nameOf = new Map(mats.map((m) => [String(m._id), String(m.name)]));
    const wh = await this.defaultWarehouse();
    const note = dto.note?.trim() || undefined;
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const batchId = new Types.ObjectId();
    const now = new Date();
    let moved = 0;
    // Под заказ: проверяем заказ; в CRM-поле orderId (строка) — тот же id, чтобы списание было видно и там
    let soRef: Record<string, unknown> = {};
    if (dto.salesOrderId) {
      const so = await this.connection.db!.collection('salesorders').findOne({ _id: new Types.ObjectId(dto.salesOrderId), deletedAt: null });
      if (!so) throw new BadRequestException('Заказ не найден');
      soRef = { salesOrderId: so._id, orderId: String(so._id), ...(dto.salesOrderLineId ? { salesOrderLineId: new Types.ObjectId(dto.salesOrderLineId) } : {}) };
    }
    if (dto.type === 'out') soRef = { ...soRef, ...(await this.issueTarget(dto.personId, dto.issuedTo)) };
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        moved = 0;
        const items = new Map<string, StorageItemDocument>();
        for (const id of matIds) items.set(String(id), await this.loadStorage(wh._id as Types.ObjectId, id, session));
        if (dto.type === 'out') {
          const short = [...merged].filter(([id, n]) => (items.get(id)!.quantity ?? 0) < n)
            .map(([id, n]) => `«${nameOf.get(id)}»: есть ${items.get(id)!.quantity ?? 0}, нужно ${n}`);
          if (short.length) throw new BadRequestException(`Недостаточно на складе — ${short.join('; ')}`);
        }
        if (dto.type === 'count' && !dto.force) {
          // ФИ.4: пересчёт ниже брони — только с подтверждением
          const low = [...merged].filter(([id, n]) => n < (items.get(id)!.reservedQty ?? 0))
            .map(([id, n]) => `«${nameOf.get(id)}»: лежит ${n}, в брони ${items.get(id)!.reservedQty}`);
          if (low.length) throw new ConflictException(`Меньше, чем в брони — ${low.join('; ')}. Сначала снимите или выдайте бронь — или подтвердите`);
        }
        for (const [id, n] of merged) {
          const item = items.get(id)!;
          const before = item.quantity ?? 0;
          const delta = dto.type === 'in' ? n : dto.type === 'out' ? -n : Math.round((n - before) * 1000) / 1000;
          if (delta !== 0) {
            item.quantity = Math.round((before + delta) * 1000) / 1000;
            if (dto.type === 'out' && (item.reservedQty ?? 0) > 0) item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - n);
            await item.save({ session });
            const type = dto.type === 'count' ? 'adjust' : dto.type;
            const ref = dto.type === 'count' ? `ADJUST:${note ?? 'пересчёт'}` : dto.documentRef;
            await this.movements.create([{ type, date: now, materialId: new Types.ObjectId(id), warehouseId: wh._id, qty: Math.abs(delta), delta, documentRef: ref, qtyBefore: before, qtyAfter: item.quantity,
              notes: [note, lineNote.get(id)].filter(Boolean).join('; ') || (dto.type === 'count' ? 'пересчёт' : undefined), clientUid: moved === 0 ? dto.clientUid : undefined, createdBy, batchId, ...(dto.type === 'out' ? soRef : {}) }], { session });
            moved++;
          }
          if (dto.type === 'count') {
            await this.connection.db!.collection('storageitems').updateOne({ _id: item._id }, { $set: { lastCountedAt: now } }, { session });
          }
        }
      });
    } finally {
      await session.endSession();
    }
    await this.connection.db!.collection('materials').updateMany({ _id: { $in: matIds } }, { $set: { editedInApp: true } });
    return { ...(await this.batchResult(String(batchId), dto.type, matIds)), lines: merged.size, moved };
  }

  private async batchResult(batchId: string, type: string, matIds?: Types.ObjectId[]) {
    const ids = matIds ?? ((await this.movements.distinct('materialId', { batchId: new Types.ObjectId(batchId) }).exec()) as Types.ObjectId[]);
    const items = ids.length ? (await this.listItems({ materialIds: ids, limit: 10000 })).items : [];
    return { batchId, type, items };
  }

  /** Отменить пакет: обратные движения ко всем его неотменённым движениям, одной транзакцией. */
  async cancelBatch(batchId: string, userId?: string) {
    const bid = oid(batchId, 'операции');
    const list = await this.movements.find({ batchId: bid, cancelledAt: null, deletedAt: null }).lean().exec();
    if (!list.length) throw new NotFoundException('Операция не найдена или уже отменена');
    const wh = await this.defaultWarehouse();
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const now = new Date();
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        for (const mv of list) {
          const d = (mv as { delta?: number }).delta ?? 0;
          const item = await this.loadStorage(wh._id as Types.ObjectId, mv.materialId as Types.ObjectId, session);
          const next = Math.round(((item.quantity ?? 0) - d) * 1000) / 1000;
          if (next < 0) {
            const m = await this.materials.findById(mv.materialId, { name: 1 }).lean().exec();
            throw new ConflictException(`Нельзя отменить: «${m?.name ?? 'позиция'}» уже израсходована (остаток станет ${next}). Сделайте пересчёт вручную.`);
          }
          item.quantity = next;
          // выдача по брони отменена — бронь возвращается (TASKS Б.2)
          const resId = (mv as { reservationId?: Types.ObjectId }).reservationId;
          if (resId && d < 0) {
            const r = await this.reservations.findById(resId).session(session).exec();
            if (r) {
              const back = Math.abs(d);
              r.qty = (r.status === 'active' ? r.qty : 0) + back;
              r.issuedQty = Math.max(0, (r.issuedQty ?? 0) - back);
              r.status = 'active'; r.isActive = true;
              await r.save({ session });
              item.reservedQty = (item.reservedQty ?? 0) + back;
            }
          }
          await item.save({ session });
          const when = new Date(mv.date).toLocaleDateString('ru-RU');
          const back = mv.type === 'adjust' ? 'adjust' : d > 0 ? 'out' : 'in';
          await this.movements.create([{ type: back, date: now, materialId: mv.materialId, warehouseId: wh._id, qty: Math.abs(d), delta: -d,
            documentRef: back === 'adjust' ? 'ADJUST:отмена пересчёта' : undefined, notes: `Отмена: ${MOVE_LABEL[mv.type] ?? mv.type} от ${when}`, createdBy, cancelOf: mv._id }], { session });
          await this.movements.updateOne({ _id: mv._id }, { $set: { cancelledAt: now } }, { session }).exec();
        }
      });
    } finally {
      await session.endSession();
    }
    return this.batchResult(batchId, 'cancel');
  }

  /**
   * Бронь по списку (TASKS МВ.4): спецификация конструктора → бронь на складе под названием (и заказом).
   * Каждая строка бронирует min(нужно, свободно); чего не хватает — в ответе `short` (для «Заказать недостающее»).
   * Все брони списка — с общим `batchId` и `groupName`: снимаются строкой или целиком (releaseReservation / releaseGroup).
   */
  async reserveList(dto: { groupName: string; lines: { materialId: string; qty: number }[]; salesOrderId?: string; clientUid?: string }, userId?: string) {
    const groupName = String(dto.groupName || '').trim();
    if (!groupName) throw new BadRequestException('Назовите бронь: для чего (конструкция, заказ)');
    if (dto.clientUid) {
      const prev = await this.reservations.findOne({ clientUid: dto.clientUid }).lean().exec();
      if (prev) return this.reservationGroup(String((prev as { batchId?: Types.ObjectId }).batchId));
    }
    const merged = new Map<string, number>();
    for (const l of dto.lines) { const n = Number(l.qty); if (!(n > 0)) throw new BadRequestException('Количество в каждой строке — больше нуля'); merged.set(l.materialId, (merged.get(l.materialId) ?? 0) + n); }
    const wh = await this.defaultWarehouse();
    const batchId = new Types.ObjectId();
    const so = dto.salesOrderId && Types.ObjectId.isValid(dto.salesOrderId) ? new Types.ObjectId(dto.salesOrderId) : undefined;
    const short: { materialId: string; need: number; reserved: number }[] = [];
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        short.length = 0;
        let first = true;
        for (const [id, need] of merged) {
          const matId = oid(id, 'позиции');
          const item = await this.loadStorage(wh._id as Types.ObjectId, matId, session);
          const free = Math.max(0, (item.quantity ?? 0) - (item.reservedQty ?? 0));
          const take = Math.min(need, free);
          if (take < need) short.push({ materialId: id, need, reserved: take });
          if (take <= 0) continue;
          item.reservedQty = (item.reservedQty ?? 0) + take;
          await item.save({ session });
          await this.reservations.create([{ orderId: groupName, materialId: matId, warehouseId: wh._id, qty: take, isActive: true, status: 'active', notes: groupName,
            batchId, groupName, createdBy, ...(so ? { salesOrderId: so } : {}), ...(first && dto.clientUid ? { clientUid: dto.clientUid } : {}) }], { session });
          first = false;
        }
      });
    } finally { await session.endSession(); }
    return { ...(await this.reservationGroup(String(batchId))), short };
  }

  /** Активные брони, сгруппированные по названию (для «Бронь по списку»). */
  async listReservations() {
    const docs = await this.reservations.find({ status: 'active', isActive: true, deletedAt: null }).sort({ createdAt: -1 }).limit(2000).lean().exec();
    const mats = await this.materials.find({ _id: { $in: docs.map((d) => d.materialId).filter(Boolean) } }, { name: 1, unit: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
    const nm = new Map(mats.map((m) => [String(m._id), m]));
    // Кто поставил и под какой заказ — чтобы на «Сегодня» было видно, чья бронь и для чего
    type Extra = { batchId?: Types.ObjectId; groupName?: string; createdAt?: Date; createdBy?: Types.ObjectId; salesOrderId?: Types.ObjectId };
    const ex = docs as (typeof docs[number] & Extra)[];
    const [users, sos] = await Promise.all([
      this.connection.db!.collection('users').find({ _id: { $in: ex.map((d) => d.createdBy).filter(Boolean) as Types.ObjectId[] } }, { projection: { displayName: 1, username: 1 } }).toArray(),
      this.connection.db!.collection('salesorders').find({ _id: { $in: ex.map((d) => d.salesOrderId).filter(Boolean) as Types.ObjectId[] } }, { projection: { orderNo: 1, title: 1 } }).toArray(),
    ]);
    const un = new Map(users.map((u) => [String(u._id), String(u.displayName || u.username || '')]));
    const so = new Map(sos.map((o) => [String(o._id), [o.orderNo, o.title].filter(Boolean).join(' · ')]));
    const groups = new Map<string, { key: string; name: string; batchId: string | null; createdAt?: Date; createdBy: string | null; salesOrder: string | null; lines: unknown[] }>();
    for (const d of docs) {
      const x = d as typeof d & Extra;
      const k = x.batchId ? String(x.batchId) : 'one:' + String(d._id);
      const g = groups.get(k) ?? { key: k, name: x.groupName || d.orderId || 'Бронь', batchId: x.batchId ? String(x.batchId) : null, createdAt: x.createdAt,
        createdBy: x.createdBy ? un.get(String(x.createdBy)) ?? null : null, salesOrder: x.salesOrderId ? so.get(String(x.salesOrderId)) ?? null : null, lines: [] };
      const m = nm.get(String(d.materialId));
      g.lines.push({ id: String(d._id), materialId: String(d.materialId), name: m?.name ?? '(позиция удалена)', unit: m?.unit ?? '', qty: d.qty, issued: (d as { issuedQty?: number }).issuedQty ?? 0 });
      groups.set(k, g);
    }
    const items = [...groups.values()];
    return { items, total: items.length, page: 1, limit: items.length };
  }

  private async reservationGroup(batchId: string) {
    const all = await this.listReservations();
    return all.items.find((g) => g.batchId === batchId) ?? { key: batchId, batchId, name: '', lines: [] };
  }

  /** Снять одну бронь (строку): «свободно» на складе снова увеличится. */
  async releaseReservation(id: string) {
    const r = await this.reservations.findOne({ _id: oid(id, 'брони'), status: 'active', deletedAt: null }).exec();
    if (!r) throw new NotFoundException('Бронь не найдена или уже снята');
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const item = await this.loadStorage(r.warehouseId as Types.ObjectId, r.materialId as Types.ObjectId, session);
        item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - r.qty);
        await item.save({ session });
        r.status = 'released'; r.isActive = false;
        await r.save({ session });
      });
    } finally { await session.endSession(); }
    return { id, released: true };
  }

  /** Снять всю бронь списка. */
  async releaseGroup(batchId: string) {
    const list = await this.reservations.find({ batchId: oid(batchId, 'брони'), status: 'active', deletedAt: null }, { _id: 1 }).lean().exec();
    if (!list.length) throw new NotFoundException('Бронь не найдена или уже снята');
    for (const r of list) await this.releaseReservation(String(r._id));
    return { batchId, released: list.length };
  }

  /**
   * Обрезок, который ещё пригодится (TASKS СМ.2): своя позиция «<позиция> — обрезок 1,2 м» (шт, `offcutOf`, размеры),
   * находится или создаётся; приход count шт. Труба (в метрах) — эти метры уходят из родителя (кусок отделили);
   * лист — родитель не меняется (лист уже списан целиком, обрезок — то, что осталось). Пакет — «Отменить» целиком.
   */
  async offcut(materialId: string, dto: { lengthMm: number; widthMm?: number; count?: number; note?: string }, userId?: string) {
    const parent = await this.getItem(materialId);
    if (parent.offcutOf) throw new BadRequestException('Это уже обрезок — отрежьте от основной позиции');
    if (!parent.metal) throw new BadRequestException('Обрезки — только у труб и листов (категория «…труба…» / «…лист…»)');
    const len = Math.round(Number(dto.lengthMm)), wid = dto.widthMm ? Math.round(Number(dto.widthMm)) : undefined, count = Math.max(1, Math.round(Number(dto.count ?? 1)));
    if (!(len > 0)) throw new BadRequestException('Укажите длину обрезка');
    if (parent.metal === 'sheet' && !(wid && wid > 0)) throw new BadRequestException('Укажите оба размера обрезка листа');
    const takeM = parent.metal === 'pipe' ? Math.round((len / 1000) * count * 1000) / 1000 : 0;
    if (takeM > parent.quantity) throw new BadRequestException(`На складе ${parent.quantity} м — обрезок ${takeM} м отделить нельзя`);
    const name = offcutName(parent.name, parent.metal, len, wid);
    let kid = await this.findMaterialByName(name);
    if (!kid) {
      const created = await this.createItem({ name, unit: 'шт', categoryId: parent.categoryId ?? undefined, assortment: parent.assortment, materialGrade: parent.materialGrade,
        dims: { ...parent.dims, length: len, ...(wid ? { width: wid } : {}) }, notes: `Обрезок позиции «${parent.name}»` });
      kid = await this.materials.findById(created.id).exec();
    }
    await this.connection.db!.collection('materials').updateOne({ _id: kid!._id }, { $set: { offcutOf: new Types.ObjectId(materialId) } });
    const wh = await this.defaultWarehouse();
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const batchId = new Types.ObjectId(); const now = new Date();
    const note = dto.note?.trim() || `обрезок ${name.split(' — обрезок ')[1]}`;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        if (takeM > 0) {
          const p = await this.loadStorage(wh._id as Types.ObjectId, new Types.ObjectId(materialId), session);
          p.quantity = Math.round(((p.quantity ?? 0) - takeM) * 1000) / 1000;
          await p.save({ session });
          await this.movements.create([{ type: 'out', date: now, materialId: new Types.ObjectId(materialId), warehouseId: wh._id, qty: takeM, delta: -takeM, notes: `В обрезки: ${note}`, createdBy, batchId }], { session });
        }
        const k = await this.loadStorage(wh._id as Types.ObjectId, kid!._id as Types.ObjectId, session);
        k.quantity = (k.quantity ?? 0) + count;
        await k.save({ session });
        await this.movements.create([{ type: 'in', date: now, materialId: kid!._id, warehouseId: wh._id, qty: count, delta: count, notes: note, createdBy, batchId }], { session });
      });
    } finally {
      await session.endSession();
    }
    return { batchId: String(batchId), parent: await this.getItem(materialId), offcut: await this.getItem(String(kid!._id)) };
  }

  /**
   * По весу (TASKS НО.3): штуки = общий вес ÷ вес 1 шт. (образец или из позиции), в примечание — расчёт;
   * вес 1 шт. сохраняется в позицию, если его не было, или если отличается > 10% и это подтверждено (saveUnitWeight).
   * Только для позиций в штуках, только приход и пересчёт.
   */
  private async applyWeight(materialId: string, dto: MoveInput): Promise<MoveInput> {
    if (!['in', 'count'].includes(dto.type)) throw new BadRequestException('По весу — только приход и пересчёт');
    const mat = await this.connection.db!.collection('materials').findOne({ _id: new Types.ObjectId(materialId), deletedAt: null }, { projection: { unit: 1, weightKg: 1, weightUnit: 1 } });
    if (!mat) throw new NotFoundException('Позиция не найдена');
    if (String(mat.unit || 'шт').toLowerCase() !== 'шт') throw new BadRequestException(`По весу считаются только штуки (у позиции «${mat.unit}»)`);
    const bw = dto.byWeight!;
    const known = weightGOf(mat as { weightKg?: unknown; weightUnit?: unknown }) ?? undefined;
    const w: ByWeight = { ...bw, unitWeightG: bw.sampleCount !== undefined ? undefined : bw.unitWeightG ?? known };
    const r = weightCount(w);
    if (!r.ok) throw new BadRequestException(r.errors.join('; ') || 'Не получилось посчитать штуки по весу');
    const differs = known ? Math.abs((r.unitWeightG ?? 0) - known) / known > 0.1 : true;
    if (!known || (differs && bw.saveUnitWeight)) await this.setWeightG(mat._id as Types.ObjectId, r.unitWeightG);
    const note = [dto.note?.trim(), weightNote(w, r)].filter(Boolean).join('; ');
    return { ...dto, qty: r.count!, note, byWeight: undefined };
  }

  /** Артикул уже у другой позиции — 409 с её названием (АР.3: артикул уникален в общей схеме). */
  private async assertArticleFree(article: string, self?: Types.ObjectId) {
    const twin = await this.materials.findOne({ article: new RegExp(`^\\s*${escapeRe(article)}\\s*$`, 'i'), deletedAt: null, ...(self ? { _id: { $ne: self } } : {}) }, { name: 1 }).lean().exec();
    if (twin) throw new ConflictException(`Артикул «${article}» уже у позиции «${twin.name}» — это одна и та же позиция? Тогда объедините их или поправьте артикул`);
  }

  /**
   * Артикул из заявки / листа в позицию (АР.2): только если у позиции пусто или автоартикул СКЛ-… (он остаётся
   * внутренним кодом); свой артикул позиции не перезаписывается (расхождение — в «Требуют заполнения», fill-audit).
   * source — откуда: «заявка №14», «Google-таблица, лист «Склад»».
   */
  async adoptArticle(materialId: Types.ObjectId | string, incoming: unknown, source: string): Promise<ArticleDecision> {
    if (!materialId || !Types.ObjectId.isValid(String(materialId))) return 'skip';
    const _id = new Types.ObjectId(String(materialId));
    const db = this.connection.db!;
    const mat = await db.collection('materials').findOne({ _id, deletedAt: null }, { projection: { article: 1 } });
    if (!mat) return 'skip';
    const inc = String(incoming ?? '').trim();
    const taken = inc && !isAutoArticle(inc) ? !!(await db.collection('materials').findOne({ _id: { $ne: _id }, deletedAt: null, article: new RegExp(`^\\s*${escapeRe(inc)}\\s*$`, 'i') }, { projection: { _id: 1 } })) : false;
    const d = decideArticle(mat.article, inc, taken);
    if (d !== 'set') return d;
    try {
      await db.collection('materials').updateOne({ _id }, { $set: { article: inc, articleSource: source, articleSetAt: new Date(), ...(mat.article ? { internalArticle: mat.article } : {}) } });
    } catch { return 'duplicate'; } // уникальный индекс (другое написание того же артикула)
    return 'set';
  }

  /** Вес 1 шт. в граммах → weightKg (кг) + пометка weightUnit 'kg' у позиции и её остатков (НО.0). */
  private async setWeightG(_id: Types.ObjectId, g: number | null | undefined) {
    const kg = g === null || g === undefined || !(Number(g) > 0) ? null : gramsToKg(Number(g));
    const set = kg === null ? { weightKg: null } : { weightKg: kg, weightUnit: 'kg' };
    await this.connection.db!.collection('materials').updateOne({ _id }, { $set: set });
    await this.connection.db!.collection('storageitems').updateMany({ materialId: _id }, { $set: set });
  }

  /** Кому выдано (TASKS Л.3): сотрудник из «Справочников» и/или текст («объект Парк», «бригада 2»). */
  private async issueTarget(personId?: string, issuedTo?: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (personId) {
      const p = await this.connection.db!.collection('persons').findOne({ _id: oid(personId, 'сотрудника'), deletedAt: null }, { projection: { _id: 1 } });
      if (!p) throw new BadRequestException('Сотрудник не найден — обновите страницу');
      out.issuedToPersonId = p._id;
    }
    const t = issuedTo?.trim();
    if (t) out.issuedTo = t.slice(0, 200);
    return out;
  }

  /**
   * «Выдать по брони» (TASKS Б.2): списание (out, `reservationId`) по броням одной операцией — всё или ничего.
   * Целиком — бронь «выдана» (fulfilled, qty = выдано); частично — бронь остаётся с остатком, `issuedQty` копит выданное.
   * Движения пакета с общим `batchId`: «Отменить» возвращает и остаток, и бронь (cancelBatch).
   */
  async issueReservations(dto: { lines: { reservationId: string; qty?: number }[]; personId?: string; issuedTo?: string; note?: string; clientUid?: string }, userId?: string) {
    if (dto.clientUid) {
      const prev = await this.movements.findOne({ clientUid: dto.clientUid, batchId: { $ne: null } }).lean().exec();
      if (prev) return { ...(await this.batchResult(String((prev as { batchId?: Types.ObjectId }).batchId), 'issue')), issued: 0 };
    }
    const want = new Map<string, number | undefined>();
    for (const l of dto.lines) {
      if (l.qty !== undefined && !(Number(l.qty) > 0)) throw new BadRequestException('Укажите, сколько выдать (больше нуля)');
      want.set(String(oid(l.reservationId, 'брони')), l.qty === undefined ? undefined : Number(l.qty));
    }
    const target = await this.issueTarget(dto.personId, dto.issuedTo);
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const batchId = new Types.ObjectId();
    const now = new Date();
    const matIds: Types.ObjectId[] = [];
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        matIds.length = 0;
        const list = await this.reservations.find({ _id: { $in: [...want.keys()].map((id) => new Types.ObjectId(id)) }, status: 'active', deletedAt: null }).session(session).exec();
        if (list.length !== want.size) throw new ConflictException('Часть броней уже выдана или снята — обновите страницу');
        const mats = await this.materials.find({ _id: { $in: list.map((r) => r.materialId) } }, { name: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
        const nameOf = new Map(mats.map((m) => [String(m._id), String(m.name)]));
        const plan: { r: ReservationDocument; n: number; item: StorageItemDocument }[] = [];
        const short: string[] = [];
        for (const r of list) {
          const n = want.get(String(r._id)) ?? r.qty;
          if (n > r.qty) throw new BadRequestException(`«${nameOf.get(String(r.materialId))}»: в брони ${r.qty}, выдать ${n} нельзя`);
          const item = await this.loadStorage(r.warehouseId, r.materialId as Types.ObjectId, session);
          if ((item.quantity ?? 0) < n) short.push(`«${nameOf.get(String(r.materialId))}»: есть ${item.quantity ?? 0}, нужно ${n}`);
          plan.push({ r, n, item });
        }
        if (short.length) throw new BadRequestException(`Недостаточно на складе — ${short.join('; ')}`);
        let first = true;
        for (const { r, n, item } of plan) {
          item.quantity = Math.round(((item.quantity ?? 0) - n) * 1000) / 1000;
          item.reservedQty = Math.max(0, Math.round(((item.reservedQty ?? 0) - n) * 1000) / 1000);
          await item.save({ session });
          const x = r as ReservationDocument & { groupName?: string; salesOrderId?: Types.ObjectId };
          await this.movements.create([{ type: 'out', date: now, materialId: r.materialId, warehouseId: r.warehouseId, qty: n, delta: -n,
            notes: dto.note?.trim() || `Выдано по брони «${x.groupName || r.orderId}»`, clientUid: first ? dto.clientUid : undefined, createdBy, batchId, reservationId: r._id,
            ...(x.salesOrderId ? { salesOrderId: x.salesOrderId, orderId: String(x.salesOrderId) } : {}), ...target }], { session });
          first = false;
          const left = Math.round((r.qty - n) * 1000) / 1000;
          r.issuedQty = Math.round(((r.issuedQty ?? 0) + n) * 1000) / 1000;
          if (left <= 0) { r.qty = r.issuedQty; r.status = 'fulfilled'; r.isActive = false; } else r.qty = left;
          await r.save({ session });
          matIds.push(r.materialId as Types.ObjectId);
        }
      });
    } finally {
      await session.endSession();
    }
    await this.connection.db!.collection('materials').updateMany({ _id: { $in: matIds } }, { $set: { editedInApp: true } });
    return { ...(await this.batchResult(String(batchId), 'issue', matIds)), issued: matIds.length };
  }

  /**
   * Карточка брони (TASKS Б.3): путь целиком — кто поставил, под какой заказ, что забронировано и сколько уже выдано,
   * кому выдавали, и заявки снабжения на то, чего не хватило («Заказать недостающее», clientUid `short-<batchId>-…`).
   * key — batchId списка или id одиночной брони.
   */
  async reservationDetail(key: string) {
    const id = oid(key, 'брони');
    let docs = await this.reservations.find({ batchId: id, deletedAt: null }).sort({ createdAt: 1 }).lean().exec();
    if (!docs.length) docs = await this.reservations.find({ _id: id, deletedAt: null }).lean().exec();
    if (!docs.length) throw new NotFoundException('Бронь не найдена');
    type Extra = { batchId?: Types.ObjectId; groupName?: string; createdAt?: Date; createdBy?: Types.ObjectId; salesOrderId?: Types.ObjectId; issuedQty?: number };
    const head = docs[0] as typeof docs[number] & Extra;
    const db = this.connection.db!;
    const [mats, issues, so, author, requests] = await Promise.all([
      this.materials.find({ _id: { $in: docs.map((d) => d.materialId) } }, { name: 1, unit: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec(),
      this.movements.find({ reservationId: { $in: docs.map((d) => d._id) }, deletedAt: null, cancelledAt: null }).sort({ date: -1 }).lean().exec(),
      head.salesOrderId ? db.collection('salesorders').findOne({ _id: head.salesOrderId }, { projection: { orderNo: 1, title: 1, customer: 1 } }) : null,
      head.createdBy ? db.collection('users').findOne({ _id: head.createdBy }, { projection: { displayName: 1, username: 1 } }) : null,
      head.batchId ? db.collection('supplyrequests').find({ clientUid: { $regex: '^short-' + String(head.batchId) + '-' }, deletedAt: null }, { projection: { num: 1, title: 1, status: 1, qty: 1, unit: 1 } }).toArray() : [],
    ]);
    const nm = new Map(mats.map((m) => [String(m._id), m]));
    const who = await this.issuedNames(issues);
    const lines = docs.map((d) => {
      const x = d as typeof d & Extra; const m = nm.get(String(d.materialId));
      const active = d.status === 'active';
      return { id: String(d._id), materialId: String(d.materialId), name: m?.name ?? '(позиция удалена)', unit: m?.unit ?? '', status: d.status,
        left: active ? d.qty : 0, issued: x.issuedQty ?? (d.status === 'fulfilled' ? d.qty : 0), canIssue: active && d.qty > 0 };
    });
    return {
      key, batchId: head.batchId ? String(head.batchId) : null, name: head.groupName || head.orderId || 'Бронь', createdAt: head.createdAt ?? null,
      createdBy: author ? String(author.displayName || author.username || '') : null,
      salesOrder: so ? { id: String(so._id), label: [so.orderNo, so.title].filter(Boolean).join(' · '), customer: so.customer ?? null } : null,
      lines,
      issues: issues.map((mv) => ({ id: String(mv._id), date: mv.date, qty: mv.qty, name: nm.get(String(mv.materialId))?.name ?? '', unit: nm.get(String(mv.materialId))?.unit ?? '',
        to: who.get(String(mv._id)) ?? null, batchId: (mv as { batchId?: Types.ObjectId }).batchId ? String((mv as { batchId?: Types.ObjectId }).batchId) : null })),
      requests: (requests as { _id: Types.ObjectId; num?: number; title?: string; status?: string; qty?: number; unit?: string }[])
        .map((r) => ({ id: String(r._id), num: r.num ?? null, title: r.title ?? '', status: r.status ?? '', qty: r.qty ?? null, unit: r.unit ?? '' })),
    };
  }

  /** «Кому выдано» для списка движений: ФИО сотрудника и/или текст. id движения → подпись. */
  async issuedNames(docs: { _id: unknown; issuedToPersonId?: Types.ObjectId; issuedTo?: string }[]) {
    const ids = docs.map((d) => d.issuedToPersonId).filter(Boolean) as Types.ObjectId[];
    const persons = ids.length ? await this.connection.db!.collection('persons').find({ _id: { $in: ids } }, { projection: { lastName: 1, firstName: 1, patronymic: 1 } }).toArray() : [];
    const pn = new Map(persons.map((p) => [String(p._id), personName(p as { lastName?: unknown })]));
    return new Map(docs.map((d) => [String(d._id), [d.issuedToPersonId ? pn.get(String(d.issuedToPersonId)) : null, d.issuedTo].filter(Boolean).join(' · ') || null]));
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
    // кому выдано / под какой заказ (карточка сотрудника, карточка заказчика)
    if (q.personId) filter.issuedToPersonId = oid(q.personId, 'сотрудника');
    if (q.salesOrderId) filter.salesOrderId = { $in: oids(q.salesOrderId) };
    if (q.id) filter._id = oid(q.id, 'движения');
    if (p.search) {
      const mats = await this.materials.find({ $or: [{ name: p.search }, { article: p.search }] }, { _id: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
      filter.$or = [{ materialId: { $in: mats.map((m) => m._id) } }, { notes: p.search }, { issuedTo: p.search }];
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
    const issued = await this.issuedNames(docs as never);
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
        // для карточки движения: операция пакетом, под какой заказ (кликабельно в приложении)
        batchId: (m as { batchId?: Types.ObjectId }).batchId ? String((m as { batchId?: Types.ObjectId }).batchId) : null,
        salesOrderId: (m as { salesOrderId?: Types.ObjectId }).salesOrderId ? String((m as { salesOrderId?: Types.ObjectId }).salesOrderId) : null,
        issuedTo: issued.get(String(m._id)) ?? null,
        reservationId: (m as { reservationId?: Types.ObjectId }).reservationId ? String((m as { reservationId?: Types.ObjectId }).reservationId) : null,
        canCancel: d.source !== 'google-sheets' && !d.cancelledAt && !d.cancelOf && m.type !== 'transfer' && d.delta !== undefined,
        qtyBefore: (m as { qtyBefore?: number }).qtyBefore ?? null, qtyAfter: (m as { qtyAfter?: number }).qtyAfter ?? null,
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
