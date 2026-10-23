import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ForbiddenException } from '@nestjs/common';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types, type ClientSession } from 'mongoose';
import { parseList } from '../../common/list-query';
import { tokensFilter } from '../../common/text/search-norm';
import { ProductPassport, ProductPassportDocument } from './product-passport.schema';
import { PassportTemplate, PassportTemplateDocument } from './passport-template.schema';
import { normalizeCategory, type PassportCategory } from './passport-template-select';
import { DEFAULT_PASSPORT_TEMPLATE, type PassportTemplateContent } from './passport-template.default';
import { CreateProductPassportDto } from './dto/create-product-passport.dto';
import { UpdateProductPassportDto } from './dto/update-product-passport.dto';
import { DEFAULT_BOM, buildDescription, dayUtc, missingFieldsV2, requiredImageKinds, nextSeq, warrantyCodeFor, type CounterColl, missingKeyed } from './passport-rules';
import { standardWarnings, standardsDict, type StandardDoc } from './passport-compose';
import type { DictRec } from './passport-compose-parts';
import { buildV2Text } from './passport-v2-text';
import { editSnapshotItem, type SnapshotSection } from './passport-snapshot-edit';
import { promoteToOwn } from './passport-promote';
import { standardSchemes } from './passport-schemes';
import { PASSPORT_TEXTS_V2 } from './passport-texts.v2';

/** Общая часть «Для всех» паспорта v2 в passporttemplates (отдельно от шаблона «Для всех» PDF v1). */
const ALL_V2 = 'ALL_V2';
import { textsTree } from './passport-texts-tree';

type Doc = Record<string, unknown>;
const SORT = ['passportNo', 'date', 'name', 'category', 'customerName', 'createdAt', 'updatedAt'];
/** Поля модели — переходят в копию паспорта и подставляются из выбранной модели (ПС.5). */
export const MODEL_FIELDS = ['productId', 'name', 'category', 'article', 'height', 'length', 'width', 'weight', 'materials', 'purpose', 'installationMethod', 'description', 'supplierOrgId', 'supplier', 'warrantyMonths', 'bom',
  // v2 (БЗ-6): поля модели — копия на ту же модель и выбор модели переносят их
  'passportCategory', 'elements', 'materialIds', 'installationTypeId', 'isKit', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears'] as const;
/** Выданные номера: без `confirmNumbers: true` не меняются (ПС, «не менять молча»). */
/** Массовое изменение (БЗ-9): общие поля паспортов; номера, талон, наименование, артикул, картинки — только по одному. */
export const BULK_PASSPORT_FIELDS = ['passportCategory', 'category', 'installationTypeId', 'elements', 'materialIds', 'isKit', 'serviceLifeYears', 'warrantyMonths', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth',
  'supplierOrgId', 'customerName', 'orderNo', 'objectName', 'installedBy', 'saleDate', 'installedAt'] as const;
const BULK_NUMBER_FIELDS = ['serviceLifeYears', 'warrantyMonths', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth'] as const;
/** НМ-1: у выпущенного паспорта свободно меняются только эти поля (заполняются после печати). */
export const AFTER_PRINT_FIELDS = ['saleDate', 'customerName', 'customerOrgId', 'orderNo', 'salesOrderId', 'objectName', 'installedBy', 'installedAt', 'note'] as const;
/** НМ: выпущен ли паспорт (нет статуса и есть номер — старый, выпущенный до НМ). */
export const isIssued = (d: { status?: unknown; passportNumber?: unknown }) => d.status === 'issued' || (!d.status && !!d.passportNumber && !isDraftNumber(d.passportNumber));
/**
 * НМ: у черновика вместо номера — служебная метка `draft-<id>`: уникальный индекс passportNumber в общей с CRM базе
 * не допускает двух пустых номеров, а у CRM kppdf номер обязателен. Человеку метка не показывается (список «—», PDF без номера).
 */
export const DRAFT_PREFIX = 'draft-';
export const isDraftNumber = (n: unknown) => String(n ?? '').startsWith(DRAFT_PREFIX);
const NUMBER_FIELDS = ['passportNumber', 'productCode', 'warrantyCode', 'date'] as const;
const OID_FIELDS = ['productId', 'customerOrgId', 'salesOrderId', 'supplierOrgId', 'installationTypeId', 'manufacturerOrgId'] as const;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class ProductPassportService {
  constructor(
    @InjectModel(ProductPassport.name) private readonly model: Model<ProductPassportDocument>,
    @InjectModel(PassportTemplate.name) private readonly templates: Model<PassportTemplateDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Optional() private readonly versions?: DataVersionService,
  ) {}

  // ─── список ──────────────────────────────────────────────────────────────────────────────────────
  /**
   * Список: поиск, фильтры (год, месяц, категория, поставщик, заказчик, без картинок, неполные), {items,total,page,limit}.
   * Текст паспорта (`textSnapshot`, ~30 КБ на паспорт) в список не берётся — он нужен карточке и PDF; `full` — с ним (пакет PDF).
   */
  async list(q: Record<string, unknown> = {}, { full = false } = {}): Promise<{ items: Doc[]; total: number; page: number; limit: number; incomplete: number }> {
    const p = parseList(q, { sortable: SORT, defaultSort: '-passportNo', defaultLimit: 25 });
    const make = async () => {
      const filter = this.filterOf(q, p.deleted);
      // поиск «как на складе»: «качели двойные» = «двойные качели», ё = е
      const sf = tokensFilter(q.search, ['passportNumber', 'warrantyCode', 'productCode', 'name', 'article', 'customerName', 'objectName', 'orderNo', 'category', 'supplier']);
      if (sf) filter.$and = sf.$and;
      const docs = await this.model.find(filter, full ? undefined : { textSnapshot: 0 }).setOptions({ includeSoftDeleted: true }).sort({ ...p.sort, _id: -1 }).lean().exec();
      // «неполные» считаются правилами, а не запросом — паспортов сотни
      const [cats, inst] = await Promise.all([this.categoryRules(), this.installs()]);
      return docs.map((d) => ({ ...(d as unknown as Doc), missing: missingFieldsV2(this.withSchemes(d as unknown as Doc, inst) as never, cats.get(String((d as unknown as Doc).passportCategory ?? ''))) }));
    };
    // скорость С9: расчёт по всем паспортам — один раз, пока паспорта и справочники не менялись; строки общие — копируем
    const rest = Object.fromEntries(Object.entries(q).filter(([k]) => k !== 'page' && k !== 'limit'));
    const all: Array<Doc & { missing: string[] }> = this.versions && !full
      ? await this.versions.cached('passports.list', ['productpassports', 'dict_values'], JSON.stringify(rest), make) : await make();
    const rows = q.incomplete === '1' || q.incomplete === 'true' ? all.filter((d) => d.missing.length) : all;
    const items = rows.slice(p.skip, p.skip + p.limit).map((d) => ({ ...d }));
    await this.attachThumbs(items);
    return { items, total: rows.length, page: p.page, limit: p.limit, incomplete: all.filter((d) => d.missing.length).length };
  }

  /** Миниатюра общего вида (галерея, строка списка): `thumb` — маленькая, `photoUrl` — оригинал. */
  private async attachThumbs(items: Doc[]) {
    const first = (d: Doc) => ((d.images as Array<{ kind: string; photoId: Types.ObjectId; order?: number }>) || []).filter((i) => i.kind === 'overview').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]?.photoId;
    const ids = items.map(first).filter(Boolean) as Types.ObjectId[];
    if (!ids.length) return;
    const photos = this.connection.collection('photos');
    const [orig, thumbs] = await Promise.all([
      photos.find({ _id: { $in: ids } }, { projection: { storageUrl: 1 } }).toArray(),
      photos.find({ parentPhotoId: { $in: ids }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    ]);
    const url = new Map(orig.map((x) => [String(x._id), x.storageUrl as string]));
    const th = new Map(thumbs.map((x) => [String(x.parentPhotoId), x.storageUrl as string]));
    for (const d of items) { const id = first(d); if (!id) continue; d.photoUrl = url.get(String(id)) ?? null; d.thumb = th.get(String(id)) ?? d.photoUrl; }
  }

  /**
   * Готовые тексты для «Описания» (ПС.5): материалы, установка, назначение — все разные варианты из паспортов,
   * с числом паспортов и категориями (в форме сначала — для выбранной категории). Новый текст, сохранённый в паспорте,
   * сам попадает в варианты.
   */
  async phrases(): Promise<Record<string, Array<{ text: string; n: number; categories: string[]; passportCategories: string[] }>>> {
    const out: Record<string, Array<{ text: string; n: number; categories: string[]; passportCategories: string[] }>> = {};
    for (const f of ['materials', 'installationMethod', 'purpose'] as const) {
      const rows = await this.model.aggregate([
        { $match: { deletedAt: null, [f]: { $nin: [null, ''] } } },
        { $group: { _id: `$${f}`, n: { $sum: 1 }, categories: { $addToSet: '$category' }, passportCategories: { $addToSet: '$passportCategory' } } }, // ПК: и коды категорий паспорта
        { $sort: { n: -1, _id: 1 } },
      ]).exec();
      out[f] = rows.map((r) => ({ text: String(r._id), n: r.n, categories: (r.categories as unknown[]).filter(Boolean).map(String), passportCategories: ((r.passportCategories as unknown[]) ?? []).filter(Boolean).map(String) }));
    }
    return out;
  }

  /**
   * Модели (артикул + наименование) — для «Новый паспорт → выберите модель» (ПС.5): поля и картинки берутся
   * из последнего паспорта модели; `n` — сколько паспортов выдано.
   */
  async models(): Promise<Doc[]> {
    // скорость С9: один расчёт, пока не менялись паспорта и фото; результат общий — не менять
    return this.versions ? this.versions.cached('passports.models', ['productpassports', 'photos'], '', () => this.buildModels()) : this.buildModels();
  }

  private async buildModels(): Promise<Doc[]> {
    const groups = await this.model.aggregate([
      { $match: { deletedAt: null, name: { $nin: [null, ''] } } },
      { $project: { textSnapshot: 0 } }, // текст паспорта модели не нужен — без него группировка в разы легче
      { $sort: { passportNo: -1 } },
      { $group: { _id: { a: { $ifNull: ['$article', ''] }, n: '$name' }, n: { $sum: 1 }, doc: { $first: '$$ROOT' } } },
      { $sort: { 'doc.category': 1, 'doc.name': 1 } },
    ]).exec();
    const items: Doc[] = groups.map((g) => {
      const d = g.doc as Doc;
      return { id: String(d._id), passportNumber: d.passportNumber, n: g.n, name: d.name, article: d.article ?? '', category: d.category ?? '', productId: d.productId ? String(d.productId) : null,
        ...Object.fromEntries(MODEL_FIELDS.filter((f) => !['productId', 'name', 'category', 'article'].includes(f)).map((f) => [f, d[f] ?? null])),
        images: d.images ?? [] };
    });
    await this.attachThumbs(items);
    return items;
  }

  private filterOf(q: Record<string, unknown>, deleted = false): Doc {
    const f: Doc = { deletedAt: deleted ? { $ne: null } : null };
    // НМ: статус — черновик / выпущен (в т. ч. старые без статуса) / аннулирован
    if (q.status === 'draft' || q.status === 'annulled') f.status = q.status;
    else if (q.status === 'issued') f.$or = [{ status: 'issued' }, { status: { $exists: false }, passportNumber: { $nin: [null, ''] } }];
    const year = Number(q.year), month = Number(q.month);
    if (year) {
      const from = new Date(Date.UTC(year, month ? month - 1 : 0, 1));
      const to = new Date(Date.UTC(month ? year : year + 1, month ? month : 0, 1));
      f.date = { $gte: from, $lt: to };
    }
    if (q.category) f.category = String(q.category);
    if (q.supplierOrgId) f.supplierOrgId = this.oid(q.supplierOrgId);
    if (q.customer) f.customerName = new RegExp(`^${escapeRe(String(q.customer))}$`, 'i');
    if (q.productId) f.productId = this.oid(q.productId);
    if (q.noImages === '1' || q.noImages === 'true') f['images.0'] = { $exists: false };
    return f;
  }

  /** Значения для фильтров: годы, категории, поставщики, заказчики. */
  async facets() {
    const [years, categories, customers, suppliers] = await Promise.all([
      this.model.aggregate([{ $match: { deletedAt: null, date: { $type: 'date' } } }, { $group: { _id: { $year: '$date' }, n: { $sum: 1 } } }, { $sort: { _id: -1 } }]).exec(),
      this.model.aggregate([{ $match: { deletedAt: null, category: { $nin: [null, ''] } } }, { $group: { _id: '$category', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).exec(),
      this.model.aggregate([{ $match: { deletedAt: null, customerName: { $nin: [null, ''] } } }, { $group: { _id: '$customerName', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).exec(),
      this.model.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$supplierOrgId', name: { $first: '$supplier' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]).exec(),
    ]);
    const orgs = await this.connection.collection('organizations').find({ _id: { $in: suppliers.map((s) => s._id).filter(Boolean) } }, { projection: { name: 1, shortName: 1 } }).toArray();
    const orgName = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    return {
      years: years.map((y) => ({ value: y._id, n: y.n })),
      categories: categories.map((c) => ({ value: c._id, n: c.n })),
      customers: customers.map((c) => ({ value: c._id, n: c.n })),
      suppliers: suppliers.filter((s) => s._id).map((s) => ({ value: String(s._id), label: orgName.get(String(s._id)) || s.name || '—', n: s.n })),
    };
  }

  // ─── карточка ────────────────────────────────────────────────────────────────────────────────────
  async findById(id: string): Promise<ProductPassportDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Паспорт ${id} не найден`);
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Паспорт ${id} не найден`);
    return doc;
  }

  /** Карточка: паспорт + чего не хватает + поставщик (для печати/подписи) + картинки с адресами. */
  async get(id: string) {
    const doc = (await this.findById(id)).toObject() as unknown as Doc;
    const photoIds = ((doc.images as Array<{ photoId: Types.ObjectId }>) || []).map((i) => i.photoId);
    const photos = photoIds.length ? await this.connection.collection('photos').find({ _id: { $in: photoIds } }, { projection: { storageUrl: 1, thumbId: 1 } }).toArray() : [];
    const url = new Map(photos.map((p) => [String(p._id), p.storageUrl as string]));
    const images = ((doc.images as Array<Doc>) || []).map((i) => ({ ...i, url: url.get(String(i.photoId)) ?? null }));
    const supplierOrg = doc.supplierOrgId ? await this.connection.collection('organizations').findOne({ _id: doc.supplierOrgId as Types.ObjectId }, { projection: { name: 1, shortName: 1, assets: 1 } }) : null;
    const cat = doc.passportCategory ? (await this.categoryRules()).get(String(doc.passportCategory)) : null;
    // v2: предупреждения по нормативам из снимка (статус не «действует», проверка старше года)
    const used = ((doc.textSnapshot as { standards?: string[] } | undefined)?.standards) ?? [];
    const standardWarningsList = used.length ? standardWarnings(used, (await this.standards()).docs) : [];
    const std = doc.passportCategory ? standardSchemes(doc as never, (await this.installs()).get(String(doc.installationTypeId ?? '')) ?? null) : [];
    const stdPhotos = std.length ? await this.connection.collection('photos').find({ _id: { $in: std.map((x) => new Types.ObjectId(x.photoId)) } }, { projection: { storageUrl: 1 } }).toArray() : [];
    const stdUrl = new Map(stdPhotos.map((x) => [String(x._id), x.storageUrl as string]));
    const standardImages = std.map((x) => ({ ...x, url: stdUrl.get(x.photoId) ?? null }));
    // обязательные виды картинок (для сортировки в карточке и форме): safety_zone = safety (v1)
    const requiredImages = requiredImageKinds(doc as never, cat).map((k) => (k === 'safety_zone' ? 'safety' : k));
    return { ...doc, images, standardImages, requiredImages, missing: missingFieldsV2({ ...doc, images: [...images, ...std] } as never, cat), ...(standardWarningsList.length ? { standardWarnings: standardWarningsList } : {}), supplierOrg: supplierOrg ? { id: String(supplierOrg._id), name: supplierOrg.name, hasSeal: (supplierOrg.assets || []).some((a: Doc) => a.role === 'seal'), hasSignature: (supplierOrg.assets || []).some((a: Doc) => a.role === 'signature') } : null };
  }

  /** Совместимость с kppdf: последний паспорт изделия-модели. */
  async findByProductId(productId: string): Promise<ProductPassportDocument> {
    const doc = Types.ObjectId.isValid(productId) ? await this.model.findOne({ productId: new Types.ObjectId(productId) }).sort({ createdAt: -1 }).exec() : null;
    if (!doc) throw new NotFoundException(`Паспорт изделия ${productId} не найден`);
    return doc;
  }

  // ─── номера (ПС.2) ───────────────────────────────────────────────────────────────────────────────
  private counters(): CounterColl {
    return this.connection.collection('counters') as unknown as CounterColl;
  }

  /** Максимум числового поля среди паспортов (включая удалённые — номер не переиспользуется). */
  private async maxOf(field: 'passportNumber' | 'productCode', session?: ClientSession): Promise<number> {
    const agg = this.model.aggregate([
      { $project: { n: { $convert: { input: `$${field}`, to: 'int', onError: null, onNull: null } } } },
      { $group: { _id: null, max: { $max: '$n' } } },
    ]).option({ includeSoftDeleted: true });
    if (session) agg.session(session);
    const [r] = await agg.exec();
    return Number(r?.max) || 0;
  }

  /** Недостающие номера: № паспорта и номер изделия — из счётчиков (атомарно, после занятых), талон — из даты и №. */
  async allocate(set: Doc, date: Date, session?: ClientSession) {
    if (!set.passportNumber) {
      const no = await nextSeq(this.counters(), 'passportNumber', await this.maxOf('passportNumber', session), session);
      Object.assign(set, { passportNumber: String(no), passportNo: no });
    }
    if (!set.productCode) set.productCode = String(await nextSeq(this.counters(), 'productCode', await this.maxOf('productCode', session), session));
    if (!set.warrantyCode) set.warrantyCode = warrantyCodeFor(date, String(set.passportNumber));
  }

  private async assertFree(set: Doc, selfId?: Types.ObjectId, session?: ClientSession) {
    const not = selfId ? { _id: { $ne: selfId } } : {};
    for (const [f, label] of [['passportNumber', 'Паспорт №'], ['productCode', 'Номер изделия'], ['warrantyCode', 'Гарантийный талон']] as const) {
      if (!set[f]) continue;
      const extra = f === 'productCode' ? { productCodeDuplicate: { $ne: true } } : {};
      const q = this.model.findOne({ [f]: set[f], ...extra, ...not }).setOptions({ includeSoftDeleted: true }).select('passportNumber').lean();
      if (session) q.session(session);
      const twin = await q.exec();
      if (twin) throw new ConflictException(`${label} ${set[f]} уже занят (паспорт № ${twin.passportNumber})`);
    }
  }

  private normalize(dto: Partial<CreateProductPassportDto>): Doc {
    const set: Doc = { ...dto };
    delete set.confirmNumbers;
    for (const f of OID_FIELDS) if (f in set) set[f] = set[f] ? this.oid(set[f]) : null;
    if ('date' in set) set.date = set.date ? new Date(String(set.date)) : null;
    for (const k of ['saleDate', 'installedAt'] as const) if (k in set) set[k] = set[k] ? new Date(String(set[k])) : null;
    // картинка без вида — только «Фото изделия» (ФП: раньше без вида не попадала никуда)
    if (set.images) set.images = (set.images as Array<Doc>).map((i, k) => ({ kind: i.kind || 'overview', photoId: this.oid(i.photoId), order: i.order ?? k, ...(i.caption ? { caption: i.caption } : {}), ...(i.refCode ? { refCode: i.refCode } : {}) }));
    for (const f of ['elements', 'materialIds'] as const) if (Array.isArray(set[f])) set[f] = (set[f] as unknown[]).map((x) => this.oid(x));
    if (set.passportNumber !== undefined) set.passportNo = Number(set.passportNumber) || undefined;
    return set;
  }

  /** Новый паспорт: номера выдаёт сервер (если не заданы явно), описание собирается из частей, комплектность по умолчанию. */
  async create(dto: CreateProductPassportDto): Promise<ProductPassportDocument> {
    const set = this.normalize(dto);
    const date = (set.date as Date) || dayUtc();
    set.date = date;
    // НМ: новый паспорт — черновик без номера, талона и номера изделия; номер передан явно (перенос) — сразу выпущен
    if (set.passportNumber) { await this.allocate(set, date); set.status = 'issued'; set.issuedAt = new Date(); set.revision = 1; }
    else { for (const f of ['passportNo', 'productCode', 'warrantyCode'] as const) delete set[f]; set._id = new Types.ObjectId(); set.passportNumber = DRAFT_PREFIX + String(set._id); set.status = 'draft'; }
    if (!set.description) set.description = buildDescription(set as never) || undefined;
    if (!set.bom) set.bom = DEFAULT_BOM;
    set.source = set.source || 'app';
    await this.assertFree(set);
    try {
      const doc = await this.model.create(set);
      // v2: паспорт с категорией — сразу снимок текста (правка справочников потом его не меняет)
      if (set.passportCategory) return (await this.snapshot(String(doc._id))) ?? doc;
      return doc;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('Номер уже занят другим паспортом — повторите создание');
      throw e;
    }
  }

  /** Копия на ту же модель: поля модели и картинки, новые номера, дата — сегодня, заказчик — пустой. */
  async copy(id: string, over: Partial<CreateProductPassportDto> = {}) {
    const src = (await this.findById(id)).toObject() as unknown as Doc;
    const dto: Doc = {};
    for (const f of MODEL_FIELDS) if (src[f] !== undefined && src[f] !== null) dto[f] = src[f];
    dto.images = ((src.images as Array<Doc>) || []).map((i) => ({ kind: i.kind || 'overview', photoId: String(i.photoId), order: i.order, caption: i.caption }));
    for (const f of OID_FIELDS) if (dto[f]) dto[f] = String(dto[f]);
    return this.create({ ...(dto as unknown as CreateProductPassportDto), ...over });
  }

  async update(id: string, dto: UpdateProductPassportDto, opts: { newRevision?: boolean; user?: { id?: string; role?: string; isOwner?: boolean } } = {}): Promise<ProductPassportDocument> {
    const doc = await this.findById(id);
    const cur = doc.toObject() as unknown as Doc;
    if (cur.status === 'annulled') throw new ConflictException('Паспорт аннулирован — изменить его нельзя');
    const set = this.normalize(dto);
    const issued = isIssued(cur);
    if (!issued) { for (const f of ['passportNumber', 'passportNo', 'productCode', 'warrantyCode'] as const) delete set[f]; } // у черновика номеров нет
    const touched = NUMBER_FIELDS.filter((f) => f in set && String(set[f] ?? '') !== String(cur[f] ?? ''));
    if (issued && touched.length) {
      if (!dto.confirmNumbers) throw new ConflictException(`Номер, талон и дата выданного паспорта меняются только с подтверждением (confirmNumbers): ${touched.join(', ')}`);
      if (!(opts.user?.isOwner || opts.user?.role === 'admin')) throw new ForbiddenException('Номер выпущенного паспорта меняет только администратор');
    }
    // НМ-1: выпущенный — свободно только «после печати»; остальное — «Новая редакция» (номер тот же, редакция +1, прежняя — в истории)
    const changed = Object.keys(set).filter((k) => k !== 'passportNo' && JSON.stringify(set[k] ?? null) !== JSON.stringify(cur[k] ?? null) && !(String(set[k] ?? '') === '' && (cur[k] === undefined || cur[k] === null)));
    const locked = changed.filter((k) => !(AFTER_PRINT_FIELDS as readonly string[]).includes(k) && !(NUMBER_FIELDS as readonly string[]).includes(k) && k !== 'manualText');
    if (issued && locked.length && !opts.newRevision) throw new ConflictException(`Паспорт выпущен: свободно меняются только поля «после печати». Чтобы изменить остальное (${locked.length}), используйте «Новая редакция»`);
    if (issued && opts.newRevision && locked.length) {
      const keep = Object.fromEntries([...locked, 'textSnapshot', 'images'].map((k) => [k, cur[k] ?? null]));
      set.revisions = [...((cur.revisions as unknown[]) ?? []), { revision: cur.revision ?? 1, at: new Date(), by: opts.user?.id ?? null, data: keep }];
      set.revision = Number(cur.revision ?? 1) + 1;
    }
    await this.assertFree(set, doc._id);
    const hadText = !!((doc.toObject() as unknown as Doc).textSnapshot as { sections?: unknown[] } | undefined)?.sections?.length;
    doc.set(set);
    const saved = await doc.save();
    // НМ: новая редакция — текст заново по справочникам и снова заморожен; черновику с категорией текст собирается при выпуске
    if (set.revision && saved.passportCategory) return (await this.snapshot(String(saved._id))) ?? saved;
    // паспорту без текста выбрали категорию — собрать текст сразу (как при создании); готовый текст не трогаем — «Обновить текст по справочникам»
    if (set.passportCategory && !hadText) return (await this.snapshot(String(saved._id))) ?? saved;
    return saved;
  }

  /**
   * Массовое изменение выбранных паспортов (БЗ-9): только общие поля (белый список), номера / талоны / названия — нет.
   * arrays: elements / materialIds — 'add' (добавить к своим) или 'replace'. Смена категории — текст паспорта пересобирается
   * по новой категории (rebuildText, по умолчанию да). Возвращает before — прежние значения для «Отменить» (bulkRestore).
   */
  async bulk(dto: { ids?: unknown; set?: Record<string, unknown>; arrays?: Record<string, string>; rebuildText?: boolean }) {
    const ids = Array.isArray(dto.ids) ? [...new Set(dto.ids.map(String))] : [];
    if (!ids.length) throw new BadRequestException('Отметьте паспорта');
    if (ids.length > 500) throw new BadRequestException('За один раз — не больше 500 паспортов');
    const set = Object.fromEntries(Object.entries(dto.set ?? {}).filter(([k]) => (BULK_PASSPORT_FIELDS as readonly string[]).includes(k)));
    if (!Object.keys(set).length) throw new BadRequestException('Отметьте, что изменить');
    if (set.passportCategory !== undefined && set.passportCategory !== '' && !['DIO', 'DSP', 'TRN', 'WRK', 'MAF'].includes(String(set.passportCategory))) throw new BadRequestException('Неизвестная категория паспорта');
    for (const k of BULK_NUMBER_FIELDS) if (k in set && set[k] !== null && set[k] !== '') { const n = Number(String(set[k]).replace(',', '.')); if (!Number.isFinite(n) || n < 0) throw new BadRequestException('Числа — не меньше нуля'); set[k] = n; }
    for (const k of ['elements', 'materialIds'] as const) if (k in set && !Array.isArray(set[k])) throw new BadRequestException('Элементы и материалы — список');
    const rebuild = dto.rebuildText !== false && 'passportCategory' in set;
    const before: Array<{ id: string; set: Record<string, unknown> }> = [];
    const failed: Array<{ id: string; message: string }> = [];
    let updated = 0;
    for (const id of ids) {
      try {
        const doc = (await this.findById(id)).toObject() as unknown as Doc;
        const patch: Record<string, unknown> = { ...set };
        // НМ: выпущенный паспорт массово меняется только в полях «после печати»; аннулированный — никак
        if (doc.status === 'annulled') throw new ConflictException(`№ ${doc.passportNumber}: аннулирован`);
        const lockedKeys = Object.keys(patch).filter((k) => !(AFTER_PRINT_FIELDS as readonly string[]).includes(k));
        if (isIssued(doc) && lockedKeys.length) throw new ConflictException(`№ ${doc.passportNumber}: выпущен — массово меняются только поля «после печати»`);
        for (const k of ['elements', 'materialIds'] as const) {
          if (k in patch && dto.arrays?.[k] === 'add') patch[k] = [...new Set([...((doc[k] as unknown[]) ?? []).map(String), ...(patch[k] as unknown[]).map(String)])];
        }
        const prev: Record<string, unknown> = Object.fromEntries(Object.keys(patch).map((k) => [k, doc[k] ?? null]));
        if (rebuild) prev.textSnapshot = doc.textSnapshot ?? null;
        await this.update(id, patch as never);
        if (rebuild) await this.snapshot(id);
        before.push({ id, set: prev });
        updated++;
      } catch (e) { failed.push({ id, message: e instanceof Error ? e.message : String(e) }); }
    }
    return { updated, failed, before };
  }

  /** «Отменить» массовое изменение (БЗ-9): вернуть прежние значения полей (в т. ч. текст паспорта) как были. */
  async bulkRestore(dto: { items?: Array<{ id?: string; set?: Record<string, unknown> }> }) {
    const items = Array.isArray(dto.items) ? dto.items : [];
    let restored = 0;
    for (const it of items) {
      if (!it?.id || !Types.ObjectId.isValid(it.id)) continue;
      const raw = Object.fromEntries(Object.entries(it.set ?? {}).filter(([k]) => (BULK_PASSPORT_FIELDS as readonly string[]).includes(k) || k === 'textSnapshot'));
      const $set: Record<string, unknown> = {}; const $unset: Record<string, ''> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v === null || v === undefined) { $unset[k] = ''; continue; }
        if ((OID_FIELDS as readonly string[]).includes(k)) $set[k] = this.oid(v);
        else if (k === 'elements' || k === 'materialIds') $set[k] = (v as unknown[]).map((x) => this.oid(x));
        else if (k === 'saleDate' || k === 'installedAt') $set[k] = new Date(String(v));
        else $set[k] = v;
      }
      const r = await this.model.updateOne({ _id: this.oid(it.id) }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) }).exec();
      restored += r.modifiedCount;
    }
    return { restored };
  }

  async markIssued(id: Types.ObjectId | string) {
    await this.model.updateOne({ _id: new Types.ObjectId(String(id)) }, { $set: { pdfIssuedAt: new Date() } }).exec();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    if (isIssued(doc.toObject() as unknown as Doc) || doc.status === 'annulled') throw new ConflictException('Выпущенный паспорт не удаляется — «Аннулировать» (номер останется занятым)');
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } }).exec();
  }

  async restore(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Паспорт ${id} не найден`);
    const r = await this.model.updateOne({ _id: new Types.ObjectId(id), deletedAt: { $ne: null } }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    if (!r.matchedCount) throw new NotFoundException(`Паспорт ${id} не найден в корзине`);
    return this.findById(id);
  }

  // ─── шаблон (ПС.1) ───────────────────────────────────────────────────────────────────────────────
  /** Активная версия именно этой категории (для «Для всех» — в т.ч. без поля category). */
  private ownDoc(category: PassportCategory) {
    const filter = category === 'ALL' ? { isActive: true, category: { $in: [null, 'ALL'] } } : { isActive: true, category };
    return this.templates.findOne(filter).sort({ version: -1 }).lean().exec();
  }

  /** Действующий шаблон категории; своей нет — «Для всех»; в базе пусто — встроенный (версия 0, по образцу №549). */
  async template(category?: string): Promise<PassportTemplateContent & { version: number; id?: string; updatedAt?: Date; category: PassportCategory }> {
    const cat = normalizeCategory(category);
    const t = (await this.ownDoc(cat)) ?? (cat === 'ALL' ? null : await this.ownDoc('ALL'));
    if (!t) return { version: 0, category: 'ALL', ...DEFAULT_PASSPORT_TEMPLATE };
    return { version: t.version, category: normalizeCategory(t.category), id: String(t._id), sections: t.sections, tables: t.tables, updatedAt: (t as unknown as { updatedAt?: Date }).updatedAt };
  }

  /**
   * Снимок текста паспорта v2 (БЗ-6 Э4a3): шаблон «Для всех» + версия категории + части из справочников → `textSnapshot`.
   * Вызывается при создании паспорта с категорией и по кнопке «Обновить текст по справочникам». Паспорт v1 — не трогаем.
   */
  /** Правка пункта текста только для этого паспорта (Э5a3): меняется снимок, справочники — нет. */
  async editSnapshotItem(id: string, b: { sectionKey?: string; itemKey?: string; text?: string }) {
    const doc = await this.findById(id);
    const snap = (doc.toObject() as unknown as Doc).textSnapshot as { sections?: SnapshotSection[] } | undefined;
    if (!snap?.sections) throw new BadRequestException('У паспорта нет собранного текста — выберите категорию в «Изменить»');
    doc.set('textSnapshot', { ...snap, sections: editSnapshotItem(snap.sections, String(b.sectionKey ?? ''), String(b.itemKey ?? ''), String(b.text ?? '')), editedAt: new Date() });
    return doc.save();
  }

  /** «Перенести правку в справочник» (Э5a4): пункт из снимка → новая версия шаблона категории паспорта. */
  async promoteSnapshotItem(id: string, b: { sectionKey?: string; itemKey?: string }, userId?: string) {
    const p = (await this.findById(id)).toObject() as unknown as Doc;
    const cat = String(p.passportCategory || '');
    const sec = ((p.textSnapshot as { sections?: SnapshotSection[] } | undefined)?.sections ?? []).find((s) => s.key === b.sectionKey);
    const item = sec?.items.find((i) => i.key === b.itemKey);
    if (!cat || !item) throw new BadRequestException('Пункт не найден в тексте паспорта');
    const { own: dbOwn } = await this.templatesFor(cat);
    const code = PASSPORT_TEXTS_V2[cat as keyof typeof PASSPORT_TEXTS_V2];
    const own = dbOwn ?? code ?? null;
    const sections = promoteToOwn(own?.sections as never, (await this.v2All()).sections as never, String(b.sectionKey), String(b.itemKey), item.text);
    return this.saveTemplate({ category: cat, sections: sections as never, tables: (own?.tables ?? []) as never }, userId);
  }

  async snapshot(id: string): Promise<ProductPassportDocument | null> {
    const doc = await this.findById(id);
    const p = doc.toObject() as unknown as Doc;
    if (!p.passportCategory) return null;
    // v2: общая часть — тексты v2 из кода (шаблон «Для всех» в базе остаётся для PDF v1); версия категории — из базы, иначе из кода
    const cat = String(p.passportCategory);
    const { own: dbOwn } = await this.templatesFor(cat);
    const all = await this.v2All();
    const code = PASSPORT_TEXTS_V2[cat as keyof typeof PASSPORT_TEXTS_V2];
    const own = dbOwn ?? (code ? { ...code, version: 0 } : null);
    const { dict: standards } = await this.standards();
    const dv = this.connection.collection('dict_values');
    const load = (d: string) => dv.find({ dict: d, deletedAt: null }).toArray() as unknown as Promise<DictRec[]>;
    const [elements, materials, defects, install] = await Promise.all([load('passportElements'), load('passportMaterials'), load('passportDefects'), load('passportInstall')]);
    const text = buildV2Text({ passport: p, all, own, standards, dicts: { elements, materials, defects, install } });
    doc.set('textSnapshot', { ...text, at: new Date() });
    return doc.save();
  }

  /**
   * Проверка черновика формы (ФП): чего не хватает для выпуска — те же правила, что у сохранённого паспорта
   * (категория, справочник, стандартные схемы способа установки). Ничего не пишет.
   */
  async check(body: Record<string, unknown>) {
    const numOr = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(String(v).replace(',', '.')));
    const p: Doc = { ...body };
    for (const k of ['height', 'length', 'width', 'weight', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears']) p[k] = numOr(p[k]);
    p.images = ((p.images as Array<Doc>) || []).map((i) => ({ kind: i.kind || 'overview', photoId: String(i.photoId ?? '') }));
    p.isKit = p.isKit === true || p.isKit === 'yes';
    const [cats, inst] = await Promise.all([this.categoryRules(), this.installs()]);
    const cat = cats.get(String(p.passportCategory ?? '')) ?? null;
    const full = this.withSchemes(p, inst);
    return { missing: missingKeyed(full as never, cat), requiredImages: requiredImageKinds(p as never, cat).map((k) => (k === 'safety_zone' ? 'safety' : k)) };
  }

  /**
   * НМ: выпуск — последний шаг. Проверка обязательного; текст собирается по справочникам и замораживается; номер паспорта,
   * номер изделия и талон — из счётчиков в ОДНОЙ транзакции со сменой статуса: повтор / двойной клик — тот же номер.
   */
  async issue(id: string) {
    const first = (await this.findById(id)).toObject() as unknown as Doc;
    if (isIssued(first)) return this.findById(id);
    if (first.status === 'annulled') throw new ConflictException('Паспорт аннулирован — выпустить нельзя');
    const missing = await this.readiness(first);
    if (missing.length) throw new BadRequestException({ message: `Не хватает для выпуска: ${missing.map((m) => m.label).join(', ')}`, missing });
    if (first.passportCategory) await this.snapshot(id); // текст по справочникам на момент выпуска
    const _id = new Types.ObjectId(id);
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const draft = await this.model.findOne({ _id, status: 'draft' }).session(session).lean().exec();
        if (!draft) return; // уже выпущен параллельным запросом
        const set: Doc = {};
        await this.allocate(set, (draft.date as Date) || dayUtc(), session);
        await this.assertFree(set, _id, session);
        await this.model.updateOne({ _id, status: 'draft' }, { $set: { ...set, status: 'issued', issuedAt: new Date(), revision: 1 } }, { session }).exec();
      });
    } finally { await session.endSession(); }
    return this.findById(id);
  }

  /** НМ: аннулирование выпущенного — причина обязательна; номер остаётся занятым, повторно не выдаётся. */
  async annul(id: string, reason: unknown) {
    const r = String(reason ?? '').trim();
    if (!r) throw new BadRequestException('Укажите причину аннулирования');
    const doc = (await this.findById(id)).toObject() as unknown as Doc;
    if (!isIssued(doc)) throw new ConflictException(doc.status === 'annulled' ? 'Паспорт уже аннулирован' : 'Черновик не аннулируют — его можно удалить');
    await this.model.updateOne({ _id: doc._id }, { $set: { status: 'annulled', annulledAt: new Date(), annulReason: r } }).exec();
    return this.findById(id);
  }

  /**
   * НМ-2: «тот же изделие» — та же запись «Продукции»; дубль — её черновик, или выпущенный на тот же заказ / покупателя / адрес.
   */
  async duplicates(q: Record<string, unknown>) {
    if (!q.productId || !Types.ObjectId.isValid(String(q.productId))) return { items: [] };
    const productId = new Types.ObjectId(String(q.productId));
    const same: Doc[] = [];
    const s = (v: unknown) => String(v ?? '').trim();
    if (s(q.orderNo)) same.push({ orderNo: s(q.orderNo) });
    if (s(q.customer)) same.push({ customerName: new RegExp(`^\\s*${escapeRe(s(q.customer))}\\s*$`, 'i') });
    if (s(q.objectName)) same.push({ objectName: new RegExp(`^\\s*${escapeRe(s(q.objectName))}\\s*$`, 'i') });
    const docs = await this.model.find({ productId, deletedAt: null, ...(q.exceptId && Types.ObjectId.isValid(String(q.exceptId)) ? { _id: { $ne: new Types.ObjectId(String(q.exceptId)) } } : {}),
      $or: [{ status: 'draft' }, ...(same.length ? [{ status: { $ne: 'draft' }, $or: same }] : [])] }, { passportNumber: 1, status: 1, name: 1, customerName: 1, orderNo: 1, objectName: 1, date: 1 }).sort({ createdAt: -1 }).limit(10).lean().exec();
    return { items: docs.map((d) => ({ id: String(d._id), passportNumber: d.passportNumber && !isDraftNumber(d.passportNumber) ? d.passportNumber : null, status: d.status ?? 'issued', name: d.name, customerName: d.customerName ?? null, orderNo: d.orderNo ?? null, objectName: d.objectName ?? null, date: d.date ?? null })) };
  }

  /** ПП: чего не хватает для выпуска сохранённого паспорта — [{ label, key }] (стандартные схемы способа установки засчитываются). */
  async readiness(doc: Doc): Promise<Array<{ label: string; key: string }>> {
    const [cats, inst] = await Promise.all([this.categoryRules(), this.installs()]);
    return missingKeyed(this.withSchemes(doc, inst) as never, cats.get(String(doc.passportCategory ?? '')) ?? null);
  }

  /** Способы установки (справочник) по id — для стандартных схем узлов (Э9.5). */
  async installs() {
    const docs = await this.connection.collection('dict_values').find({ dict: 'passportInstall', deletedAt: null }).toArray();
    return new Map(docs.map((d) => [String(d._id), d as Record<string, unknown>]));
  }

  private withSchemes(d: Doc, inst: Map<string, Record<string, unknown>>) {
    if (!d.passportCategory) return d;
    const std = standardSchemes(d as never, inst.get(String(d.installationTypeId ?? '')) ?? null);
    return std.length ? { ...d, images: [...((d.images as unknown[]) || []), ...std] } : d;
  }

  /** Справочник категорий паспортов (v2): код → обязательные рисунки и прочее. Пусто — паспорта v1 проверяются как раньше. */
  async categoryRules() {
    const docs = await this.connection.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1, requiredImages: 1, requiredFields: 1, serviceLifeYears: 1, warrantyMonths: 1, standards: 1 } }).toArray();
    return new Map(docs.map((d) => [String(d.code), d as { requiredImages?: string; requiredFields?: string; serviceLifeYears?: string; warrantyMonths?: string; standards?: string }]));
  }

  /** Нормативы для {std:КОД} (справочник «Паспорта → Нормативы», dict_values) — словарь и записи для предупреждений. */
  async standards() {
    const docs = (await this.connection.collection('dict_values').find({ dict: 'passportStandards', deletedAt: null }, { projection: { code: 1, name: 1, status: 1, checkedAt: 1 } }).toArray()) as StandardDoc[];
    return { dict: standardsDict(docs), docs };
  }

  /** Для сборщика текста: версия «Для всех» и версия категории (null, если своей нет). */
  async templatesFor(category?: string) {
    const cat = normalizeCategory(category);
    const all = await this.template('ALL');
    const own = cat === 'ALL' ? null : await this.ownDoc(cat);
    return { all, own: own ? { version: own.version, category: cat, id: String(own._id), sections: own.sections, tables: own.tables } : null };
  }

  /** Правка шаблона — новая версия в пределах категории, прежняя остаётся в истории. */
  async saveTemplate(body: Partial<PassportTemplateContent> & { category?: string }, userId?: string) {
    const cat = normalizeCategory(body.category);
    const base = await this.template(cat); // содержимое по умолчанию — действующее (для категории без версии — «Для всех»)
    const own = await this.ownDoc(cat);
    const sections = body.sections ?? base.sections, tables = body.tables ?? base.tables;
    if (!Array.isArray(sections) || !sections.every((s) => s && typeof s.title === 'string' && Array.isArray(s.paragraphs))) throw new BadRequestException('Тексты: ожидается список разделов sections: [{ key, title, paragraphs[] }]');
    const same = cat === 'ALL' ? { category: { $in: [null, 'ALL'] } } : { category: cat };
    await this.templates.updateMany({ isActive: true, ...same }, { $set: { isActive: false } }).exec();
    await this.templates.create({ version: (own?.version ?? 0) + 1, isActive: true, ...(cat === 'ALL' ? {} : { category: cat }), sections, tables, ...(userId && Types.ObjectId.isValid(userId) ? { updatedBy: new Types.ObjectId(userId) } : {}) });
    return this.template(cat);
  }

  // ─── «Справочники → Паспорта → Разделы и тексты» (БЗ-6 Э2d) ─────────────────────────────────────
  /** Версия категории для v2: из базы (source 'db'), иначе тексты категории из кода ('code'), для ALL — null. */
  private async v2Own(cat: PassportCategory) {
    if (cat === 'ALL') return { own: null, source: null as 'db' | 'code' | null };
    const db = await this.ownDoc(cat);
    if (db) return { own: { version: db.version, sections: db.sections, tables: db.tables ?? [], updatedAt: (db as unknown as { updatedAt?: Date }).updatedAt }, source: 'db' as const };
    const code = PASSPORT_TEXTS_V2[cat];
    return { own: code ? { version: 0, sections: code.sections, tables: code.tables ?? [] } : null, source: code ? ('code' as const) : null };
  }

  /**
   * Общая часть «Для всех» v2 (Э9.4): своя версия в `passporttemplates` с category `ALL_V2` (шаблон «Для всех» PDF v1 —
   * category пусто/ALL — не трогается), иначе — тексты из кода (`scripts/passport-texts.v2.json`).
   */
  private async v2All() {
    const db = await this.templates.findOne({ isActive: true, category: ALL_V2 }).sort({ version: -1 }).lean().exec();
    if (db) return { version: db.version, sections: db.sections, tables: db.tables ?? [], source: 'db' as const };
    return { ...PASSPORT_TEXTS_V2.ALL, version: 0, source: 'code' as const };
  }

  /** Тексты v2 категории: общая часть + своя версия + дерево «общий / категории / заменяет». ALL — общая часть как «своя» (правится). */
  async texts(category?: string) {
    const cat = normalizeCategory(category);
    const allV2 = await this.v2All();
    if (cat === 'ALL') {
      const own = { version: allV2.version, sections: allV2.sections, tables: allV2.tables };
      return { category: cat, all: { sections: [], tables: [] }, own, source: allV2.source, version: allV2.version, tree: textsTree({ sections: [] } as never, own) };
    }
    const all = allV2;
    const { own, source } = await this.v2Own(cat);
    return { category: cat, all, own, source, version: own?.version ?? null, tree: textsTree(all, own) };
  }

  /** Предпросмотр без сохранения: сборка на пустом паспорте категории (незаполненные переменные — видимыми метками). */
  async textsPreview(body: { category?: string; own?: PassportTemplateContent['sections'] | null }) {
    const cat = normalizeCategory(body?.category);
    if (body?.own != null && (!Array.isArray(body.own) || !body.own.every((s) => s && typeof s.key === 'string' && Array.isArray(s.paragraphs)))) throw new BadRequestException('Тексты: ожидается список разделов own: [{ key, title, paragraphs[] }]');
    const saved = (await this.v2Own(cat)).own;
    const own = cat === 'ALL' ? null : body?.own ? { version: saved?.version ?? 0, sections: body.own } : saved;
    const allV2 = await this.v2All();
    const all = cat === 'ALL' && body?.own ? { ...allV2, sections: body.own } : allV2;
    const { dict: standards } = await this.standards();
    const text = buildV2Text({ passport: { passportCategory: cat === 'ALL' ? '' : cat }, all, own, standards });
    return { ...text, category: cat, tree: textsTree(all, own) };
  }

  /** Запись версии категории из редактора текстов. ALL — общая часть v2 (category ALL_V2); шаблон «Для всех» PDF v1 не трогается. */
  async saveTexts(body: { category?: string; sections?: PassportTemplateContent['sections'] }, userId?: string) {
    const cat = normalizeCategory(body?.category);
    if (!Array.isArray(body.sections)) throw new BadRequestException('Тексты: ожидается список разделов sections: [{ key, title, paragraphs[] }]');
    const sections = body.sections.map((s) => ({ key: String(s?.key || ''), title: String(s?.title ?? ''), paragraphs: Array.isArray(s?.paragraphs) ? s.paragraphs.map((p) => String(p ?? '').trim()).filter(Boolean) : [] }));
    if (sections.some((s) => !s.key)) throw new BadRequestException('У раздела нет ключа (key)');
    if (cat === 'ALL') {
      const cur = await this.v2All();
      const last = await this.templates.findOne({ category: ALL_V2 }).sort({ version: -1 }).lean().exec();
      await this.templates.updateMany({ isActive: true, category: ALL_V2 }, { $set: { isActive: false } }).exec();
      await this.templates.create({ version: (last?.version ?? 0) + 1, isActive: true, category: ALL_V2, sections, tables: cur.tables, ...(userId && Types.ObjectId.isValid(userId) ? { updatedBy: new Types.ObjectId(userId) } : {}) });
      return this.texts(cat);
    }
    const { own } = await this.v2Own(cat);
    await this.saveTemplate({ category: cat, sections, tables: (own?.tables as PassportTemplateContent['tables']) ?? [] }, userId);
    return this.texts(cat);
  }

  private oid(v: unknown): Types.ObjectId {
    const s = String(v);
    if (!Types.ObjectId.isValid(s)) throw new BadRequestException(`Неверный id: ${s}`);
    return new Types.ObjectId(s);
  }
}
