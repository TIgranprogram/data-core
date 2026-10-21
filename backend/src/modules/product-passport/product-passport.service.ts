import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { parseList } from '../../common/list-query';
import { ProductPassport, ProductPassportDocument } from './product-passport.schema';
import { PassportTemplate, PassportTemplateDocument } from './passport-template.schema';
import { DEFAULT_PASSPORT_TEMPLATE, type PassportTemplateContent } from './passport-template.default';
import { CreateProductPassportDto } from './dto/create-product-passport.dto';
import { UpdateProductPassportDto } from './dto/update-product-passport.dto';
import { DEFAULT_BOM, buildDescription, dayUtc, missingFields, nextSeq, warrantyCodeFor, type CounterColl } from './passport-rules';

type Doc = Record<string, unknown>;
const SORT = ['passportNo', 'date', 'name', 'category', 'customerName', 'createdAt', 'updatedAt'];
/** Поля модели — переходят в копию паспорта и подставляются из выбранной модели (ПС.5). */
export const MODEL_FIELDS = ['productId', 'name', 'category', 'article', 'height', 'length', 'width', 'weight', 'materials', 'purpose', 'installationMethod', 'description', 'supplierOrgId', 'supplier', 'warrantyMonths', 'bom'] as const;
/** Выданные номера: без `confirmNumbers: true` не меняются (ПС, «не менять молча»). */
const NUMBER_FIELDS = ['passportNumber', 'productCode', 'warrantyCode', 'date'] as const;
const OID_FIELDS = ['productId', 'customerOrgId', 'salesOrderId', 'supplierOrgId'] as const;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class ProductPassportService {
  constructor(
    @InjectModel(ProductPassport.name) private readonly model: Model<ProductPassportDocument>,
    @InjectModel(PassportTemplate.name) private readonly templates: Model<PassportTemplateDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ─── список ──────────────────────────────────────────────────────────────────────────────────────
  /** Список: поиск, фильтры (год, месяц, категория, поставщик, заказчик, без картинок, неполные), {items,total,page,limit}. */
  async list(q: Record<string, unknown> = {}): Promise<{ items: Doc[]; total: number; page: number; limit: number; incomplete: number }> {
    const p = parseList(q, { sortable: SORT, defaultSort: '-passportNo', defaultLimit: 25 });
    const filter = this.filterOf(q, p.deleted);
    if (p.search) filter.$or = ['passportNumber', 'warrantyCode', 'productCode', 'name', 'article', 'customerName', 'objectName', 'orderNo', 'category', 'supplier'].map((f) => ({ [f]: p.search }));
    const docs = await this.model.find(filter).setOptions({ includeSoftDeleted: true }).sort({ ...p.sort, _id: -1 }).lean().exec();
    // «неполные» считаются правилами, а не запросом — паспортов сотни, это дёшево
    const all: Array<Doc & { missing: string[] }> = docs.map((d) => ({ ...(d as unknown as Doc), missing: missingFields(d as never) }));
    const rows = q.incomplete === '1' || q.incomplete === 'true' ? all.filter((d) => d.missing.length) : all;
    return { items: rows.slice(p.skip, p.skip + p.limit), total: rows.length, page: p.page, limit: p.limit, incomplete: all.filter((d) => d.missing.length).length };
  }

  private filterOf(q: Record<string, unknown>, deleted = false): Doc {
    const f: Doc = { deletedAt: deleted ? { $ne: null } : null };
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
    return { ...doc, images, missing: missingFields(doc as never), supplierOrg: supplierOrg ? { id: String(supplierOrg._id), name: supplierOrg.name, hasSeal: (supplierOrg.assets || []).some((a: Doc) => a.role === 'seal'), hasSignature: (supplierOrg.assets || []).some((a: Doc) => a.role === 'signature') } : null };
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
  private async maxOf(field: 'passportNumber' | 'productCode'): Promise<number> {
    const [r] = await this.model.aggregate([
      { $project: { n: { $convert: { input: `$${field}`, to: 'int', onError: null, onNull: null } } } },
      { $group: { _id: null, max: { $max: '$n' } } },
    ]).option({ includeSoftDeleted: true }).exec();
    return Number(r?.max) || 0;
  }

  /** Недостающие номера: № паспорта и номер изделия — из счётчиков (атомарно, после занятых), талон — из даты и №. */
  async allocate(set: Doc, date: Date) {
    if (!set.passportNumber) {
      const no = await nextSeq(this.counters(), 'passportNumber', await this.maxOf('passportNumber'));
      Object.assign(set, { passportNumber: String(no), passportNo: no });
    }
    if (!set.productCode) set.productCode = String(await nextSeq(this.counters(), 'productCode', await this.maxOf('productCode')));
    if (!set.warrantyCode) set.warrantyCode = warrantyCodeFor(date, String(set.passportNumber));
  }

  private async assertFree(set: Doc, selfId?: Types.ObjectId) {
    const not = selfId ? { _id: { $ne: selfId } } : {};
    for (const [f, label] of [['passportNumber', 'Паспорт №'], ['productCode', 'Номер изделия'], ['warrantyCode', 'Гарантийный талон']] as const) {
      if (!set[f]) continue;
      const extra = f === 'productCode' ? { productCodeDuplicate: { $ne: true } } : {};
      const twin = await this.model.findOne({ [f]: set[f], ...extra, ...not }).setOptions({ includeSoftDeleted: true }).select('passportNumber').lean().exec();
      if (twin) throw new ConflictException(`${label} ${set[f]} уже занят (паспорт № ${twin.passportNumber})`);
    }
  }

  private normalize(dto: Partial<CreateProductPassportDto>): Doc {
    const set: Doc = { ...dto };
    delete set.confirmNumbers;
    for (const f of OID_FIELDS) if (f in set) set[f] = set[f] ? this.oid(set[f]) : null;
    if ('date' in set) set.date = set.date ? new Date(String(set.date)) : null;
    if (set.images) set.images = (set.images as Array<Doc>).map((i, k) => ({ kind: i.kind, photoId: this.oid(i.photoId), order: i.order ?? k, ...(i.caption ? { caption: i.caption } : {}) }));
    if (set.passportNumber !== undefined) set.passportNo = Number(set.passportNumber) || undefined;
    return set;
  }

  /** Новый паспорт: номера выдаёт сервер (если не заданы явно), описание собирается из частей, комплектность по умолчанию. */
  async create(dto: CreateProductPassportDto): Promise<ProductPassportDocument> {
    const set = this.normalize(dto);
    const date = (set.date as Date) || dayUtc();
    set.date = date;
    await this.allocate(set, date);
    if (!set.description) set.description = buildDescription(set as never) || undefined;
    if (!set.bom) set.bom = DEFAULT_BOM;
    set.source = set.source || 'app';
    await this.assertFree(set);
    try {
      return await this.model.create(set);
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
    dto.images = ((src.images as Array<Doc>) || []).map((i) => ({ kind: i.kind, photoId: String(i.photoId), order: i.order, caption: i.caption }));
    for (const f of OID_FIELDS) if (dto[f]) dto[f] = String(dto[f]);
    return this.create({ ...(dto as unknown as CreateProductPassportDto), ...over });
  }

  async update(id: string, dto: UpdateProductPassportDto): Promise<ProductPassportDocument> {
    const doc = await this.findById(id);
    const set = this.normalize(dto);
    const touched = NUMBER_FIELDS.filter((f) => f in set && String(set[f] ?? '') !== String((doc as unknown as Doc)[f] ?? ''));
    if (touched.length && !dto.confirmNumbers) {
      throw new ConflictException(`Номер, талон и дата выданного паспорта меняются только с подтверждением (confirmNumbers): ${touched.join(', ')}`);
    }
    await this.assertFree(set, doc._id);
    doc.set(set);
    return doc.save();
  }

  async markIssued(id: Types.ObjectId | string) {
    await this.model.updateOne({ _id: new Types.ObjectId(String(id)) }, { $set: { pdfIssuedAt: new Date() } }).exec();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } }).exec();
  }

  async restore(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Паспорт ${id} не найден`);
    const r = await this.model.updateOne({ _id: new Types.ObjectId(id), deletedAt: { $ne: null } }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    if (!r.matchedCount) throw new NotFoundException(`Паспорт ${id} не найден в корзине`);
    return this.findById(id);
  }

  // ─── шаблон (ПС.1) ───────────────────────────────────────────────────────────────────────────────
  /** Действующий шаблон; если в базе ещё нет — встроенный (версия 0, по образцу №549). */
  async template(): Promise<PassportTemplateContent & { version: number; id?: string; updatedAt?: Date }> {
    const t = await this.templates.findOne({ isActive: true }).sort({ version: -1 }).lean().exec();
    if (!t) return { version: 0, ...DEFAULT_PASSPORT_TEMPLATE };
    return { version: t.version, id: String(t._id), sections: t.sections, tables: t.tables, updatedAt: (t as unknown as { updatedAt?: Date }).updatedAt };
  }

  /** Правка шаблона — новая версия, прежняя остаётся в истории. */
  async saveTemplate(body: Partial<PassportTemplateContent>, userId?: string) {
    const cur = await this.template();
    const sections = body.sections ?? cur.sections, tables = body.tables ?? cur.tables;
    if (!Array.isArray(sections) || !sections.every((s) => s && typeof s.title === 'string' && Array.isArray(s.paragraphs))) throw new BadRequestException('sections: [{ key, title, paragraphs[] }]');
    await this.templates.updateMany({ isActive: true }, { $set: { isActive: false } }).exec();
    await this.templates.create({ version: cur.version + 1, isActive: true, sections, tables, ...(userId && Types.ObjectId.isValid(userId) ? { updatedBy: new Types.ObjectId(userId) } : {}) });
    return this.template();
  }

  private oid(v: unknown): Types.ObjectId {
    const s = String(v);
    if (!Types.ObjectId.isValid(s)) throw new BadRequestException(`Неверный id: ${s}`);
    return new Types.ObjectId(s);
  }
}
