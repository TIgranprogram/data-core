import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { oid, oids, parseList } from '../../common/list-query';
import { inScope, type StockScope } from '../../common/stock-scope';
import { sameRe } from '../../common/text/same-text';
import { STOCK_VISIBLE } from '../../common/catalog/stock-visible';
import { Material, MaterialDocument } from '../material/material.schema';
import { articleView } from './article';
import { dimsOf, metalKind } from './metal';
import { sectionProfile, compareDimensions, isDimensionSort, compactStockDimensions } from './stock-dimensions';
import { StockCoreService } from './stock-core.service';
import { StorageItem, StorageItemDocument } from './schemas/storage-item.schema';
import { ITEM_SORT } from './stock.types';
import { matchesAll, searchTokens } from '../../common/text/search-norm';
import { weightGOf } from './weight';
import { attentionRank, freeQty } from './stock-rank';
import { hangingQtyByMaterial } from './stock-hanging';
import { catalogPurchases } from './catalog-purchases';
import { foldPurchases, type PurchaseSupplier, type ReceivedRow } from './purchase-history';

/** Коллекции, от которых зависят строки «Остатков» (кэш С9): изменилась любая — расчёт заново. */
const STOCK_COLLS = ['materials', 'storageitems', 'supplyrequests', 'categories', 'warehouses'] as const;
const EMPTY_LIST_KEY = [false, null, [], null, null, null, []] as const;

/** Чтение позиций склада: список «Остатков» (с кэшем), карточка, «заказано», сводка по категориям. */
@Injectable()
export class StockSearchService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StorageItem.name) private readonly storage: Model<StorageItemDocument>,
    @InjectModel(Material.name) private readonly materials: Model<MaterialDocument>,
    private readonly core: StockCoreService,
    @Optional() private readonly versions?: DataVersionService,
  ) {}

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
   * (сотни–тысячи позиций — это быстро). status: ok | low | none | reserved | ordered (через запятую; ordered — есть открытые заявки, ждут поставку). deleted=1 — корзина.
   */
  async listItems(q: Record<string, unknown> & { materialIds?: Types.ObjectId[] } = {}, scope?: StockScope | null) {
    if (q.availability !== undefined && q.availability !== 'none' && q.availability !== 'in') {
      throw new BadRequestException('Наличие: выберите «Нет в наличии» или «В наличии»');
    }
    const p = parseList(q, { sortable: ITEM_SORT, defaultSort: 'name', defaultLimit: 1000, maxLimit: 10000 });
    // Поиск — в памяти (search-norm): «м10 гайка» = «Гайка …, M10 …», слова в любом порядке
    const tokens = q.search ? searchTokens(compactStockDimensions(q.search)) : [];
    // скорость С9: строки склада считаются один раз, пока не менялись данные (кэш по версиям коллекций); строки общие — не менять
    const held = q.held === '1' && !p.deleted;
    const hideParts = !held && q.withParts === '0';
    const make = () => this.itemRows(q, p.deleted, tokens, held, hideParts);
    const key = JSON.stringify([p.deleted, q.categoryId ?? null, (q.materialIds ?? []).map(String), q.grade ?? null, q.section ?? null, q.thickness ?? null, tokens, ...(q.wash || q.pipeLength || q.noGrade ? [q.wash, q.pipeLength, q.noGrade] : []), ...(held ? ['held'] : []), ...(hideParts ? ['withoutParts'] : [])]);
    // Выборка по id (карточка позиции, ответ после записи, ids признаков — в т. ч. пустой список → 0 строк) — без кэша: версия коллекции растёт по потоку изменений
    // с задержкой, и сразу после правки/прихода кэш отдал бы старые цифры (находка qa 2026-10-24). Она и так быстрая.
    const { wh, rows: found } = this.versions && !q.materialIds ? await this.versions.cached('stock.items', STOCK_COLLS, key, make) : await make();
    // склады (WZ): чужие позиции отсекаются здесь, после общего кэша строк; нулевой металл роль со складом видит (своя работа)
    const seen = scope ? found.filter((r) => inScope(scope, r)) : found;
    // C242: нулевая номенклатура остаётся видимой; held=1 — отдельный явный отбор наличия.
    const all = seen;
    // Счётчики по состоянию — для чипов фильтра (до фильтра по состоянию)
    const counts = { all: all.length, ok: 0, low: 0, none: 0, reserved: 0, ordered: 0 };
    for (const r of all) { counts[r.status as 'ok' | 'low' | 'none']++; if (r.reservedQty > 0) counts.reserved++; if (r.ordered > 0) counts.ordered++; }
    let rows = [...all];
    if (q.status) {
      const want = new Set(String(q.status).split(','));
      rows = rows.filter((r) => want.has(r.status) || (want.has('reserved') && r.reservedQty > 0) || (want.has('ordered') && r.ordered > 0));
    }
    // Наличие — физический остаток, не свободное количество. Счётчики выше сохраняют прежнюю семантику.
    if (q.availability === 'none') rows = rows.filter((r) => r.quantity === 0);
    else if (q.availability === 'in') rows = rows.filter((r) => r.quantity > 0);
    const [[field, dir]] = Object.entries(p.sort);
    const key2 = field as keyof (typeof rows)[number];
    rows.sort((a, b) => {
      if (isDimensionSort(field)) return compareDimensions(a, b, field, dir);
      const x = a[key2], y = b[key2];
      const c = typeof x === 'number' || typeof y === 'number' ? Number(x ?? 0) - Number(y ?? 0)
        : x instanceof Date || y instanceof Date ? new Date((x as Date) ?? 0).getTime() - new Date((y as Date) ?? 0).getTime()
          : String(x ?? '').localeCompare(String(y ?? ''), 'ru');
      return c * dir || String(a.name).localeCompare(String(b.name), 'ru') || a.materialId.localeCompare(b.materialId);
    });
    // priority=1 (SK-4a): «заканчивается» и «в брони» — сверху; внутри групп порядок выбранной сортировки (sort стабилен)
    if (String(q.priority) === '1' && !isDimensionSort(field)) rows.sort((a, b) => attentionRank(a) - attentionRank(b));
    const page = rows.slice(p.skip, p.skip + p.limit);
    // «висящая» бронь (СК-6): сколько в брони под отгруженный / аннулированный заказ — считаем только для строк страницы с бронью
    // фото и «висящая» бронь независимы — читаем разом
    const [photos, hang] = await Promise.all([
      this.photoMap(page.flatMap((r) => r.photoIds)),
      hangingQtyByMaterial(this.connection.db!, page.filter((r) => r.reservedQty > 0).map((r) => new Types.ObjectId(r.materialId))),
    ]);
    // isProfile нужен только для отсева технических сортаментов в lookup и в ответ списка не попадает.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const items = page.map(({ photoIds, offcuts, isProfile: _isProfile, ...r }) => ({
      ...r,
      offcuts: offcuts.filter((o) => !(held || hideParts) || inScope(scope, o)).map(({ id, name, qty, length }) => ({ id, name, qty, length })),
      hangingQty: hang.get(r.materialId) ?? 0,
      photos: photoIds.map((id) => photos.get(String(id))).filter(Boolean),
    }));
    return { items, total: rows.length, page: p.page, limit: p.limit, counts, warehouseId: String(wh._id), warehouseName: wh.name };
  }

  /**
   * SK-8d: короткий список позиций для поиска из соседних разделов (заявка, состав изделия) — GET /stock/lookup.
   * Только поля для выбора, без фото, бронирований, заявок; строки — тот же кэш, что у полного списка без фильтров.
   */
  async lookup(scope?: StockScope | null, catalog = false) {
    const key = JSON.stringify(EMPTY_LIST_KEY); // = ключ listItems({}) — общий кэш
    const make = () => this.itemRows({}, false, []);
    const { rows } = this.versions ? await this.versions.cached('stock.items', STOCK_COLLS, key, make) : await make();
    const visible = rows
      .filter((r) => !scope || inScope(scope, r))
      .filter((r) => !catalog || r.metal !== 'pipe' || (!r.isProfile && !r.offcutOf));
    const purchases = catalog ? await catalogPurchases(this.connection.db!, visible) : null;
    const items = visible.map((r) => ({ id: r.id, materialId: r.materialId, name: r.name, article: r.article ?? null, unit: r.unit ?? null, categoryName: r.categoryName, quantity: r.quantity, free: r.free,
        ...(catalog ? { reservedQty: r.reservedQty, ...(purchases?.get(r.materialId) ?? { openPurchases: [], lastPurchase: null }), typeName: r.typeName, assortment: r.assortment, materialGrade: r.materialGrade, dims: r.dims, metal: r.metal,
          ...(r.metal === 'pipe' ? { washed: r.washed, standardRef: r.standardRef } : {}) } : {}) }))
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ru'));
    return { items };
  }

  /** Строки «Остатков» до фильтра по состоянию, сортировки и страниц: позиции, остатки, «уже заказано», обрезки. */
  private async itemRows(q: Record<string, unknown> & { materialIds?: Types.ObjectId[] }, deleted: boolean, tokens: string[], held = false, hideParts = false) {
    const wh = await this.core.defaultWarehouse();
    const filter: Record<string, unknown> = { deletedAt: deleted ? { $ne: null } : null, ...(held || hideParts ? STOCK_VISIBLE : {}) };
    if (q.categoryId) { const ids = oids(q.categoryId); filter.categoryId = { $in: [...ids, ...ids.map(String)] }; }
    if (q.materialIds) filter._id = { $in: q.materialIds };

    // металл (СМ.1): марка, сечение, толщина — фильтры «Остатков»
    // без учёта регистра и лишних пробелов: в фильтре одно написание, в позициях бывают разные (SPR-1)
    if (q.grade) filter.materialGrade = sameRe(q.grade);
    else if (q.noGrade) filter.materialGrade = null; // чёрная труба: у нержавеющей те же сечения
    if (q.section) filter.assortment = sameRe(q.section);
    const sizes = [['thickness', q.thickness], ['length', q.pipeLength]].filter(([, v]) => Number(v) > 0);
    if (sizes.length) filter.dimensions = { $all: sizes.map(([type, value]) => ({ $elemMatch: { type, value: Number(value) } })) };
    if (q.wash === '1' || q.wash === '0') filter.washed = q.wash === '1';
    // категория хранится и ObjectId, и строкой (пишет kppdf мимо схемы) — читаем сырой коллекцией,
    // чтобы `$in:[ObjectId, hex]` нашёл оба вида: Mongoose приводит строку к ObjectId, и строковая категория не находилась (T8).
    const mats = (await this.connection.db!.collection('materials').find(filter).toArray() as unknown as MaterialDocument[])
      .filter((m) => matchesAll(tokens, ...[m.name, m.fullName, m.invoiceName, m.article, m.sku, m.notes, m.assortment, m.materialGrade,
        (m as { internalArticle?: string }).internalArticle, ...(held ? [m.pdmCode, ...(m.pdmAliases ?? [])] : [])].map(compactStockDimensions)));
    const ids = mats.map((m) => m._id as Types.ObjectId);
    // скорость С7: независимые чтения — разом, категории — только нужные (не все категории CRM)
    const catIds = [...new Set(mats.map((m) => m.categoryId).filter(Boolean).map(String))].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const [stocks, cats, openReq, kids] = await Promise.all([
      this.storage.find({ warehouseId: wh._id, materialId: { $in: ids }, deletedAt: deleted ? undefined : null }).setOptions({ includeSoftDeleted: true }).lean().exec(),
      catIds.length ? this.connection.db!.collection('categories').find({ _id: { $in: catIds } }, { projection: { name: 1 } }).toArray() : Promise.resolve([]),
      // «уже заказано» (ЗП.2): открытые заявки на позицию — по materialId или по тому же наименованию
      this.openRequests(mats as { _id: Types.ObjectId; name?: string }[]),
      // обрезки этих позиций (СМ.2): родитель → [{ id, name, qty }] с остатком > 0 — «сначала брать обрезки»
      this.connection.db!.collection('materials').find({ offcutOf: { $in: ids }, deletedAt: null, ...(held || hideParts ? STOCK_VISIBLE : {}) },
        { projection: { name: 1, offcutOf: 1, dimensions: 1, categoryId: 1 } }).toArray(),
    ]);
    const catName = new Map(cats.map((c) => [String(c._id), String(c.name)]));
    const kidStock = kids.length ? await this.storage.find({ warehouseId: wh._id, materialId: { $in: kids.map((k) => k._id) }, deletedAt: null }).lean().exec() : [];
    const kidQty = new Map<string, number>();
    for (const s of kidStock) kidQty.set(String(s.materialId), (kidQty.get(String(s.materialId)) ?? 0) + (s.quantity ?? 0));
    const offcutsOf = new Map<string, { id: string; name: string; qty: number; length: number | null; categoryId: unknown }[]>();
    for (const k of kids) {
      const n = kidQty.get(String(k._id)) ?? 0;
      if (n <= 0) continue;
      const list = offcutsOf.get(String(k.offcutOf)) ?? [];
      list.push({ id: String(k._id), name: String(k.name), qty: n, length: dimsOf(k.dimensions).length ?? null, categoryId: k.categoryId });
      offcutsOf.set(String(k.offcutOf), list);
    }
    const byMat = new Map<string, { quantity: number; reservedQty: number; minQuantity: number; weightKg?: number; zoneName?: string; id: string; lastCountedAt?: Date; countMode: 'single' | 'multiple' }>();
    for (const s of stocks) {
      const k = String(s.materialId);
      const cur = byMat.get(k);
      if (cur) { cur.quantity += s.quantity ?? 0; cur.reservedQty += s.reservedQty ?? 0; cur.countMode = 'multiple'; continue; }
      byMat.set(k, { id: String(s._id), quantity: s.quantity ?? 0, reservedQty: s.reservedQty ?? 0, minQuantity: s.minQuantity ?? 0, weightKg: s.weightKg, zoneName: s.zoneName, lastCountedAt: (s as { lastCountedAt?: Date }).lastCountedAt, countMode: 'single' });
    }
    // В «Остатках» смотрим на физическое количество; бронь и свободное не меняют видимость строки.
    const shown = held ? mats.filter((m) => (byMat.get(String(m._id))?.quantity ?? 0) > 0) : mats;
    const rows = shown.map((m) => {
      const st = byMat.get(String(m._id));
      const quantity = st?.quantity ?? 0, reservedQty = st?.reservedQty ?? 0, minQuantity = st?.minQuantity ?? 0;
      return {
        id: String(m._id), materialId: String(m._id), name: m.name, article: m.article, sku: m.sku, unit: m.unit,
        materialKind: m.materialKind ?? null, pdmCode: m.pdmCode ?? null, pdmAliases: m.pdmAliases ?? [], standardRef: m.standardRef ?? null,
        isProfile: m.isProfile === true,
        // АР.1: артикул поставщика и внутренний код (СКЛ-… / sku) — раздельно; откуда взят артикул
        ...articleView(m as { article?: unknown; sku?: unknown; internalArticle?: unknown }), articleSource: (m as { articleSource?: string }).articleSource ?? null,
        categoryId: m.categoryId ? String(m.categoryId) : null, categoryName: m.categoryId ? catName.get(String(m.categoryId)) ?? null : null,
        notes: m.notes, fullName: (m as { fullName?: string }).fullName ?? null, invoiceName: (m as { invoiceName?: string }).invoiceName ?? null, quantity, reservedQty, free: freeQty(quantity, reservedQty), minQuantity,
        ordered: Math.round((openReq.get(String(m._id)) ?? []).reduce((s, r) => s + (r.qty || 0), 0) * 1000) / 1000,
        assortment: m.assortment ?? null, materialGrade: m.materialGrade ?? null, typeName: m.typeName ?? null, washed: (m as { washed?: boolean }).washed ?? null, dims: dimsOf(m.dimensions),
        metal: metalKind(m.categoryId ? catName.get(String(m.categoryId)) : null, m.unit),
        sectionProfile: sectionProfile({ metal: metalKind(m.categoryId ? catName.get(String(m.categoryId)) : null, m.unit), assortment: m.assortment, dims: dimsOf(m.dimensions) }),
        offcutOf: (m as { offcutOf?: Types.ObjectId }).offcutOf ? String((m as { offcutOf?: Types.ObjectId }).offcutOf) : null,
        offcuts: offcutsOf.get(String(m._id)) ?? [],
        weightKg: st?.weightKg ?? m.weightKg, weightG: weightGOf(m as { weightKg?: unknown; weightUnit?: unknown }), zoneName: st?.zoneName ?? null, storageItemId: st?.id ?? null,
        countMode: st?.countMode ?? 'single',
        lastCountedAt: st?.lastCountedAt ?? null,
        photoIds: (m.photoIds ?? []) as Types.ObjectId[],
        status: quantity <= 0 ? 'none' : minQuantity > 0 && quantity - reservedQty < minQuantity ? 'low' : 'ok',
        updatedAt: (m as { updatedAt?: Date }).updatedAt,
        deletedAt: (m as { deletedAt?: Date | null }).deletedAt ?? null,
      };
    });
    return { wh, rows };
  }

  /**
   * Открытые заявки снабжения (ожидает / заказать / в работе) по позициям (ЗП.1–ЗП.3): заявка привязана `materialId`
   * или (заявки из Google-таблицы) совпадает наименованием. materialId → заявки.
   */
  async openRequests(mats: { _id: Types.ObjectId; name?: string }[]) {
    const out = new Map<string, { id: string; num: number | null; title: string; qty: number; unit: string; status: string; paid: boolean; invoiceDate: Date | null; requestDate: Date | null; requestedBy: string | null; supplierId: Types.ObjectId | null }[]>();
    if (!mats.length) return out;
    const ids = mats.map((m) => m._id);
    const docs = await this.connection.db!.collection('supplyrequests').find({ deletedAt: null, status: { $in: ['in_progress', 'requested', 'ordered'] },
      materialId: { $in: ids } },
    { projection: { num: 1, title: 1, qty: 1, unit: 1, status: 1, paid: 1, invoiceDate: 1, requestDate: 1, requestedBy: 1, supplierId: 1, materialId: 1 } }).toArray();
    for (const d of docs) {
      const key = String(d.materialId);
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
  async itemOrdered(materialId: string, canMoney: boolean, scope?: StockScope | null) {
    await this.core.assertMaterials([materialId], scope);
    const mat = await this.materials.findOne({ _id: oid(materialId, 'позиции'), deletedAt: null }, { name: 1 }).lean().exec();
    if (!mat) throw new NotFoundException('Позиция не найдена');
    const open = (await this.openRequests([mat as { _id: Types.ObjectId; name?: string }])).get(String(mat._id)) ?? [];
    const db = this.connection.db!;
    const got = await db.collection('supplyrequests').find({ deletedAt: null, status: 'received', materialId: mat._id },
      { projection: { qty: 1, priceHint: 1, supplierId: 1, receivedAt: 1, invoiceDate: 1, requestDate: 1 } }).sort({ receivedAt: -1, invoiceDate: -1 }).limit(200).toArray();
    const orgIds = [...open.map((r) => r.supplierId), ...got.map((g) => g.supplierId)].filter(Boolean) as Types.ObjectId[];
    const orgs = orgIds.length ? await db.collection('organizations').find({ _id: { $in: orgIds } }, { projection: { name: 1, shortName: 1 } }).toArray() : [];
    const on = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const LBL: Record<string, string> = { in_progress: 'Ожидает', requested: 'Заказать', ordered: 'В работе' };
    // lastQty — сколько брали в прошлый раз: количество по умолчанию в быстром «Заказать» со склада (2026-11-06)
    const suppliers = foldPurchases(got as ReceivedRow[], (id) => on.get(String(id)), canMoney).map(({ supplierId: _s, ...x }) => x); // eslint-disable-line @typescript-eslint/no-unused-vars
    return {
      open: open.map(({ supplierId, ...r }) => ({ ...r, statusLabel: r.status === 'ordered' && r.paid ? 'Оплачено' : LBL[r.status] ?? r.status, supplier: supplierId ? on.get(String(supplierId)) ?? null : null })),
      inTransit: Math.round(open.reduce((s, r) => s + r.qty, 0) * 1000) / 1000,
      suppliers,
    };
  }

  /**
   * Поставщики по прошлым закупкам сразу для нескольких позиций (заявки пачкой): тот же расчёт, что в `itemOrdered`,
   * но с id поставщика. Ключ — id позиции; нет закупок — пустой список.
   */
  async purchaseSuppliers(materialIds: Types.ObjectId[]): Promise<Map<string, PurchaseSupplier[]>> {
    const out = new Map<string, PurchaseSupplier[]>(materialIds.map((id) => [String(id), []]));
    if (!materialIds.length) return out;
    const db = this.connection.db!;
    const got = await db.collection('supplyrequests').find({ deletedAt: null, status: 'received', materialId: { $in: materialIds } },
      { projection: { materialId: 1, qty: 1, priceHint: 1, supplierId: 1, receivedAt: 1, invoiceDate: 1, requestDate: 1 } })
      .sort({ receivedAt: -1, invoiceDate: -1 }).limit(materialIds.length * 200).toArray() as ReceivedRow[];
    const orgIds = [...new Set(got.map((g) => String(g.supplierId ?? '')).filter(Boolean))].map((i) => new Types.ObjectId(i));
    const orgs = orgIds.length ? await db.collection('organizations').find({ _id: { $in: orgIds } }, { projection: { name: 1, shortName: 1 } }).toArray() : [];
    const on = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const by = new Map<string, ReceivedRow[]>();
    for (const g of got) { const k = String(g.materialId); (by.get(k) ?? by.set(k, []).get(k)!).push(g); }
    for (const [k, rows] of by) out.set(k, foldPurchases(rows.slice(0, 200), (id) => on.get(String(id))));
    return out;
  }

  /** Сводка по категориям (плитки «Склада»): сколько позиций, сколько к закупке и сколько нет на складе. */
  async categorySummary(scope?: StockScope | null, held = false) {
    // строки — из общего кэша (тот же ключ, что у listItems({}) и lookup): без сортировки, фото и «висящей» брони
    const key = JSON.stringify(held ? [...EMPTY_LIST_KEY, 'held'] : EMPTY_LIST_KEY);
    const make = () => this.itemRows({}, false, [], held);
    const { rows } = this.versions ? await this.versions.cached('stock.items', STOCK_COLLS, key, make) : await make();
    const by = new Map<string, { id: string; name: string; total: number; low: number; none: number; ordered: number }>();
    const mine = rows.filter((r) => !scope || inScope(scope, r));
    for (const i of mine) {
      const id = i.categoryId ?? 'none';
      const c = by.get(id) ?? { id, name: i.categoryName ?? 'Без категории', total: 0, low: 0, none: 0, ordered: 0 };
      c.total++;
      if (i.ordered > 0) c.ordered++;
      if (i.status === 'low') c.low++;
      if (i.status === 'none') c.none++;
      by.set(id, c);
    }
    const items = [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ru'));
    return { items, total: mine.length };
  }

  async getItem(materialId: string, scope?: StockScope | null) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    const r = await this.listItems({ materialIds: [new Types.ObjectId(materialId)] }, scope);
    if (!r.items[0]) throw new NotFoundException('Позиция не найдена');
    return r.items[0];
  }
  /** Для сверки/тестов: суммарно по складу. */
  async totals() {
    const wh = await this.core.defaultWarehouse();
    const [items, materials] = await Promise.all([
      this.storage.countDocuments({ warehouseId: wh._id, materialId: { $ne: null }, deletedAt: null }).exec(),
      this.materials.countDocuments({ deletedAt: null }).exec(),
    ]);
    return { warehouse: wh.name, storageItems: items, materials };
  }

}
