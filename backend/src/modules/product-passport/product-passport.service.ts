import { installKindOf, variantOf } from './passport-variants';
import { blankItems } from './passport-blanks';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ForbiddenException } from '@nestjs/common';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types, type ClientSession } from 'mongoose';
import { ProductPassport, ProductPassportDocument } from './product-passport.schema';
import { PassportTemplate, PassportTemplateDocument } from './passport-template.schema';
import { normalizeCategory, type PassportCategory } from './passport-template-select';
import { DEFAULT_PASSPORT_TEMPLATE, type PassportTemplateContent } from './passport-template.default';
import { CreateProductPassportDto } from './dto/create-product-passport.dto';
import { UpdateProductPassportDto } from './dto/update-product-passport.dto';
import { mergeProductImages, type PassportImageLike, type ProductImageRow } from './passport-product-images';
import { IMAGE_KIND_LABELS, INSTANCE_FIELD_KEYS, missingHint, DEFAULT_BOM, buildDescription, dayUtc, missingFieldsV2, imageRules, nextSeq, warrantyCodeFor, type CounterColl, missingKeyed } from './passport-rules';
import { standardWarnings, standardsDict, type StandardDoc } from './passport-compose';
import type { DictRec } from './passport-compose-parts';
import { buildV2Text, type FunnelText } from './passport-v2-text';
import { checkSections, cleanSections, type SectionLike } from './passport-sections-check';
import { JOINTS_MISSING, jointsMissing } from './passport-traits';
import { editSnapshotItem, type SnapshotSection } from './passport-snapshot-edit';
import { promoteToOwn } from './passport-promote';
import { standardSchemes } from './passport-schemes';
import { PASSPORT_TEXTS_V2 } from './passport-texts.v2';
import { textsTree } from './passport-texts-tree';
import { ALL_V2, AFTER_PRINT_FIELDS, DRAFT_PREFIX, MODEL_FIELDS, NUMBER_FIELDS, OID_FIELDS, isIssued, type Doc } from './passport-consts';
import { PassportBulk } from './passport-bulk';
import { productFunnel } from './passport-funnel';
import { productGaps } from './passport-gaps';
import { unreadableRequiredImages } from './passport-image-files';
import { facetPhrases, groupChain } from './passport-facet-phrases';
import { diffPatch, followsProduct, productCategories, productPatch } from './passport-from-product';
import { loadQueue, ourSupplierId } from './passport-queue';
import { assertOneLive, bindDraft } from './passport-bind';
import { assertPdf, presentPrint, storePrintPdf, unlinkPrint } from './passport-print-file';
import { PassportIssue } from './passport-issue';
import { orderIssue, orderPlan, type OrderHost } from './passport-order';
import { PassportNumbers } from './passport-numbers';
import { lastByFirm } from './passport-last-numbers';
import { createReadyPassport } from './passport-ready';
import type { ReadyPassportDto } from './dto/ready-passport.dto';
import { PassportQueries, choiceMissingIn } from './passport-queries';
import { buildForest, forProduct, parseChoices, presentForest, resolveChoices, toNode, type PhraseTreeNode, type ProductCtx } from '../../common/passport/phrase-tree';
import { MaterialsSpecRefs, parseMaterialsSpec, type StoredSpec } from '../../common/catalog/materials-table';

@Injectable()
export class ProductPassportService {
  constructor(
    @InjectModel(ProductPassport.name) private readonly model: Model<ProductPassportDocument>,
    @InjectModel(PassportTemplate.name) private readonly templates: Model<PassportTemplateDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Optional() private readonly versions?: DataVersionService,
  ) {
    // тяжёлые части вынесены в отдельные файлы (ПР-1); публичные методы сервиса прежние
    this.queries = new PassportQueries({ model, connection, versions, categoryRules: () => this.categoryRules(), installs: () => this.installs(), withSchemes: (d, i) => this.withSchemes(d, i), oid: (v) => this.oid(v), forest: (c) => this.forest(c) });
    this.bulkOps = new PassportBulk({ model, findById: (id) => this.findById(id), update: (id, p) => this.update(id, p), snapshot: (id) => this.snapshot(id), oid: (v) => this.oid(v) });
    this.issueOps = new PassportIssue({ model, connection, findById: (id) => this.findById(id), readiness: (d) => this.readiness(d), freezeImages: (id) => this.freezeImages(id), snapshot: (id) => this.snapshot(id), allocate: (set, date, session) => this.allocate(set, date, session), assertFree: (set, selfId, session) => this.assertFree(set, selfId, session) });
    this.numbers = new PassportNumbers({
      connection, maxOf: (f, s) => this.maxOf(f, s),
    });
  }
  // ПН: номера паспортов — показать следующие / задать следующий
  private readonly numbers: PassportNumbers;
  private readonly queries: PassportQueries;
  private readonly bulkOps: PassportBulk;
  private readonly issueOps: PassportIssue;
  /** МИ: ссылки таблицы «Материалы изделия» паспорта на справочники — та же проверка, что у изделия. */
  private readonly mi = new MaterialsSpecRefs(() => this.connection.db!);

  // ─── список, подсказки, выпуск, массовые действия — passport-queries.ts / passport-issue.ts / passport-bulk.ts ───
  /** Список; у паспортов с изделием добавлено `productCategory` и `categoryDiffers` (категория паспорта ≠ категории изделия — знак в списке). */
  async list(q: Record<string, unknown> = {}, opts: { full?: boolean } = {}) {
    const r = await this.queries.list(q, opts);
    const cats = await productCategories(this.connection.db!, r.items.filter((x) => x.productId).map((x) => x.productId as Types.ObjectId));
    r.items = r.items.map((x) => {
      const pc = x.productId ? cats.get(String(x.productId)) ?? null : null;
      return x.productId ? { ...x, productCategory: pc, categoryDiffers: !!pc && !!x.passportCategory && pc !== x.passportCategory } : x;
    });
    return r;
  }
  phrases() { return this.queries.phrases(); }
  models() { return this.queries.models(); }
  byOrder(q: Record<string, unknown> = {}) { return this.queries.byOrder(q); }
  facets(q: Record<string, unknown> = {}) { return this.queries.facets(q); }
  /** Массовое изменение выбранных паспортов (БЗ-9) → { updated, failed, before }. */
  bulk(dto: { ids?: unknown; set?: Record<string, unknown>; arrays?: Record<string, string>; rebuildText?: boolean }) { return this.bulkOps.run(dto); }
  /** «Отменить» массовое изменение (БЗ-9). */
  bulkRestore(dto: { items?: Array<{ id?: string; set?: Record<string, unknown> }> }) { return this.bulkOps.restore(dto); }
  /** НМ: выпуск — последний шаг (проверка, текст, номера в одной транзакции). */
  issue(id: string) { return this.issueOps.issue(id); }
  /** НМ: аннулирование выпущенного — причина обязательна. */
  annul(id: string, reason: unknown) { return this.issueOps.annul(id, reason); }
  /** НМ-2: похожие паспорта той же модели (черновик, тот же заказ / покупатель / адрес). */
  /** Очередь «Нужно сделать» (passport-queue.ts). */
  queue(q: Record<string, unknown>) { return loadQueue(this.connection.db!, { due: q.due as string | undefined, search: q.search as string | undefined, limit: Number(q.limit) || undefined }); }

  /** ПН: следующие номера — только показ. */
  nextNumbers() { return this.numbers.nextNumbers(); }
  /** ПН: задать № следующего выпущенного паспорта. */
  setNextNumber(want: { next?: number; nextProductCode?: number }) { return this.numbers.setNext(want); }

  /** C072: последний № — общий и по каждой нашей фирме (ряд общий, по фирмам — показ). */
  async lastNumbers() {
    const [{ lastPassportNo }, byFirm] = await Promise.all([this.numbers.nextNumbers(), lastByFirm(this.model, this.connection)]);
    return { last: lastPassportNo, byFirm };
  }

  /** C072: готовый паспорт — файл сделан отдельно; сразу выпущен, номер на выбор или следующий (passport-ready.ts). */
  async createReady(dto: ReadyPassportDto, file: { mimetype?: string; size?: number; buffer?: Buffer; originalname?: string } | undefined, userId?: string) {
    const doc = await createReadyPassport({ model: this.model, connection: this.connection, allocate: (set, date, session) => this.allocate(set, date, session), assertFree: (set, selfId, session) => this.assertFree(set, selfId, session) }, dto, file, userId);
    return this.get(String(doc._id));
  }

  duplicates(q: Record<string, unknown>) { return this.issueOps.duplicates(q); }

  // ─── карточка ────────────────────────────────────────────────────────────────────────────────────
  async findById(id: string): Promise<ProductPassportDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Паспорт ${id} не найден`);
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Паспорт ${id} не найден`);
    return doc;
  }

  /** Карточка: паспорт + чего не хватает + поставщик (для печати/подписи) + картинки с адресами. */
  async get(id: string) {
    await this.syncFromProduct(id);
    await this.refreshDraft(id);
    const doc = (await this.findById(id)).toObject() as unknown as Doc;
    // фронтенду: fromProduct — поля из изделия только для чтения; productCategory / categoryDiffers — знак «категория отличается от изделия» (у выданных)
    const prod = doc.productId ? await this.connection.collection('products').findOne({ _id: doc.productId as Types.ObjectId }) : null;
    const productCategory = prod ? (await productCategories(this.connection.db!, [prod._id])).get(String(prod._id)) ?? null : null;
    const fromProduct = !!prod && followsProduct(doc);
    const fromProductFields = fromProduct ? Object.keys(await productPatch(this.connection.db!, prod as Doc)) : [];
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
    const instRec = (await this.installs()).get(String(doc.installationTypeId ?? '')) ?? null;
    const vopts = { variant: 'short' as const, install: installKindOf(instRec) };
    const rules = imageRules(doc as never, cat, { category: String(doc.passportCategory ?? ''), ...vopts });
    const requiredImages = rules.required.map((k) => (k === 'safety_zone' ? 'safety' : k));
    const eff = await this.effectiveImages(doc);
    const productImageKinds = [...new Set(eff.filter((i) => !((doc.images as Doc[]) || []).includes(i as never)).map((i) => String(i.kind)))];
    const choiceMissing = await this.choiceMissing(doc);
    return { ...doc, ...presentPrint(doc), productImageKinds, imageSlots: rules.slots, fromProduct, fromProductFields, productCategory, categoryDiffers: !!productCategory && !!doc.passportCategory && productCategory !== doc.passportCategory, images, standardImages, requiredImages, missing: [...missingFieldsV2({ ...doc, images: [...eff, ...std] } as never, cat, vopts), ...choiceMissing.map((m) => m.label), ...jointsMissing(doc).map((m) => m.label)], ...(choiceMissing.length ? { missingChoices: choiceMissing } : {}), ...(standardWarningsList.length ? { standardWarnings: standardWarningsList } : {}), supplierOrg: supplierOrg ? { id: String(supplierOrg._id), name: supplierOrg.name, hasSeal: (supplierOrg.assets || []).some((a: Doc) => a.role === 'seal'), hasSignature: (supplierOrg.assets || []).some((a: Doc) => a.role === 'signature') } : null };
  }

  /** Что задаёт изделие в паспорте-черновике (только отличия от `cur`); пусто — паспорт без изделия или выдан. */
  private async fromProductDiff(cur: Doc): Promise<Doc> {
    if (!followsProduct(cur)) return {};
    const prod = await this.connection.collection('products').findOne({ _id: this.oid(cur.productId) });
    return prod ? diffPatch(cur, await productPatch(this.connection.db!, prod as Doc)) : {};
  }

  /**
   * Черновик с изделием: категория и общие поля берутся у изделия при чтении, сохранении и печати.
   * Текст по справочникам пересобирается, если его не правили руками (`editedAt`). Выданные и паспорта без изделия не трогаем.
   */
  async syncFromProduct(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const doc = await this.model.findById(id).exec();
    if (!doc) return false;
    const cur = doc.toObject() as unknown as Doc;
    const diff = await this.fromProductDiff(cur);
    if (!Object.keys(diff).length) return false;
    doc.set(diff);
    const snap = cur.textSnapshot as { sections?: unknown[]; editedAt?: Date } | undefined;
    const textChanged = diff.passportCategory || diff.textChoices || diff.elements || diff.materialIds || diff.installationTypeId ||
      diff.isKit || diff.joints || 'materialsSpec' in diff || 'materials' in diff;
    if (snap?.sections?.length && !snap.editedAt && textChanged) await this.applySnapshot(doc, { ...cur, ...diff });
    await doc.save();
    return true;
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
    if ('textChoices' in set) set.textChoices = parseChoices(set.textChoices); // ПВ: пусто — выбор снят
    if ('materialsSpec' in set) set.materialsSpec = parseMaterialsSpec(set.materialsSpec); // МИ: тот же разбор, что у изделия; пусто — null
    if (set.passportNumber !== undefined) set.passportNo = Number(set.passportNumber) || undefined;
    return set;
  }

  /** Новый паспорт: номера выдаёт сервер (если не заданы явно), описание собирается из частей, комплектность по умолчанию. */
  async create(dto: CreateProductPassportDto): Promise<ProductPassportDocument> {
    const set = this.normalize(await bindDraft(this.connection.db!, dto));
    if (set.incomeId) await assertOneLive(this.model, set.incomeId);
    await this.mi.check((set.materialsSpec as StoredSpec | null | undefined) ?? null);
    const date = (set.date as Date) || dayUtc();
    set.date = date;
    // НМ: новый паспорт — черновик без номера, талона и номера изделия; номер передан явно (перенос) — сразу выпущен
    if (set.passportNumber) { await this.allocate(set, date); set.status = 'issued'; set.issuedAt = new Date(); set.revision = 1; }
    else { for (const f of ['passportNo', 'productCode', 'warrantyCode'] as const) delete set[f]; set._id = new Types.ObjectId(); set.passportNumber = DRAFT_PREFIX + String(set._id); set.status = 'draft'; const ownName = set.name; Object.assign(set, await this.fromProductDiff({ ...set })); if (ownName) set.name = ownName; } // ПНЗ: название из заказа или введённое — важнее названия изделия
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

  /**
   * Черновики паспортов на все позиции заказа без живого паспорта (не удалён, не аннулирован); название — из позиции.
   * Повтор ничего не дублирует: наличие проверяется перед каждым созданием. Уникального индекса по incomeId нет (на проде не добавляем).
   */
  async createDraftsForOrder(orderId: string): Promise<{ created: number; skipped: number; items: Array<{ incomeId: string; passportId: string }> }> {
    const oid = this.oid(orderId);
    const db = this.connection.db!;
    if (!(await db.collection('salesorders').findOne({ _id: oid, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Заказ не найден');
    const incomes = await db.collection('incomes').find({ orderId: oid, deletedAt: null, cancelledAt: null, productId: { $ne: null } }, { projection: { title: 1 } }).sort({ lineNo: 1, _id: 1 }).toArray();
    const items: Array<{ incomeId: string; passportId: string }> = [];
    let skipped = 0;
    for (const inc of incomes) {
      if (await this.model.exists({ incomeId: inc._id, status: { $ne: 'annulled' } })) { skipped++; continue; }
      try {
        const doc = await this.create({ incomeId: String(inc._id), ...(inc.title ? { name: String(inc.title) } : {}) } as CreateProductPassportDto);
        items.push({ incomeId: String(inc._id), passportId: String(doc._id) });
      } catch (e) {
        const msg = e instanceof ConflictException ? String((e.getResponse() as { message?: string })?.message ?? e.message) : '';
        if (msg.includes('позицию')) { skipped++; continue; }
        throw e;
      }
    }
    return { created: items.length, skipped, items };
  }

  // ─── ПНЗ: паспорта на весь заказ (passport-order.ts) ───
  private orderHost(): OrderHost {
    return {
      db: () => this.connection.db!,
      templateMissing: async (productId, variant) => (await this.check({ productId, mode: 'template', variant })).missing.map((m) => m.label),
      createDraft: async (incomeId, title, supplierOrgId) => ({ id: String((await this.create({ incomeId, ...(title ? { name: title } : {}), ...(supplierOrgId ? { supplierOrgId } : {}) } as CreateProductPassportDto))._id) }),
      setSupplier: async (passportId, supplierOrgId) => {
        if (!Types.ObjectId.isValid(passportId) || !Types.ObjectId.isValid(supplierOrgId)) return;
        const org = await this.connection.db!.collection('organizations').findOne(
          { _id: new Types.ObjectId(supplierOrgId), isOurCompany: true, deletedAt: null },
          { projection: { name: 1, shortName: 1 } },
        );
        if (!org) throw new BadRequestException('Выберите фирму');
        await this.model.updateOne(
          { _id: new Types.ObjectId(passportId), status: 'draft', deletedAt: null, $or: [{ supplierOrgId: null }, { supplierOrgId: { $exists: false } }] },
          { $set: { supplierOrgId: org._id, supplier: String(org.shortName || org.name || '') } },
        ).exec();
      },
      hasOurSupplier: async () => !!(await ourSupplierId(this.connection.db!)),
      issue: (id) => this.issue(id),
      discard: (id) => this.discardDraft(id),
    };
  }
  /** План по заказу: позиции, изделия, паспорта, готовность к выпуску и чего не хватает. */
  orderPlan(orderId: string, variant?: string, supplierOrgId?: string) { return orderPlan(this.orderHost(), orderId, variant, supplierOrgId); }
  /** Выпуск паспортов для готовых позиций заказа; неготовые и уже выпущенные — в skipped с причиной. */
  orderIssue(orderId: string, opts: { lines?: string[]; variant?: string; supplierOrgId?: string } = {}) { return orderIssue(this.orderHost(), orderId, opts); }
  /** Выпущенные паспорта заказа по порядку позиций (для общего PDF). */
  async issuedOfOrder(orderId: string): Promise<{ items: Doc[]; orderNo: string | null }> {
    const db = this.connection.db!;
    const order = Types.ObjectId.isValid(orderId) ? await db.collection('salesorders').findOne({ _id: new Types.ObjectId(orderId), deletedAt: null }, { projection: { orderNo: 1 } }) : null;
    if (!order) throw new NotFoundException('Заказ не найден');
    const incomes = await db.collection('incomes').find({ orderId: order._id, deletedAt: null }, { projection: { _id: 1 } }).sort({ lineNo: 1, _id: 1 }).toArray();
    const rows = (await this.model.find({ incomeId: { $in: incomes.map((i) => i._id) }, status: 'issued' }).sort({ passportNo: 1 }).lean().exec()) as unknown as Doc[];
    const order2 = new Map(incomes.map((i, k) => [String(i._id), k]));
    rows.sort((a, b) => (order2.get(String(a.incomeId)) ?? 0) - (order2.get(String(b.incomeId)) ?? 0));
    return { items: rows, orderNo: (order.orderNo as string) ?? null };
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
    // изделие главнее формы: категория и общие поля черновика с изделием берутся у изделия, что бы ни прислал клиент
    if (!issued) Object.assign(set, await this.fromProductDiff({ ...cur, ...set }));
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
    // МИ: ссылки на справочники проверяются, только если таблицу меняли (прежняя может ссылаться на запись из корзины)
    if (changed.includes('materialsSpec')) await this.mi.check((set.materialsSpec as StoredSpec | null) ?? null);
    await this.assertFree(set, doc._id);
    if (set.incomeId && String(set.incomeId) !== String(cur.incomeId ?? '')) await assertOneLive(this.model, set.incomeId, doc._id);
    const hadText = !!((doc.toObject() as unknown as Doc).textSnapshot as { sections?: unknown[] } | undefined)?.sections?.length;
    doc.set(set);
    const snap = cur.textSnapshot as { editedAt?: Date } | undefined;
    const rebuilt = !issued && !snap?.editedAt && changed.some((key) => key === 'materialsSpec' || key === 'materials')
      && await this.applySnapshot(doc, { ...cur, ...set });
    const saved = await doc.save();
    if (rebuilt) return saved;
    // НМ: новая редакция — текст заново по справочникам и снова заморожен; черновику с категорией текст собирается при выпуске
    if (set.revision && saved.passportCategory) return (await this.snapshot(String(saved._id))) ?? saved;
    // паспорту без текста выбрали категорию — собрать текст сразу (как при создании); готовый текст не трогаем — «Обновить текст по справочникам»
    if (set.passportCategory && !hadText) return (await this.snapshot(String(saved._id))) ?? saved;
    // ПВ: черновик — выбор текстов изменили, значит текст и производные поля (назначение, установка) собираются заново
    if ((changed.includes('textChoices') || changed.includes('joints')) && !issued && saved.passportCategory) return (await this.snapshot(String(saved._id))) ?? saved;
    return saved;
  }

  /** Черновик, который не удалось выпустить сразу (паспорт для CRM — только с номером): убрать, чтобы не копились. Только status draft. */
  async discardDraft(id: string) {
    await this.model.deleteOne({ _id: this.oid(id), status: 'draft' }).setOptions({ includeSoftDeleted: true }).exec();
  }

  async markIssued(id: Types.ObjectId | string) {
    await this.model.updateOne({ _id: new Types.ObjectId(String(id)) }, { $set: { pdfIssuedAt: new Date() } }).exec();
  }

  /** C062: свой PDF к номеру. Ответ — карточка, `printFile: { name, hasFile }`, без пути на диск. */
  async savePrintFile(id: string, file: { mimetype?: string; size?: number; buffer?: Buffer; originalname?: string } | undefined, userId?: string) {
    const doc = await this.findById(id);
    const buf = assertPdf(file);
    const stored = await storePrintPdf(buf, file?.originalname, userId);
    const prev = (doc.toObject() as unknown as Doc).printFile as { path?: string } | undefined;
    doc.set('printFile', stored);
    await doc.save();
    if (prev?.path && prev.path !== stored.path) await unlinkPrint(prev.path);
    return this.get(id);
  }

  /** Снять свой PDF: дальше печать снова собирает паспорт на сайте. */
  async removePrintFile(id: string) {
    const doc = await this.findById(id);
    const prev = (doc.toObject() as unknown as Doc).printFile as { path?: string } | undefined;
    if (prev?.path) {
      await this.model.updateOne({ _id: doc._id }, { $unset: { printFile: '' } }).exec();
      await unlinkPrint(prev.path);
    }
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    if (isIssued(doc.toObject() as unknown as Doc) || doc.status === 'annulled') throw new ConflictException('Выпущенный паспорт не удаляется — «Аннулировать» (номер останется занятым)');
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } }).exec();
  }

  async restore(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Паспорт ${id} не найден`);
    const _id = new Types.ObjectId(id);
    const gone = await this.model.findOne({ _id, deletedAt: { $ne: null } }).setOptions({ includeSoftDeleted: true }).select('incomeId').lean().exec();
    if (!gone) throw new NotFoundException(`Паспорт ${id} не найден в корзине`);
    if (gone.incomeId) await assertOneLive(this.model, gone.incomeId, _id);
    await this.model.updateOne({ _id, deletedAt: { $ne: null } }, { $set: { deletedAt: null } }).setOptions({ includeSoftDeleted: true }).exec();
    return this.findById(id);
  }

  // ─── шаблон (ПС.1) ───────────────────────────────────────────────────────────────────────────────
  /** Активная версия именно этой категории (для «Для всех» — в т.ч. без поля category). */
  private ownDoc(category: PassportCategory) {
    const filter = category === 'ALL' ? { isActive: true, category: { $in: [null, 'ALL'] } } : { isActive: true, category };
    return this.templates.findOne(filter).sort({ version: -1 }).lean().exec();
  }

  /** Действующий шаблон категории; своей нет — «Для всех»; в базе пусто — встроенный (версия 0, по образцу №549). */
  async template(category?: string): Promise<PassportTemplateContent & { version: number; id?: string; updatedAt?: Date; materialsSpec?: StoredSpec | null; category: PassportCategory }> {
    const cat = normalizeCategory(category);
    const t = (await this.ownDoc(cat)) ?? (cat === 'ALL' ? null : await this.ownDoc('ALL'));
    if (!t) return { version: 0, category: 'ALL', ...DEFAULT_PASSPORT_TEMPLATE };
    return { version: t.version, category: normalizeCategory(t.category), id: String(t._id), sections: t.sections, tables: t.tables, materialsSpec: t.materialsSpec ?? null, updatedAt: (t as unknown as { updatedAt?: Date }).updatedAt };
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
    // черновик с изделием: поля и категория — из изделия (в память; запишет doc.save() в конце)
    const fp = await this.fromProductDiff(p);
    if (Object.keys(fp).length) { doc.set(fp); Object.assign(p, fp); }
    return await this.applySnapshot(doc, p) ? doc.save() : null;
  }

  /** Снимок и его исходные поля сохраняются одним doc.save(). */
  private async applySnapshot(doc: ProductPassportDocument, p: Doc): Promise<boolean> {
    const built = await this.buildText(p);
    if (!built) return false;
    const { text, instLeaf } = built;
    if (p.installationTypeId) doc.set('installationTypeId', p.installationTypeId);
    // purpose / installationMethod — производные от выбора (их читают kppdf и PDF v1); набранные вручную («свой текст») не трогаем
    const manual = (p.manualText as string[] | undefined) ?? [];
    if (text.purpose && !manual.includes('purpose')) doc.set('purpose', text.purpose);
    if (instLeaf && !manual.includes('installationMethod')) doc.set('installationMethod', text.install.text);
    const modernDrawing = p.status === 'draft' || (p.textSnapshot as { drawingLayout?: number } | undefined)?.drawingLayout === 2;
    doc.set('textSnapshot', { ...text, ...(modernDrawing ? { drawingLayout: 2 } : {}), at: new Date() });
    return true;
  }

  /**
   * Предпросмотр PDF по изделию без выпуска: черновик в памяти (поля изделия + текст по категории), в базу ничего не пишется.
   * Нет изделия — 404, нет категории — 400.
   */
  async previewDoc(productId: string): Promise<Doc> {
    if (!Types.ObjectId.isValid(productId)) throw new NotFoundException(`Изделие ${productId} не найдено`);
    const prod = await this.connection.collection('products').findOne({ _id: new Types.ObjectId(productId), deletedAt: null });
    if (!prod) throw new NotFoundException(`Изделие ${productId} не найдено`);
    const p: Doc = { _id: new Types.ObjectId(), productId: prod._id, status: 'draft', passportNumber: '', ...(await productPatch(this.connection.db!, prod as Doc)) };
    const built = await this.buildText(p);
    if (!built) throw new BadRequestException('У изделия не выбрана категория паспорта — PDF собирается по ней. Укажите категорию в карточке изделия');
    return { ...p, textSnapshot: { ...built.text, at: new Date() } };
  }

  /** C060: тексты разделов воронки изделия (с его правками) — таблица «Тексты этого изделия»; нет изделия — 404, нет категории — пусто. */
  async productTexts(productId: string): Promise<{ category: string; items: FunnelText[] }> {
    if (!Types.ObjectId.isValid(productId)) throw new NotFoundException(`Изделие ${productId} не найдено`);
    const prod = await this.connection.collection('products').findOne({ _id: new Types.ObjectId(productId), deletedAt: null });
    if (!prod) throw new NotFoundException(`Изделие ${productId} не найдено`);
    const p: Doc = { _id: new Types.ObjectId(), productId: prod._id, status: 'draft', passportNumber: '', ...(await productPatch(this.connection.db!, prod as Doc)) };
    const built = await this.buildText(p);
    return { category: String(p.passportCategory ?? ''), items: built?.text.funnel ?? [] };
  }

  /** Текст паспорта по справочникам для `p` (без записи; выбранный способ установки кладёт в `p.installationTypeId`); нет категории — null. */
  private async buildText(p: Doc, usedFields?: Set<string>) {
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
    // воронка (ПВ): выбор по разделам; вариант раздела «Установка» сам ставит способ установки (схемы, рисунки, основание — в нём)
    const product = await this.productCtx(p.productId);
    const forest = forProduct(await this.forest(cat), product); // тексты, привязанные к чужим признакам, изделию не идут
    const resolved = resolveChoices(forest, p.textChoices as Record<string, string> | undefined, product);
    const instRoot = forest.find((r) => r.section === 'installation');
    const instLeaf = instRoot ? resolved.leaves.get(instRoot.id)?.leaf : undefined;
    if (instLeaf?.installTypeId) p.installationTypeId = new Types.ObjectId(instLeaf.installTypeId);
    const text = buildV2Text({ passport: p, all, own, standards, usedFields, dicts: { elements, materials, defects, install }, funnel: { forest, choices: p.textChoices as Record<string, string> | undefined, product } });
    return { text, instLeaf };
  }

  /**
   * Проверка черновика формы (ФП): чего не хватает для выпуска — те же правила, что у сохранённого паспорта
   * (категория, справочник, стандартные схемы способа установки). Ничего не пишет.
   */
  async check(body: Record<string, unknown>, usedFields?: Set<string>) {
    const numOr = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(String(v).replace(',', '.')));
    // изделие — единственный источник своих полей (решение 9): берём всё из него, тело дополняет и перекрывает
    const p: Doc = {};
    const productId = body.productId && Types.ObjectId.isValid(String(body.productId)) ? String(body.productId) : '';
    if (productId) {
      const prod = await this.connection.collection('products').findOne({ _id: new Types.ObjectId(productId), deletedAt: null });
      if (prod) Object.assign(p, await productPatch(this.connection.db!, prod as Doc));
    }
    const filledIn = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
    const pd = (body.passportDefaults && typeof body.passportDefaults === 'object' ? body.passportDefaults : {}) as Doc;
    for (const [k, v] of Object.entries({ ...pd, ...body })) if (k !== 'passportDefaults' && k !== 'mode' && filledIn(v)) p[k] = v;
    // template — шаблон изделия (по умолчанию, когда есть изделие): поля экземпляра (дата, поставщик, заказчик…) не требуются
    const template = (body.mode ?? (productId ? 'template' : 'instance')) === 'template';
    for (const k of ['height', 'length', 'width', 'weight', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears']) p[k] = numOr(p[k]);
    p.images = ((p.images as Array<Doc>) || []).map((i) => ({ kind: i.kind || 'overview', photoId: String(i.photoId ?? '') }));
    if (p.productId && Types.ObjectId.isValid(String(p.productId))) p.images = mergeProductImages(await this.productImageRows(String(p.productId)), p.images as PassportImageLike[]); // рисунки изделия тоже считаются
    p.isKit = p.isKit === true || p.isKit === 'yes';
    const [cats, inst] = await Promise.all([this.categoryRules(), this.installs()]);
    const cat = cats.get(String(p.passportCategory ?? '')) ?? null;
    const full = this.withSchemes(p, inst);
    const vopts = { variant: variantOf(body.variant), install: installKindOf(inst.get(String(p.installationTypeId ?? ''))) };
    const rules = imageRules(p as never, cat, { category: String(p.passportCategory ?? ''), ...vopts });
    const choices = await this.choiceMissing({ passportCategory: p.passportCategory, textChoices: parseChoices(p.textChoices), textOverrides: p.textOverrides, manualText: p.manualText });
    const noHint = (m: { label: string; key: string; hint?: string }) => ({ ...m, hint: m.hint ?? missingHint(m.key, m.label) });
    const keep = (m: { key: string; label: string }) => !(template && (INSTANCE_FIELD_KEYS.includes(m.key) || m.label === 'Дата' || m.label === 'Поставщик'));
    const built = p.passportCategory ? await this.buildText({ ...p }, usedFields).catch(() => null) : null;
    const blanks = blankItems(built?.text.missing ?? []);
    // C086: назначение, выбранное в текстах (раздел «Назначение»), и есть назначение паспорта — не требовать его второй раз через «Элементы»
    const purposeDone = !!String(built?.text.purpose ?? '').trim();
    const listed = missingKeyed(full as never, cat, vopts).filter((m) => !(purposeDone && m.key === 'purpose'));
    const broken = await unreadableRequiredImages(this.connection.db!, (full.images ?? []) as Array<{ kind?: unknown; photoId?: unknown }>, rules.required);
    for (const kind of broken) {
      const key = 'img_' + (kind === 'safety_zone' ? 'safety' : kind);
      if (!listed.some((m) => m.key === key)) listed.push({ key, label: `Обязательный рисунок не читается: ${IMAGE_KIND_LABELS[kind] ?? kind}. Загрузите изображение заново` });
    }
    const extra = blanks.filter((b) => !listed.some((m) => m.key === b.key));
    return { mode: template ? 'template' : 'instance', missing: [...listed, ...extra, ...choices, ...(built?.text.needJoints ? [JOINTS_MISSING] : [])].filter(keep).map(noHint), requiredImages: rules.required.map((k) => (k === 'safety_zone' ? 'safety' : k)), imageSlots: rules.slots };
  }

  /** ПП: чего не хватает для выпуска сохранённого паспорта — [{ label, key }] (стандартные схемы способа установки засчитываются). */
  async readiness(doc: Doc): Promise<Array<{ label: string; key: string }>> {
    const [cats, inst] = await Promise.all([this.categoryRules(), this.installs()]);
    doc = { ...doc, images: await this.effectiveImages(doc) };
    const full = this.withSchemes(doc, inst);
    const cat = cats.get(String(doc.passportCategory ?? '')) ?? null;
    const ctx = { category: String(doc.passportCategory ?? ''), variant: 'short' as const, install: installKindOf(inst.get(String(doc.installationTypeId ?? ''))) };
    const missing = [...missingKeyed(full as never, cat, ctx), ...(await this.choiceMissing(doc)), ...jointsMissing(doc)];
    const required = imageRules(full, cat, ctx).required;
    const broken = await unreadableRequiredImages(this.connection.db!, (full.images ?? []) as Array<{ kind?: unknown; photoId?: unknown }>, required);
    for (const kind of broken) {
      const key = 'img_' + (kind === 'safety_zone' ? 'safety' : kind);
      if (!missing.some((m) => m.key === key)) missing.push({ key, label: `Обязательный рисунок не читается: ${IMAGE_KIND_LABELS[kind] ?? kind}. Загрузите изображение заново` });
    }
    return missing;
  }

  /** Рисунки изделия «для паспорта» (productphotos purpose:'passport'), по порядку; удалённые не берутся. */
  async productImageRows(productId: string): Promise<ProductImageRow[]> {
    return this.connection.collection('productphotos').find({ productId: new Types.ObjectId(productId), purpose: 'passport', deletedAt: null }, { projection: { kind: 1, photoId: 1, sortOrder: 1, caption: 1 } }).sort({ sortOrder: 1, createdAt: 1 }).toArray() as Promise<ProductImageRow[]>;
  }

  /**
   * Рисунки паспорта для проверки и печати: у черновика с изделием — рисунки изделия по видам, остальные виды из images[];
   * у выпущенного и аннулированного — только его images[] (замороженные при выпуске).
   */
  async effectiveImages(doc: Doc): Promise<Doc[]> {
    const own = ((doc.images as Doc[]) || []);
    if (isIssued(doc) || doc.status === 'annulled' || !doc.productId) return own;
    return mergeProductImages(await this.productImageRows(String(doc.productId)), own as PassportImageLike[]) as Doc[];
  }

  /** При выпуске: photoId из изделия записываются в images[] паспорта — дальше он печатается сам по себе, как раньше. */
  async freezeImages(id: string) {
    const doc = (await this.findById(id)).toObject() as unknown as Doc;
    if (!doc.productId) return;
    const images = (await this.effectiveImages(doc)).map((i, k) => ({ kind: i.kind || 'overview', photoId: this.oid(i.photoId), order: i.order ?? k, ...(i.caption ? { caption: i.caption } : {}), ...(i.refCode ? { refCode: i.refCode } : {}) }));
    await this.model.updateOne({ _id: doc._id, status: 'draft' }, { $set: { images } }).exec();
  }

  // ─── воронка текстов (ПВ 2026-10-25) ─────────────────────────────────────────────────────────────
  /** Признаки и группы изделия (сама группа и её родители) — по ним тексты, привязанные к признакам/группам, выбираются сами (C028 B2). */
  private async productCtx(productId: unknown): Promise<ProductCtx | undefined> {
    if (!productId || !Types.ObjectId.isValid(String(productId))) return undefined;
    const db = this.connection.db!;
    const prod = await db.collection('products').findOne({ _id: new Types.ObjectId(String(productId)) }, { projection: { facetValueIds: 1, categoryId: 1 } });
    if (!prod) return undefined;
    return { facetValueIds: new Set(((prod.facetValueIds as unknown[]) ?? []).map(String)), groupIds: await groupChain(db, prod.categoryId) };
  }

  /** Дерево текстов, видимое категории (без категории — всё): один расчёт, пока не менялся dict_values. Общий результат — не менять. */
  async forest(category?: string): Promise<PhraseTreeNode[]> {
    const cat = String(category ?? '').trim();
    const make = async () => buildForest((await this.connection.collection('dict_values').find({ dict: 'passportPhrases', deletedAt: null }).toArray()).map((r) => toNode(r)), cat || undefined);
    return this.versions ? this.versions.cached('passports.funnel', ['dict_values'], cat, make) : make();
  }

  /** GET passports/funnel?category=TRN&productId= → { sections: [раздел → варианты → подварианты → текст] }; с изделием — без текстов чужих признаков. */
  async funnel(category?: string, productId?: string) { return { sections: presentForest(forProduct(await this.forest(category), await this.productCtx(productId))) }; }

  /** GET passports/funnel?category=&group=&f=&q= → шаги воронки создания паспорта (категория → группа → признаки) и изделия (C028, A2). */
  productFunnel(q: Record<string, unknown>) { return productFunnel(this.connection.db!, q); }

  /** GET showcase/:id/passport-gaps → чего не хватает изделию для паспорта (C028, A3). */
  gaps(productId: string) { return productGaps(this, this.connection.db!, productId); }

  /** Обязательные разделы воронки без выбора → [{ label, key: 'choice:<id раздела>' }]; текст, набранный вручную, раздел закрывает. */
  private async choiceMissing(d: Doc): Promise<Array<{ label: string; key: string }>> {
    if (!d.passportCategory) return [];
    return choiceMissingIn(forProduct(await this.forest(String(d.passportCategory)), await this.productCtx(d.productId)), d);
  }

  /** Черновик с собранным текстом пересобирается при открытии, если «Тексты паспорта» менялись позже снимка; правленный руками и выпущенный — нет. */
  private async refreshDraft(id: string) {
    if (!Types.ObjectId.isValid(id)) return;
    const p = await this.model.findById(id, { status: 1, passportCategory: 1, 'textSnapshot.at': 1, 'textSnapshot.editedAt': 1 }).lean().exec() as { status?: string; passportCategory?: string; textSnapshot?: { at?: Date; editedAt?: Date } } | null;
    if (!p || p.status !== 'draft' || !p.passportCategory || !p.textSnapshot?.at || p.textSnapshot.editedAt) return;
    const dv = this.connection.collection('dict_values');
    const [a, b] = await Promise.all([
      dv.find({ dict: 'passportPhrases' }, { projection: { updatedAt: 1 } }).sort({ updatedAt: -1 }).limit(1).toArray(),
      dv.find({ dict: 'passportPhrases', deletedAt: { $ne: null } }, { projection: { deletedAt: 1 } }).sort({ deletedAt: -1 }).limit(1).toArray(),
    ]);
    const last = Math.max(+(a[0]?.updatedAt ?? 0), +(b[0]?.deletedAt ?? 0));
    if (last > +p.textSnapshot.at) await this.snapshot(id);
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
    const docs = await this.connection.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1, name: 1, requiredImages: 1, requiredFields: 1, serviceLifeYears: 1, warrantyMonths: 1, standards: 1, fieldDefaults: 1 } }).toArray();
    return new Map(docs.map((d) => [String(d.code), d as { name?: string; requiredImages?: string; requiredFields?: string; serviceLifeYears?: string; warrantyMonths?: string; standards?: string; fieldDefaults?: string }]));
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
  async saveTemplate(body: Partial<PassportTemplateContent> & { category?: string; materialsSpec?: unknown }, userId?: string) {
    const cat = normalizeCategory(body.category);
    const base = await this.template(cat); // содержимое по умолчанию — действующее (для категории без версии — «Для всех»)
    const own = await this.ownDoc(cat);
    const sections = body.sections ?? base.sections, tables = body.tables ?? base.tables;
    if (!Array.isArray(sections) || !sections.every((s) => s && typeof s.title === 'string' && Array.isArray(s.paragraphs))) throw new BadRequestException('Тексты: ожидается список разделов sections: [{ key, title, paragraphs[] }]');
    checkSections(sections);
    // МЦ-5: таблица материалов шаблона; не прислали — как была, прислали null/пусто — очистить
    const spec = 'materialsSpec' in body ? parseMaterialsSpec(body.materialsSpec) : (own?.materialsSpec ?? null);
    if (spec) await this.mi.check(spec);
    const same = cat === 'ALL' ? { category: { $in: [null, 'ALL'] } } : { category: cat };
    await this.templates.updateMany({ isActive: true, ...same }, { $set: { isActive: false } }).exec();
    await this.templates.create({ version: (own?.version ?? 0) + 1, isActive: true, ...(cat === 'ALL' ? {} : { category: cat }), sections, tables, ...(spec ? { materialsSpec: spec } : {}), ...(userId && Types.ObjectId.isValid(userId) ? { updatedBy: new Types.ObjectId(userId) } : {}) });
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
  async texts(category?: string, productId?: string) {
    const base = await this.textsOf(category);
    return { ...base, phrases: await this.phrasesFor(base.category, productId) };
  }

  /** A5: готовые тексты категории; с изделием — фразы по его признакам первыми (byFacet), чужие признаки скрыты. */
  private async phrasesFor(category: string, productId?: string) {
    const db = this.connection.db!;
    const prod = productId && Types.ObjectId.isValid(productId) ? await db.collection('products').findOne({ _id: new Types.ObjectId(productId) }, { projection: { facetValueIds: 1, categoryId: 1 } }) : null;
    if (productId && !prod) throw new NotFoundException('Изделие не найдено');
    const raw = await db.collection('dict_values').find({ dict: 'passportPhrases', deletedAt: null, $or: [{ facetValueIds: { $exists: true } }, { groupIds: { $exists: true } }] }, { projection: { facetValueIds: 1, groupIds: 1 } }).toArray();
    const ids = (r: Record<string, unknown>, k: string) => ((r[k] as unknown[]) ?? []).map(String);
    const bound = new Map(raw.map((r) => [String(r._id), ids(r, 'facetValueIds')]));
    const boundGroups = new Map(raw.map((r) => [String(r._id), ids(r, 'groupIds')]));
    return facetPhrases(await this.forest(category === 'ALL' ? undefined : category), bound, prod ? new Set(ids(prod, 'facetValueIds')) : null, boundGroups, prod ? await groupChain(db, prod.categoryId) : new Set());
  }

  private async textsOf(category?: string) {
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
    const stored = cat === 'ALL' ? (await this.v2All()).sections : (await this.v2Own(cat)).own?.sections;
    const sections = cleanSections(body.sections as SectionLike[], (stored ?? []) as SectionLike[]) as PassportTemplateContent['sections'];
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
