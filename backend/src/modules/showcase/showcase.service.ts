import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { escapeRe, oid } from '../../common/list-query';
import { isUsedByCrm } from '../../common/catalog/catalog-references';
import { CounterService } from '../counter/counter.service';
import { parseCatalog } from './catalog-rows';
import { normalizePassportDefaults, presentPassportDefaults, type PassportDefaults } from './passport-defaults';
import { productNameKey, shortProductName } from './order-product-name';
import { candidateGroups, modelKey, passportScore, type PassportModel } from './passport-models';
import { passportCategoryFor, tallyValues, withDict, type PpCat } from './form-values';

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const LIVE = { deletedAt: null };
/** Варианты изделия (цвета, размеры): список или строка «через запятую / с новой строки» → уникальные непустые, до 50. */
const variants = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/)).map(clean).filter(Boolean))].slice(0, 50);
/** Число ≥ 0 из поля формы («1 200,5»); пусто — null. */
const num = (v: unknown, what: string) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${what} — число`);
  return n;
};
/** Габариты Д×Ш×В + единица (CRM `dimensions`); все пустые — null. */
const parseDimensions = (v: unknown) => {
  const d = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, l] of [['length', 'Длина'], ['width', 'Ширина'], ['height', 'Высота']] as const) { const n = num(d[k], l); if (n) out[k] = n; }
  if (!Object.keys(out).length) return null;
  out.unit = clean(d.unit) || 'мм';
  return out;
};
const presentDimensions = (v: unknown) => {
  const d = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null;
  if (!d || !['length', 'width', 'height'].some((k) => Number(d[k]) > 0)) return null;
  const n = (k: string) => (Number(d[k]) > 0 ? Number(d[k]) : null);
  return { length: n('length'), width: n('width'), height: n('height'), unit: String(d.unit || 'мм') };
};
/** Точное совпадение названия без регистра и лишних пробелов. */
const sameName = (name: string) => new RegExp('^\\s*' + escapeRe(name).replace(/\s+/g, '\\s+') + '\\s*$', 'i');

/**
 * «Продукция» — витрина изделий компании и КП (TASKS БЗ-4) поверх общей коллекции CRM `products` (kind good, unit шт):
 * артикул = `sku`, раздел (Тип) → группа — категории `categories` type 'product' (родитель → ребёнок), цена — `listPrice`,
 * серия — `series` (поле только data-core, CRM его не читает). Загруженное из каталога — `status: draft`, пока нет цены.
 */
@Injectable()
export class ShowcaseService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly counter: CounterService) {}
  private get db() { return this.connection.db!; }

  private async photos(ids: Types.ObjectId[]) {
    const map = new Map<string, { id: string; url: string; thumb: string }>();
    if (!ids.length) return map;
    const [orig, thumbs] = await Promise.all([
      this.db.collection('photos').find({ _id: { $in: ids } }, { projection: { storageUrl: 1 } }).toArray(),
      this.db.collection('photos').find({ parentPhotoId: { $in: ids }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    ]);
    const th = new Map(thumbs.map((t) => [String(t.parentPhotoId), String(t.storageUrl)]));
    for (const p of orig) map.set(String(p._id), { id: String(p._id), url: String(p.storageUrl), thumb: th.get(String(p._id)) ?? String(p.storageUrl) });
    return map;
  }

  private async present(docs: Doc[]) {
    const catIds = [...new Set(docs.map((d) => d.categoryId).filter(Boolean).map(String))].map((x) => new Types.ObjectId(x));
    const cats = catIds.length ? await this.db.collection('categories').find({ _id: { $in: catIds } }, { projection: { name: 1, parentId: 1 } }).toArray() : [];
    const parents = await this.db.collection('categories').find({ _id: { $in: cats.map((c) => c.parentId).filter(Boolean) } }, { projection: { name: 1 } }).toArray();
    const cat = new Map(cats.map((c) => [String(c._id), c])); const par = new Map(parents.map((p) => [String(p._id), String(p.name)]));
    const ph = await this.photos(docs.flatMap((d) => ((d.photoIds as Types.ObjectId[]) ?? [])));
    return docs.map((d) => {
      const c = d.categoryId ? cat.get(String(d.categoryId)) : undefined;
      const pics = ((d.photoIds as Types.ObjectId[]) ?? []).map((p) => ph.get(String(p))).filter(Boolean);
      return { id: String(d._id), sku: String(d.sku ?? ''), name: String(d.name ?? d.sku ?? ''), series: (d.series as string) ?? null, description: (d.description as string) ?? null,
        price: Number(d.listPrice) > 0 ? Number(d.listPrice) : null, status: String(d.status ?? 'new'), groupId: c ? String(c._id) : null, group: c?.parentId ? String(c.name) : null, // категория без родителя — сам раздел (группа не выбрана)
        type: c ? (c.parentId ? par.get(String(c.parentId)) ?? null : String(c.name)) : null, colors: (d.colors as string[]) ?? [], sizes: (d.sizes as string[]) ?? [], photos: pics, photo: pics[0] ?? null, deletedAt: (d.deletedAt as Date) ?? null,
        // характеристики и тексты для паспорта (ФИ2) — поля общей схемы CRM, читаем как есть
        unit: String(d.unit ?? 'шт'), dimensions: presentDimensions(d.dimensions), weightKg: Number(d.weightKg) > 0 ? Number(d.weightKg) : null,
        ralCode: (d.ralCode as string) || null, purpose: (d.purpose as string) || null, installation: (d.installation as string) || null };
    });
  }

  async list(q: Record<string, unknown>) {
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(500, Math.max(1, Number(q.limit) || 50));
    const filter: Record<string, unknown> = { deletedAt: String(q.deleted) === '1' ? { $ne: null } : null };
    if (q.search) { const re = new RegExp(String(q.search).trim().split(/\s+/).map(escapeRe).join('.*'), 'i'); filter.$or = [{ name: re }, { sku: re }, { series: re }]; }
    if (q.groupId) {
      const g = oid(String(q.groupId), 'группы');
      const kids = await this.db.collection('categories').find({ parentId: g }, { projection: { _id: 1 } }).toArray();
      filter.categoryId = { $in: [g, ...kids.map((k) => k._id)] };
    }
    const sortKey = String(q.sort || 'name').replace(/^-/, ''); const dir = String(q.sort || '').startsWith('-') ? -1 : 1;
    const sortField = ({ name: 'name', sku: 'sku', price: 'listPrice', series: 'series', deletedAt: 'deletedAt', category: 'categoryId' } as Record<string, string>)[sortKey] ?? 'name';
    // category — галерея по разделам (ФИ2): изделия одной группы подряд, внутри — по названию
    const order: Record<string, 1 | -1> = sortField === 'categoryId' ? { categoryId: dir, name: 1, _id: 1 } : { [sortField]: dir, _id: 1 };
    const [docs, total] = await Promise.all([
      this.db.collection('products').find(filter).sort(order).skip((page - 1) * limit).limit(limit).toArray(),
      this.db.collection('products').countDocuments(filter),
    ]);
    return { items: await this.present(docs as Doc[]), total, page, limit };
  }

  /** Разделы и группы с числом изделий — плитки витрины. */
  async groups() {
    const cats = await this.db.collection('categories').find({ type: 'product', deletedAt: null }, { projection: { name: 1, parentId: 1 } }).sort({ name: 1 }).toArray();
    const counts = await this.db.collection('products').aggregate([{ $match: LIVE }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]).toArray();
    const n = new Map(counts.map((c) => [String(c._id), c.n as number]));
    const byParent = new Map<string, number>();
    for (const c of cats) if (c.parentId) byParent.set(String(c.parentId), (byParent.get(String(c.parentId)) ?? 0) + (n.get(String(c._id)) ?? 0));
    return cats.map((c) => ({ id: String(c._id), name: String(c.name), parentId: c.parentId ? String(c.parentId) : null, count: (n.get(String(c._id)) ?? 0) + (byParent.get(String(c._id)) ?? 0) }))
      .filter((c) => c.count > 0);
  }

  /**
   * Подсказки формы изделия (ФИ): разделы и группы с числом изделий, названия «Категорий каталога» из категорий паспортов
   * (раздел изделия связан с категорией паспорта по названию), серии, цвета (+ справочник «Цвета») и размеры, что уже встречались.
   */
  async formValues() {
    const [groups, products, colorDict, ppCats, units] = await Promise.all([
      this.groups(),
      this.db.collection('products').find(LIVE, { projection: { series: 1, colors: 1, sizes: 1, ralCode: 1, unit: 1 } }).toArray(),
      this.db.collection('color_references').find({ deletedAt: null }, { projection: { name: 1, description: 1 } }).toArray(),
      this.db.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1, catalogNames: 1 } }).toArray(),
      this.db.collection('units').find({ isActive: { $ne: false }, deletedAt: null }, { projection: { symbol: 1, key: 1, label: 1 } }).toArray(),
    ]);
    const roots = groups.filter((g) => !g.parentId);
    const rootName = new Map(roots.map((g) => [g.id, g.name]));
    const catalog = ppCats.flatMap((c) => String(c.catalogNames ?? '').split(/[,;\n]/).map(clean).filter(Boolean).map((value) => ({ value, sub: `категория паспорта ${clean(c.code)}` })));
    return {
      sections: withDict(roots.map((g) => ({ value: g.name, n: g.count })), catalog),
      groups: groups.filter((g) => g.parentId).map((g) => ({ value: g.name, n: g.count, section: rootName.get(String(g.parentId)) ?? '' })),
      series: tallyValues(products.map((p) => p.series)),
      colors: withDict(tallyValues(products.flatMap((p) => (Array.isArray(p.colors) ? p.colors : []))), colorDict.filter((c) => !/^не выбран/i.test(clean(c.name))).map((c) => ({ value: clean(c.name), sub: 'справочник «Цвета»' }))),
      sizes: tallyValues(products.flatMap((p) => (Array.isArray(p.sizes) ? p.sizes : []))),
      // ФИ2: RAL — встречавшиеся + названия справочника «Цвета» с RAL; единицы — встречавшиеся + справочник «Единицы»
      ral: withDict(tallyValues(products.map((p) => p.ralCode)), colorDict.filter((c) => /ral/i.test(clean(c.name))).map((c) => ({ value: clean(c.name), sub: 'справочник «Цвета»' }))),
      units: withDict(tallyValues(products.map((p) => p.unit)), units.map((u) => ({ value: clean(u.symbol || u.key), sub: clean(u.label) || undefined }))),
    };
  }

  async get(id: string) {
    const d = await this.db.collection('products').findOne({ _id: oid(id, 'изделия') });
    if (!d) throw new NotFoundException('Изделие не найдено');
    const item = (await this.present([d as Doc]))[0];
    const composition = await this.composition(d as Doc);
    const ppCats = (await this.db.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1, name: 1, catalogNames: 1 } }).toArray()) as unknown as PpCat[];
    return { ...item, orderLines: await this.orderLines(d as Doc), composition, cost: await this.cost(composition), passports: await this.passports(d as Doc),
      passportCategory: passportCategoryFor(item, ppCats),
      passportDefaults: presentPassportDefaults(d.passportDefaults as PassportDefaults) };
  }

  /** Значения паспорта по умолчанию (БЗ-6 Э4b): заменяются целиком; пустое тело — очистить. */
  async setPassportDefaults(id: string, b: Record<string, unknown>) {
    const _id = oid(id, 'изделия');
    if (!(await this.db.collection('products').findOne({ _id, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Изделие не найдено');
    const v = normalizePassportDefaults(b ?? {});
    await this.db.collection('products').updateOne({ _id }, Object.keys(v).length ? { $set: { passportDefaults: v, updatedAt: new Date() } } : { $unset: { passportDefaults: '' }, $set: { updatedAt: new Date() } });
    return this.get(id);
  }

  /** Состав изделия (БЗ-5): строки-материалы из products.composition с названиями из справочника; прочие строки (модули, изделия) в этот список не входят. */
  private async composition(d: Doc) {
    const lines = ((d.composition as Record<string, unknown>[] | undefined) ?? []).filter((l) => l.lineType === 'material');
    if (!lines.length) return [];
    const mats = await this.db.collection('materials').find({ _id: { $in: lines.map((l) => l.refId as Types.ObjectId) } }, { projection: { name: 1, article: 1, unit: 1 } }).toArray();
    const by = new Map(mats.map((m) => [String(m._id), m]));
    return lines.map((l) => {
      const m = by.get(String(l.refId));
      return { id: String(l._id ?? ''), materialId: String(l.refId), name: String(m?.name ?? '(материал удалён)'), article: (m?.article as string) ?? null, unit: String(l.unit ?? m?.unit ?? 'шт'), quantity: Number(l.quantity) || 0, notes: (l.notes as string) ?? null };
    });
  }

  /** Заменить состав-материалы изделия; строки других типов остаются как есть. lines: [{ materialId, quantity, notes? }]. */
  async setComposition(id: string, lines: { materialId?: string; quantity?: number | string; notes?: string }[]) {
    const _id = oid(id, 'изделия');
    const d = await this.db.collection('products').findOne({ _id, deletedAt: null });
    if (!d) throw new NotFoundException('Изделие не найдено');
    if (!Array.isArray(lines) || lines.length > 300) throw new BadRequestException('Некорректный состав');
    const ids = lines.map((l) => oid(String(l.materialId ?? ''), 'материала'));
    const mats = new Map((await this.db.collection('materials').find({ _id: { $in: ids } }, { projection: { unit: 1 } }).toArray()).map((m) => [String(m._id), m]));
    const seen = new Set<string>();
    const next = lines.map((l, i) => {
      const key = String(ids[i]);
      const m = mats.get(key);
      if (!m) throw new BadRequestException('Материал не найден в справочнике');
      if (seen.has(key)) throw new BadRequestException('Один материал указан дважды — сложите количество в одну строку');
      seen.add(key);
      const q = Number(String(l.quantity ?? '').replace(',', '.'));
      if (!Number.isFinite(q) || q <= 0) throw new BadRequestException('Количество должно быть больше нуля');
      return { _id: new Types.ObjectId(), lineType: 'material', refId: ids[i], quantity: q, sortOrder: i, unit: String(m.unit ?? 'шт'), notes: clean(l.notes) || undefined };
    });
    const others = ((d.composition as Record<string, unknown>[] | undefined) ?? []).filter((l) => l.lineType !== 'material');
    await this.db.collection('products').updateOne({ _id }, { $set: { composition: [...next, ...others], updatedAt: new Date() } });
    return this.get(id);
  }

  /**
   * Себестоимость материалов (БЗ-5): количество × цена за единицу. Цена — последняя закупка материала (заявка снабжения,
   * не отменённая: сумма строки / количество; сумма — priceHint «Сумма с НДС» или lineTotal), иначе — цена из справочника
   * материалов (pricePerUnit). Количество закупки — полученное, если есть (receivedQty), иначе заказанное. Только расчёт,
   * в изделие не пишется (costPrice — поле CRM). Строки без цены в сумму не входят, их число — missing.
   */
  private async cost(lines: Array<{ materialId: string; quantity: number }>) {
    if (!lines.length) return null;
    const ids = lines.map((l) => new Types.ObjectId(l.materialId));
    const [last, mats] = await Promise.all([
      this.db.collection('supplyrequests').aggregate([
        { $match: { deletedAt: null, materialId: { $in: ids }, status: { $ne: 'cancelled' }, qty: { $gt: 0 }, $or: [{ priceHint: { $gt: 0 } }, { lineTotal: { $gt: 0 } }] } },
        { $sort: { requestDate: -1, createdAt: -1 } },
        { $group: { _id: '$materialId', priceHint: { $first: '$priceHint' }, lineTotal: { $first: '$lineTotal' }, qty: { $first: '$qty' }, receivedQty: { $first: '$receivedQty' }, date: { $first: { $ifNull: ['$requestDate', '$createdAt'] } } } },
      ]).toArray(),
      this.db.collection('materials').find({ _id: { $in: ids } }, { projection: { pricePerUnit: 1 } }).toArray(),
    ]);
    const unitPrice = (x: Record<string, unknown>) => (Number(x.priceHint) > 0 ? Number(x.priceHint) : Number(x.lineTotal)) / (Number(x.receivedQty) > 0 ? Number(x.receivedQty) : Number(x.qty));
    const buy = new Map(last.map((x) => [String(x._id), { price: unitPrice(x), date: (x.date as Date) ?? null }]));
    const ref = new Map(mats.map((m) => [String(m._id), Number(m.pricePerUnit) > 0 ? Number(m.pricePerUnit) : null]));
    const rows = lines.map((l) => {
      const b = buy.get(l.materialId); const r = ref.get(l.materialId) ?? null;
      const price = b ? Math.round(b.price * 100) / 100 : r;
      return { materialId: l.materialId, price, source: b ? 'purchase' : r != null ? 'reference' : null, date: b?.date ?? null, sum: price != null ? Math.round(price * l.quantity * 100) / 100 : null };
    });
    return { total: Math.round(rows.reduce((s, x) => s + (x.sum ?? 0), 0) * 100) / 100, missing: rows.filter((x) => x.price == null).length, lines: rows };
  }

  /** Паспорта изделия (БЗ-5): по ссылке productId или с тем же названием; последние 30 и общее число. */
  private async passports(d: Doc) {
    const name = clean(d.name);
    const filter = { deletedAt: null, $or: [{ productId: d._id }, ...(name ? [{ name: sameName(name) }] : [])] };
    const coll = this.db.collection('productpassports');
    const [docs, total] = await Promise.all([
      coll.find(filter, { projection: { passportNumber: 1, date: 1, customerName: 1, objectName: 1, orderNo: 1 } }).sort({ date: -1, _id: -1 }).limit(30).toArray(),
      coll.countDocuments(filter),
    ]);
    return { total, items: docs.map((x) => ({ id: String(x._id), passportNumber: x.passportNumber ?? null, date: x.date ?? null, customer: x.customerName || x.objectName || null, orderNo: x.orderNo ?? null })) };
  }

  /** Где изделие в заказах: позиции со ссылкой productId или с тем же названием (без регистра), до 30 штук (БЗ-5). */
  private async orderLines(d: Doc) {
    const name = clean(d.name);
    const or: Record<string, unknown>[] = [{ productId: d._id }];
    if (name) or.push({ title: sameName(name) });
    const lines = await this.db.collection('incomes').find({ ...LIVE, orderId: { $ne: null }, $or: or }).sort({ shipDate: -1 }).limit(30).toArray();
    return lines.map((l) => ({ id: String(l._id), orderId: String(l.orderId), orderNo: l.orderNo ?? null, customer: l.customer ?? null, qty: l.qty ?? null, color: l.color ?? null, size: l.size ?? null, shipDate: l.shipDate ?? null, linked: !!l.productId }));
  }

  /** Категория type product по названию (с родителем) — найти или завести (slug и skuPrefix уникальны в общей схеме). */
  private async category(name: string | null, parentId: Types.ObjectId | null) {
    const n = clean(name);
    if (!n) return parentId;
    const found = await this.db.collection('categories').findOne({ type: 'product', deletedAt: null, parentId: parentId ?? null, name: new RegExp(`^\\s*${escapeRe(n)}\\s*$`, 'i') });
    if (found) return found._id as Types.ObjectId;
    const h = createHash('md5').update(`${parentId ?? ''}/${n.toLowerCase()}`).digest('hex').slice(0, 8);
    const { insertedId } = await this.db.collection('categories').insertOne({ name: n, slug: `product-${h}`, type: 'product', parentId: parentId ?? null, skuPrefix: `PR${h.toUpperCase()}`, sortOrder: 0, isActive: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
    return insertedId;
  }

  private async fields(dto: Record<string, unknown>) {
    const set: Record<string, unknown> = {};
    if (dto.name !== undefined) { const v = clean(dto.name); if (!v) throw new BadRequestException('Наименование не может быть пустым'); set.name = v; }
    if (dto.series !== undefined) set.series = clean(dto.series) || null;
    if (dto.description !== undefined) set.description = String(dto.description ?? '').trim() || null;
    if (dto.price !== undefined) { const p = dto.price === null || dto.price === '' ? 0 : Number(String(dto.price).replace(/\s/g, '').replace(',', '.')); if (!Number.isFinite(p) || p < 0) throw new BadRequestException('Цена — число'); set.listPrice = p; if (p > 0) set.status = 'active'; }
    if (dto.group !== undefined || dto.type !== undefined) set.categoryId = await this.category(dto.group as string, await this.category(dto.type as string, null));
    for (const k of ['colors', 'sizes'] as const) if (dto[k] !== undefined) set[k] = variants(dto[k]);
    // ФИ2: характеристики, тексты для паспорта, статус (поля схемы CRM — только существующие)
    if (dto.dimensions !== undefined) set.dimensions = parseDimensions(dto.dimensions);
    if (dto.weightKg !== undefined) set.weightKg = num(dto.weightKg, 'Вес') ?? 0;
    if (dto.ralCode !== undefined) set.ralCode = clean(dto.ralCode) || null;
    if (dto.unit !== undefined) set.unit = clean(dto.unit) || 'шт';
    for (const k of ['purpose', 'installation'] as const) if (dto[k] !== undefined) set[k] = String(dto[k] ?? '').trim() || null;
    if (dto.status !== undefined && dto.status !== null && dto.status !== '') {
      const st = String(dto.status);
      if (!['draft', 'active', 'archived'].includes(st)) throw new BadRequestException('Статус: черновик, в продаже или архив');
      // черновик = «нет цены»: с ценой изделие в продаже, если не отправлено в архив
      if (!(st === 'draft' && Number(set.listPrice) > 0)) set.status = st;
    }
    if (Array.isArray(dto.photoIds)) set.photoIds = (dto.photoIds as string[]).filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    return set;
  }

  /** requireType — ручное создание из формы (ФИ2): раздел обязателен; загрузка каталога / из заказов / из паспортов — без него. */
  async create(dto: Record<string, unknown>, opts: { requireType?: boolean } = {}) {
    const sku = clean(dto.sku);
    if (!sku) throw new BadRequestException('Укажите артикул');
    if (await this.db.collection('products').findOne({ sku: new RegExp(`^\\s*${escapeRe(sku)}\\s*$`, 'i') })) throw new ConflictException(`Изделие с артикулом ${sku} уже есть`);
    if (opts.requireType && !clean(dto.type)) throw new BadRequestException('Укажите раздел изделия');
    const set = await this.fields({ ...dto, name: dto.name ?? sku });
    const now = new Date();
    const { insertedId } = await this.db.collection('products').insertOne({ sku, kind: 'good', unit: 'шт', status: 'draft', listPrice: 0, basePrice: 0, costPrice: 0, defaultMarkupPercent: 30, stockQty: 0,
      photoIds: [], mainPhotoId: null, productModuleIds: [], composition: [], isActive: true, deletedAt: null, hasPassport: false, hasDrawing: false, ...set, source: 'showcase', createdAt: now, updatedAt: now });
    return this.get(String(insertedId));
  }

  async update(id: string, dto: Record<string, unknown>) {
    const _id = oid(id, 'изделия');
    const set = await this.fields(dto);
    if (dto.sku !== undefined) {
      const sku = clean(dto.sku); if (!sku) throw new BadRequestException('Артикул не может быть пустым');
      if (await this.db.collection('products').findOne({ _id: { $ne: _id }, sku: new RegExp(`^\\s*${escapeRe(sku)}\\s*$`, 'i') })) throw new ConflictException(`Артикул ${sku} уже у другого изделия`);
      set.sku = sku;
    }
    if (set.photoIds) set.mainPhotoId = (set.photoIds as Types.ObjectId[])[0] ?? null;
    const r = await this.db.collection('products').updateOne({ _id, deletedAt: null }, { $set: { ...set, updatedAt: new Date() } });
    if (!r.matchedCount) throw new NotFoundException('Изделие не найдено');
    return this.get(id);
  }

  /** В корзину: изделие из заказов CRM / КП не удаляется (ссылки) — проверяем составы и заказы CRM. */
  async remove(id: string) {
    const _id = oid(id, 'изделия');
    const used = await this.db.collection('products').findOne({ deletedAt: null, 'composition.productId': _id }, { projection: { name: 1 } });
    if (used) throw new ConflictException(`Изделие входит в состав «${used.name}» — удалить нельзя`);
    if (await isUsedByCrm(this.connection, 'product', _id)) throw new ConflictException('На изделие ссылаются заказы / документы CRM — удалить нельзя');
    const r = await this.db.collection('products').updateOne({ _id, deletedAt: null }, { $set: { deletedAt: new Date() } });
    if (!r.matchedCount) throw new NotFoundException('Изделие не найдено');
    return { id, deleted: true };
  }

  async restore(id: string) {
    await this.db.collection('products').updateOne({ _id: oid(id, 'изделия') }, { $set: { deletedAt: null } });
    return this.get(id);
  }

  /**
   * Загрузка каталога (Excel / вставка): по артикулу — новое изделие или обновление названия, раздела/группы, серии
   * (цену — только если в файле есть, а у изделия нет). apply=false — только отчёт (что будет). Ничего не удаляет.
   */
  async import(text: string, apply: boolean) {
    const { rows, errors } = parseCatalog(text);
    const existing = await this.db.collection('products').find({ sku: { $in: rows.map((r) => r.sku) } }, { projection: { sku: 1, name: 1, series: 1, listPrice: 1, deletedAt: 1 } }).toArray();
    const by = new Map(existing.map((e) => [String(e.sku).toLowerCase(), e]));
    const plan = rows.map((r) => {
      const e = by.get(r.sku.toLowerCase());
      const action = !e ? 'new' : e.deletedAt ? 'deleted' : (clean(e.name) !== r.name || (e.series ?? null) !== r.series || (r.price && !(Number(e.listPrice) > 0))) ? 'update' : 'same';
      return { ...r, action };
    });
    const count = (a: string) => plan.filter((p) => p.action === a).length;
    const report = { total: rows.length, new: count('new'), update: count('update'), same: count('same'), deleted: count('deleted'), errors, preview: plan.slice(0, 30) };
    if (!apply) return { ...report, applied: false };
    for (const p of plan) {
      if (p.action === 'new') await this.create({ sku: p.sku, name: p.name, series: p.series, type: p.type, group: p.group, ...(p.price ? { price: p.price } : {}) });
      else if (p.action === 'update') {
        const e = by.get(p.sku.toLowerCase())!;
        await this.update(String(e._id), { name: p.name, series: p.series, type: p.type, group: p.group, ...(p.price && !(Number(e.listPrice) > 0) ? { price: p.price } : {}) });
      }
    }
    return { ...report, applied: true };
  }

  /**
   * Изделия из заказов (БЗ-5): позиции заказов, которых ещё нет в «Продукции» (по короткому имени без регистра), → черновики.
   * apply=false — только отчёт. При apply: создаём изделие (status draft, без цены, полное описание из заказа) и ставим
   * позициям productId (только где его не было). Текст и суммы позиций не трогаем — договор.
   */
  async fromOrders(apply: boolean, picks?: { key?: string; name?: string }[]) {
    const lines = await this.db.collection('incomes').find({ ...LIVE, orderId: { $ne: null }, productId: null }, { projection: { title: 1, orderNo: 1 } }).toArray();
    const have = new Map<string, Types.ObjectId>();
    for (const p of await this.db.collection('products').find({ deletedAt: null }, { projection: { name: 1 } }).toArray()) { const k = productNameKey(String(p.name ?? '')); if (!have.has(k)) have.set(k, p._id as Types.ObjectId); }
    const groups = new Map<string, { name: string; description: string; ids: Types.ObjectId[]; orders: Set<string> }>();
    for (const l of lines) {
      const name = shortProductName(String(l.title ?? ''));
      if (!name) continue;
      const key = productNameKey(name);
      const g = groups.get(key) ?? { name, description: String(l.title ?? '').trim(), ids: [], orders: new Set<string>() };
      g.ids.push(l._id as Types.ObjectId); if (l.orderNo) g.orders.add(String(l.orderNo)); groups.set(key, g);
    }
    const plan = [...groups.entries()].map(([key, g]) => ({ key, ...g, action: have.has(key) ? 'exists' : 'new' }));
    const fresh = plan.filter((p) => p.action === 'new');
    const row = (p: (typeof plan)[number]) => ({ key: p.key, name: p.name, lines: p.ids.length, orders: [...p.orders].slice(0, 5) });
    const report = { lines: lines.length, new: fresh.length, exists: plan.length - fresh.length, preview: fresh.slice(0, 30).map(row), items: fresh.map(row) };
    if (!apply) return { ...report, applied: false };
    // выбор (галочки в панели): создаём только отмеченные, с поправленным названием; без picks — все, как раньше
    let chosen: Map<string, string> | null = null;
    if (picks !== undefined) {
      if (!Array.isArray(picks) || picks.length > 2000) throw new BadRequestException('Некорректный выбор изделий');
      chosen = new Map(picks.filter((x) => x?.key).map((x) => [String(x.key), clean(x.name).slice(0, 256)]));
      if (!chosen.size) throw new BadRequestException('Отметьте изделия, которые создать');
    }
    let created = 0;
    for (const p of plan) {
      let productId: Types.ObjectId | null = null;
      if (p.action === 'new') {
        if (chosen && !chosen.has(p.key)) continue; // не отмечено — позиции заказов остаются без изделия
        const name = chosen?.get(p.key) || p.name;
        const sku = 'ЗК-' + createHash('md5').update(p.key).digest('hex').slice(0, 6).toUpperCase();
        try { productId = new Types.ObjectId((await this.create({ sku, name, description: p.description.length > name.length ? p.description : '' })).id); created++; } catch { continue; }
      } else {
        const e = have.get(p.key);
        if (!e) continue;
        productId = e;
      }
      await this.db.collection('incomes').updateMany({ _id: { $in: p.ids }, productId: null }, { $set: { productId } });
    }
    return { ...report, applied: true, created };
  }

  // ─── БЗ-8: изделия из паспортов без дублей ───────────────────────────────────────────────────────
  /** Модели паспортов без изделия («наименование + артикул», лучший паспорт по полноте) и группы-кандидаты на объединение. */
  async passportGroups() {
    const pp = this.db.collection('productpassports');
    const docs = await pp.find({ deletedAt: null, productId: null }, { projection: { textSnapshot: 0, bom: 0 } }).toArray();
    const by = new Map<string, PassportModel>();
    let noName = 0;
    for (const d of docs) {
      const name = clean(d.name), article = clean(d.article);
      if (!name) { noName++; continue; }
      const k = modelKey(name, article), score = passportScore(d);
      const m = by.get(k);
      if (!m) by.set(k, { key: k, name, article, n: 1, score, bestId: String(d._id) });
      else { m.n++; if (score > m.score) { m.score = score; m.bestId = String(d._id); } }
    }
    const models = [...by.values()];
    const groups = candidateGroups(models);
    const inGroup = new Set(groups.flat().map((m) => m.key));
    const singles = models.filter((m) => !inGroup.has(m.key)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { groups, singles: singles.length, singlesPreview: singles.slice(0, 30).map((m) => ({ name: m.name, article: m.article, n: m.n })), noName,
      linked: await pp.countDocuments({ deletedAt: null, productId: { $ne: null } }) };
  }

  /**
   * Объединить в изделия «Продукции»: группа → одно изделие с данными лучшего паспорта (main) и ссылка productId у всех
   * паспортов группы. Выданные паспорта (номера, текст, PDF) не меняются. rest — изделие на каждую оставшуюся одиночную модель.
   */
  async fromPassports(dto: { groups?: { keys?: string[]; main?: string; name?: string }[]; rest?: boolean }) {
    let created = 0, linked = 0;
    const link = async (keys: string[], productId: Types.ObjectId) => {
      const or = keys.map((k) => { const [name, article] = k.split('\u0000'); return { name, ...(article ? { article } : { article: { $in: [null, ''] } }) }; });
      linked += (await this.db.collection('productpassports').updateMany({ deletedAt: null, productId: null, $or: or }, { $set: { productId } })).modifiedCount;
    };
    const fromBest = async (key: string, name?: string) => {
      const state = await this.passportGroups();
      const m = [...state.groups.flat(), ...(await this.singleModels())].find((x) => x.key === key);
      if (!m) throw new NotFoundException('Модель не найдена — обновите список (её могли уже объединить)');
      const best = await this.db.collection('productpassports').findOne({ _id: new Types.ObjectId(m.bestId) });
      return this.productFromPassport(best as Doc, clean(name) || m.name, m.article);
    };
    for (const g of dto.groups ?? []) {
      const keys = (g.keys ?? []).filter(Boolean);
      if (!keys.length || !g.main || !keys.includes(g.main)) throw new BadRequestException('Выберите паспорта группы и главный вариант');
      const id = await fromBest(g.main, g.name);
      created++;
      await link(keys, id);
    }
    if (dto.rest) {
      for (const m of await this.singleModels()) {
        const best = await this.db.collection('productpassports').findOne({ _id: new Types.ObjectId(m.bestId) });
        await link([m.key], await this.productFromPassport(best as Doc, m.name, m.article));
        created++;
      }
    }
    return { created, linked };
  }

  private async singleModels() {
    const s = await this.passportGroups();
    const inGroup = new Set(s.groups.flat().map((m) => m.key));
    const docs = await this.db.collection('productpassports').find({ deletedAt: null, productId: null, name: { $nin: [null, ''] } }, { projection: { textSnapshot: 0, bom: 0 } }).toArray();
    const by = new Map<string, PassportModel>();
    for (const d of docs) {
      const name = clean(d.name), article = clean(d.article), k = modelKey(name, article), score = passportScore(d);
      if (inGroup.has(k)) continue;
      const m = by.get(k);
      if (!m) by.set(k, { key: k, name, article, n: 1, score, bestId: String(d._id) });
      else { m.n++; if (score > m.score) { m.score = score; m.bestId = String(d._id); } }
    }
    return [...by.values()];
  }

  /** Изделие из паспорта: артикул — из паспорта (занят другим изделием — с суффиксом -2, -3…), без артикула — ПС-<код>; значения паспорта по умолчанию. */
  private async productFromPassport(p: Doc, name: string, article: string): Promise<Types.ObjectId> {
    const base = article || 'ПС-' + createHash('md5').update(name.toLowerCase()).digest('hex').slice(0, 6).toUpperCase();
    let created: { id: string } | null = null;
    for (let i = 1; i <= 20 && !created; i++) {
      const sku = i === 1 ? base : `${base}-${i}`;
      try { created = await this.create({ sku, name, group: p.category ?? '', description: p.description ?? '' }); }
      catch (e) { if (!(e instanceof ConflictException)) throw e; }
    }
    if (!created) throw new ConflictException(`Не удалось подобрать свободный артикул для «${name}»`);
    const id = new Types.ObjectId(created.id);
    const pick = Object.fromEntries(['passportCategory', 'elements', 'materialIds', 'installationTypeId', 'isKit', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'warrantyMonths']
      .filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== '').map((k) => [k, p[k]]));
    try {
      const defaults = normalizePassportDefaults(pick);
      if (Object.keys(defaults).length) await this.db.collection('products').updateOne({ _id: id }, { $set: { passportDefaults: defaults, source: 'passports' } });
    } catch { /* неверные значения в старом паспорте — изделие без значений по умолчанию */ }
    return id;
  }

  /** Данные коммерческого предложения: номер КП, реквизиты нашей компании, заказчик, строки с фото и суммами. */
  async kp(dto: { items?: { id: string; qty?: number; price?: number }[]; companyId?: string; customer?: string; note?: string }) {
    const items = (dto.items ?? []).filter((x) => x?.id);
    if (!items.length) throw new BadRequestException('Выберите изделия для КП');
    const docs = (await this.db.collection('products').find({ _id: { $in: items.map((x) => oid(x.id, 'изделия')) } }).toArray()) as Doc[];
    const pres = new Map((await this.present(docs)).map((p) => [p.id, p]));
    const lines = items.map((x) => {
      const p = pres.get(x.id); if (!p) throw new NotFoundException('Изделие не найдено — обновите витрину');
      const qty = Number(x.qty) > 0 ? Number(x.qty) : 1, price = Number(x.price) >= 0 && x.price !== undefined ? Number(x.price) : p.price ?? 0;
      return { id: p.id, sku: p.sku, name: p.name, series: p.series, group: p.group, qty, price, sum: Math.round(qty * price * 100) / 100, photo: p.photo };
    });
    const co = dto.companyId ? await this.db.collection('organizations').findOne({ _id: oid(dto.companyId, 'компании'), isOurCompany: true })
      : await this.db.collection('organizations').findOne({ isOurCompany: true, deletedAt: null });
    const number = await this.counter.next('CommercialOffer', 'КП');
    return {
      number, date: new Date(), customer: clean(dto.customer) || null, note: String(dto.note ?? '').trim() || null,
      company: co ? { name: co.name, shortName: co.shortName ?? null, fullName: co.fullName ?? null, inn: String(co.inn ?? '').startsWith('БЕЗ-ИНН') ? null : co.inn, kpp: co.kpp ?? null, address: co.legalAddress ?? null,
        phone: co.phone ?? null, email: co.email ?? null, website: co.website ?? null, bankName: co.bankName ?? null, bankBik: co.bankBik ?? null, bankAccount: co.bankAccount ?? null, bankCorrAccount: co.bankCorrAccount ?? null } : null,
      items: lines, total: Math.round(lines.reduce((s, l) => s + l.sum, 0) * 100) / 100, noPrice: lines.filter((l) => !l.price).length,
    };
  }
}
