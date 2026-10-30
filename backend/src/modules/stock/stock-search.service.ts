import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { escapeRe, oid, oids, parseList } from '../../common/list-query';
import { sameRe } from '../../common/text/same-text';
import { Material, MaterialDocument } from '../material/material.schema';
import { normText } from '../../common/text/norm-text';
import { articleView } from './article';
import { dimsOf, metalKind, isEmptyMetal } from './metal';
import { StockCoreService } from './stock-core.service';
import { StorageItem, StorageItemDocument } from './schemas/storage-item.schema';
import { ITEM_SORT } from './stock.types';
import { matchesAll, searchTokens } from '../../common/text/search-norm';
import { weightGOf } from './weight';
import { attentionRank, freeQty } from './stock-rank';
import { hangingQtyByMaterial } from './stock-hanging';

/** Коллекции, от которых зависят строки «Остатков» (кэш С9): изменилась любая — расчёт заново. */
const STOCK_COLLS = ['materials', 'storageitems', 'supplyrequests', 'categories', 'warehouses'] as const;

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
  async listItems(q: Record<string, unknown> & { materialIds?: Types.ObjectId[] } = {}) {
    const p = parseList(q, { sortable: ITEM_SORT, defaultSort: 'name', defaultLimit: 1000, maxLimit: 10000 });
    // Поиск — в памяти (search-norm): «м10 гайка» = «Гайка …, M10 …», слова в любом порядке
    const tokens = q.search ? searchTokens(q.search) : [];
    // скорость С9: строки склада считаются один раз, пока не менялись данные (кэш по версиям коллекций); строки общие — не менять
    const make = () => this.itemRows(q, p.deleted, tokens);
    const key = JSON.stringify([p.deleted, q.categoryId ?? null, (q.materialIds ?? []).map(String), q.grade ?? null, q.section ?? null, q.thickness ?? null, tokens, ...(q.wash || q.pipeLength || q.noGrade ? [q.wash, q.pipeLength, q.noGrade] : [])]);
    // Выборка по id (карточка позиции, ответ после записи) — без кэша: версия коллекции растёт по потоку изменений
    // с задержкой, и сразу после правки/прихода кэш отдал бы старые цифры (находка qa 2026-10-24). Она и так быстрая.
    const { wh, rows: found } = this.versions && !q.materialIds?.length ? await this.versions.cached('stock.items', STOCK_COLLS, key, make) : await make();
    const all = q.hideEmptyMetal ? found.filter((r) => !isEmptyMetal(r)) : found;
    // Счётчики по состоянию — для чипов фильтра (до фильтра по состоянию)
    const counts = { all: all.length, ok: 0, low: 0, none: 0, reserved: 0, ordered: 0 };
    for (const r of all) { counts[r.status as 'ok' | 'low' | 'none']++; if (r.reservedQty > 0) counts.reserved++; if (r.ordered > 0) counts.ordered++; }
    let rows = [...all];
    if (q.status) {
      const want = new Set(String(q.status).split(','));
      rows = rows.filter((r) => want.has(r.status) || (want.has('reserved') && r.reservedQty > 0) || (want.has('ordered') && r.ordered > 0));
    }
    const [[field, dir]] = Object.entries(p.sort);
    const key2 = field as keyof (typeof rows)[number];
    rows.sort((a, b) => {
      const x = a[key2], y = b[key2];
      const c = typeof x === 'number' || typeof y === 'number' ? Number(x ?? 0) - Number(y ?? 0)
        : x instanceof Date || y instanceof Date ? new Date((x as Date) ?? 0).getTime() - new Date((y as Date) ?? 0).getTime()
          : String(x ?? '').localeCompare(String(y ?? ''), 'ru');
      return c * dir || String(a.name).localeCompare(String(b.name), 'ru');
    });
    // priority=1 (SK-4a): «заканчивается» и «в брони» — сверху; внутри групп порядок выбранной сортировки (sort стабилен)
    if (String(q.priority) === '1') rows.sort((a, b) => attentionRank(a) - attentionRank(b));
    const page = rows.slice(p.skip, p.skip + p.limit);
    const photos = await this.photoMap(page.flatMap((r) => r.photoIds));
    // «висящая» бронь (СК-6): сколько в брони под отгруженный / аннулированный заказ — считаем только для строк страницы с бронью
    const hang = await hangingQtyByMaterial(this.connection.db!, page.filter((r) => r.reservedQty > 0).map((r) => new Types.ObjectId(r.materialId)));
    const items = page.map(({ photoIds, ...r }) => ({ ...r, hangingQty: hang.get(r.materialId) ?? 0, photos: photoIds.map((id) => photos.get(String(id))).filter(Boolean) }));
    return { items, total: rows.length, page: p.page, limit: p.limit, counts, warehouseId: String(wh._id), warehouseName: wh.name };
  }

  /**
   * SK-8d: короткий список позиций для поиска из соседних разделов (заявка, состав изделия) — GET /stock/lookup.
   * Только поля для выбора, без фото, бронирований, заявок; строки — тот же кэш, что у полного списка без фильтров.
   */
  async lookup(scope?: string[] | null) {
    const key = JSON.stringify([false, null, [], null, null, null, []]); // = ключ listItems({}) — общий кэш
    const make = () => this.itemRows({}, false, []);
    const { rows } = this.versions ? await this.versions.cached('stock.items', STOCK_COLLS, key, make) : await make();
    const items = rows
      .filter((r) => (scope ? scope.includes(String(r.categoryId)) : !isEmptyMetal(r)))
      .map((r) => ({ id: r.id, materialId: r.materialId, name: r.name, article: r.article ?? null, unit: r.unit ?? null, categoryName: r.categoryName, quantity: r.quantity, free: r.free }))
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ru'));
    return { items };
  }

  /** Строки «Остатков» до фильтра по состоянию, сортировки и страниц: позиции, остатки, «уже заказано», обрезки. */
  private async itemRows(q: Record<string, unknown> & { materialIds?: Types.ObjectId[] }, deleted: boolean, tokens: string[]) {
    const wh = await this.core.defaultWarehouse();
    const filter: Record<string, unknown> = { deletedAt: deleted ? { $ne: null } : null };
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
    const mats = (await this.materials.find(filter).setOptions({ includeSoftDeleted: true }).lean().exec())
      .filter((m) => matchesAll(tokens, m.name, (m as { fullName?: string }).fullName, (m as { invoiceName?: string }).invoiceName, m.article, m.sku, m.notes, m.assortment, m.materialGrade, (m as { internalArticle?: string }).internalArticle));
    const ids = mats.map((m) => m._id as Types.ObjectId);
    // скорость С7: независимые чтения — разом, категории — только нужные (не все категории CRM)
    const catIds = [...new Set(mats.map((m) => m.categoryId).filter(Boolean).map(String))].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const [stocks, cats, openReq, kids] = await Promise.all([
      this.storage.find({ warehouseId: wh._id, materialId: { $in: ids }, deletedAt: deleted ? undefined : null }).setOptions({ includeSoftDeleted: true }).lean().exec(),
      catIds.length ? this.connection.db!.collection('categories').find({ _id: { $in: catIds } }, { projection: { name: 1 } }).toArray() : Promise.resolve([]),
      // «уже заказано» (ЗП.2): открытые заявки на позицию — по materialId или по тому же наименованию
      this.openRequests(mats as { _id: Types.ObjectId; name?: string }[]),
      // обрезки этих позиций (СМ.2): родитель → [{ id, name, qty }] с остатком > 0 — «сначала брать обрезки»
      this.connection.db!.collection('materials').find({ offcutOf: { $in: ids }, deletedAt: null }, { projection: { name: 1, offcutOf: 1, dimensions: 1 } }).toArray(),
    ]);
    const catName = new Map(cats.map((c) => [String(c._id), String(c.name)]));
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
    const rows = mats.map((m) => {
      const st = byMat.get(String(m._id));
      const quantity = st?.quantity ?? 0, reservedQty = st?.reservedQty ?? 0, minQuantity = st?.minQuantity ?? 0;
      return {
        id: String(m._id), materialId: String(m._id), name: m.name, article: m.article, sku: m.sku, unit: m.unit,
        // АР.1: артикул поставщика и внутренний код (СКЛ-… / sku) — раздельно; откуда взят артикул
        ...articleView(m as { article?: unknown; sku?: unknown; internalArticle?: unknown }), articleSource: (m as { articleSource?: string }).articleSource ?? null,
        categoryId: m.categoryId ? String(m.categoryId) : null, categoryName: m.categoryId ? catName.get(String(m.categoryId)) ?? null : null,
        notes: m.notes, fullName: (m as { fullName?: string }).fullName ?? null, invoiceName: (m as { invoiceName?: string }).invoiceName ?? null, quantity, reservedQty, free: freeQty(quantity, reservedQty), minQuantity,
        ordered: Math.round((openReq.get(String(m._id)) ?? []).reduce((s, r) => s + (r.qty || 0), 0) * 1000) / 1000,
        assortment: m.assortment ?? null, materialGrade: m.materialGrade ?? null, washed: (m as { washed?: boolean }).washed ?? null, dims: dimsOf(m.dimensions),
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
    return { wh, rows };
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
  async categorySummary(scope?: string[] | null) {
    // строки — из общего кэша (тот же ключ, что у listItems({}) и lookup): без сортировки, фото и «висящей» брони
    const key = JSON.stringify([false, null, [], null, null, null, []]);
    const make = () => this.itemRows({}, false, []);
    const { rows } = this.versions ? await this.versions.cached('stock.items', STOCK_COLLS, key, make) : await make();
    const by = new Map<string, { id: string; name: string; total: number; low: number; none: number; ordered: number }>();
    const mine = rows.filter((r) => (scope ? scope.includes(String(r.categoryId)) : !isEmptyMetal(r)));
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

  async getItem(materialId: string) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    const r = await this.listItems({ materialIds: [new Types.ObjectId(materialId)] });
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
