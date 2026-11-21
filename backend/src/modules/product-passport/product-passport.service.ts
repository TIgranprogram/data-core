import { passportProductVersion, withPassportProductWrite } from './passport-product-write';
import { assertSitePassport, copyPassportValue, lineBaseline, passportLine, stalePassport, withPassportSite } from '../../common/passport/line-source';
import { parseModules } from '../../common/passport/modules';
import { installKindOf, variantOf, PASSPORT_VARIANTS, type PassportVariant } from './passport-variants';
import { blankItems } from './passport-blanks';
import { assertRevisionRemovable, revisionRows } from './passport-revisions';
import { compositionPresentation } from './passport-composition-presentation';
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
import { mergeProductImages, presentEffectiveImages, type PassportImageLike, type ProductImageRow } from './passport-product-images';
import { IMAGE_KIND_LABELS, INSTANCE_FIELD_KEYS, missingHint, DEFAULT_BOM, buildDescription, dayUtc, missingFieldsV2, imageRules, nextSeq, warrantyCodeFor, type CounterColl, missingKeyed } from './passport-rules';
import { standardWarnings, standardsDict, type StandardDoc } from './passport-compose';
import type { DictRec } from './passport-compose-parts';
import { buildV2Text, withTextSources, type FunnelText } from './passport-v2-text';
import { checkSections, cleanSections, type SectionLike } from './passport-sections-check';
import { JOINTS_MISSING, jointsMissing } from './passport-traits';
import { editSnapshotItem, type SnapshotSection } from './passport-snapshot-edit';
import { canon, carryManual, manualConflict, sameSnapshot, type Snap } from './passport-snapshot-refresh';
import { promoteToOwn } from './passport-promote';
import { carryFields, cleanFieldText, editField, fieldTarget, parseField, parseIndex, parseMaintPart, removeMaintRow, type FieldSnap } from './passport-snapshot-field';
import { fieldDestination, fieldSourceName, promoteField, sourceToken } from './passport-field-promote';
import { standardSchemes } from './passport-schemes';
import { PASSPORT_TEXTS_V2 } from './passport-texts.v2';
import { textsTree } from './passport-texts-tree';
import { ALL_V2, AFTER_PRINT_FIELDS, DRAFT_PREFIX, MODEL_FIELDS, NUMBER_FIELDS, OID_FIELDS, isIssued, type Doc } from './passport-consts';
import { PassportBulk } from './passport-bulk';
import { productFunnel } from './passport-funnel';
import { DEFAULT_INSTALL, applyCategoryDefaults, gapKind, productGaps } from './passport-gaps';
import { buildFillQueue, loadFillContext } from './product-fill-queue';
import { productTechGaps } from './techsheet-gaps';
import { productTechAnalogs } from './techsheet-analogs';
import { unreadableRequiredImages } from './passport-image-files';
import { facetPhrases, groupChain } from './passport-facet-phrases';
import { diffPatch, followsProduct, INSTANCE_TEXT_FIELDS, instanceManualText, productCategories, productPatch } from './passport-from-product';
import { loadQueue, ourSupplierId } from './passport-queue';
import { assertOneLive, assertScopeIndex, bindDraft, bindPresentation, isScopeDuplicate, lineScopeKey } from './passport-bind';
import { assertPdf, presentPrint, storePrintPdf, unlinkPrint } from './passport-print-file';
import { PassportIssue } from './passport-issue';
import { orderIssue, orderPlan, type OrderHost } from './passport-order';
import { PassportNumbers } from './passport-numbers';
import { lastByFirm } from './passport-last-numbers';
import { createReadyPassport } from './passport-ready';
import type { ReadyPassportDto } from './dto/ready-passport.dto';
import { PassportQueries, choiceMissingIn } from './passport-queries';
import { buildForest, forProduct, missingChoices, parseChoices, presentForest, resolveChoices, toNode, type PhraseTreeNode, type ProductCtx } from '../../common/passport/phrase-tree';
import { overrideFor } from '../../common/passport/text-overrides';
import { isBriefPresentation, printPhraseRoots, renderSimplePhrase, selectSimpleDescription, shortDetailKeys, simpleChoiceForest, simpleDescriptionSuggestions, simpleFacetIds, type PassportPrintSources, type PassportReadiness, type SimpleDescriptionSource } from './passport-presentation';
import { renderSelectedParts, selectedPartsIssue, type SimpleDescription } from '../../common/passport/simple-description';
import { PASSPORT_CATEGORY_CODES, presentPassportDefaults, type PassportDefaults } from '../showcase/passport-defaults';
import { patchPassportTemplate } from '../showcase/passport-template-patch';
import { resolveStyle } from './passport-pdf-v2';
import type { LookDoc } from './passport-look.service';

function addBindingBlocker(readiness: PassportReadiness, error: unknown) {
  if (!(error instanceof BadRequestException || error instanceof ConflictException)) throw error;
  const label = error.message;
  const key = /фирм/i.test(label) ? 'supplierOrgId' : /издели/i.test(label) ? 'productId' : 'incomeId';
  if (!readiness.missing.some((m) => m.key === key)) readiness.missing.push({ key, label, hint: 'Проверьте исходные данные выпуска и перечитайте книжку' });
  readiness.ready = false;
}
import { kindPatch, purposeRootId, resolveKind } from '../../common/passport/kind';
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
    this.issueOps = new PassportIssue({ model, connection, findById: (id) => this.findById(id), readiness: (d, session) => this.readiness(d, session), effectiveImages: (d, session) => this.effectiveImages(d, session), freezeImages: (id) => this.freezeImages(id), refresh: (id) => this.refreshDraftText(id), preparePresentation: (d, session) => this.preparePresentation(d, session), allocate: (set, date, session) => this.allocate(set, date, session), assertFree: (set, selfId, session) => this.assertFree(set, selfId, session) });
    this.numbers = new PassportNumbers({
      connection, maxOf: (f, s) => this.maxOf(f, s),
      maxShown: (f) => (this.versions ? this.versions.cached('passports.maxNo', ['productpassports'], f, () => this.maxOf(f)) : this.maxOf(f)),
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
  /** Список; у паспортов с изделием добавлено `productCategory` и `categoryDiffers` (тип паспорта ≠ категории изделия — знак в списке). */
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
  issue(id: string, expected?: { presentationVersion?: number; variant?: string }) { return this.issueOps.issue(id, expected); }
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
  async get(id: string, opts: { readOnly?: boolean } = {}) {
    let syncWarning: string | undefined;
    try { if (!opts.readOnly) await this.syncFromProduct(id, true); }
    catch (e) {
      if (!(e instanceof ConflictException)) throw e;
      syncWarning = e.message;
    }
    const doc = (await this.findById(id)).toObject() as unknown as Doc;
    if (doc.presentationVersion === 1) return this.getPresentation(doc);
    if (doc.status === 'draft') doc.compositionPresentation = compositionPresentation(doc);
    if (syncWarning) doc.syncWarning = syncWarning;
    // C130: старый снимок без источников текста — подписать их по свежей сборке (только в ответе, в базу не пишется)
    const snap = doc.textSnapshot as { sections?: unknown[]; src?: unknown; refs?: unknown } | undefined;
    if (opts.readOnly && !snap?.sections?.length && doc.passportCategory) {
      doc.textSnapshot = (await this.legacyPrintDoc(doc)).textSnapshot;
    } else if (!opts.readOnly && snap?.sections && (!snap.src || !snap.refs)) {
      try { const built = await this.buildText({ ...doc }); if (built) doc.textSnapshot = withTextSources(snap as never, built.text); } catch { /* цвета — подсказка, карточка открывается и без них */ }
    }
    // фронтенду: fromProduct — поля из изделия только для чтения; productCategory / categoryDiffers — знак «категория отличается от изделия» (у выданных)
    const prod = doc.productId ? await this.connection.collection('products').findOne({ _id: doc.productId as Types.ObjectId }) : null;
    const productCategory = prod ? (await productCategories(this.connection.db!, [prod._id])).get(String(prod._id)) ?? null : null;
    const fromProduct = !!prod && followsProduct(doc);
    const fromProductFields = fromProduct ? Object.keys(await productPatch(this.connection.db!, prod as Doc)) : [];
    const ownImages = (doc.images as Doc[]) || [];
    const eff = opts.readOnly ? ownImages : await this.effectiveImages(doc);
    const photoIds = [...ownImages, ...eff].map((i) => i.photoId as Types.ObjectId);
    const photos = photoIds.length ? await this.connection.collection('photos').find({ _id: { $in: photoIds } }, { projection: { storageUrl: 1, thumbId: 1 } }).toArray() : [];
    const url = new Map(photos.map((p) => [String(p._id), p.storageUrl as string]));
    const images = ((doc.images as Array<Doc>) || []).map((i) => ({ ...i, url: url.get(String(i.photoId)) ?? null }));
    const effectiveImages = presentEffectiveImages(ownImages, eff, url);
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
    const productImageKinds = [...new Set(eff.filter((i) => !((doc.images as Doc[]) || []).includes(i as never)).map((i) => String(i.kind)))];
    const choiceMissing = await this.choiceMissing(doc);
    const revisionList = await this.revisionList(doc);
    return { ...doc, ...presentPrint(doc), ...(revisionList.length ? { revisionList } : {}), productImageKinds, imageSlots: rules.slots, fromProduct, fromProductFields, productCategory, categoryDiffers: !!productCategory && !!doc.passportCategory && productCategory !== doc.passportCategory, images, effectiveImages, standardImages, requiredImages, missing: [...missingFieldsV2({ ...doc, images: [...eff, ...std] } as never, cat, vopts), ...choiceMissing.map((m) => m.label), ...jointsMissing(doc).map((m) => m.label)], ...(choiceMissing.length ? { missingChoices: choiceMissing } : {}), ...(standardWarningsList.length ? { standardWarnings: standardWarningsList } : {}), supplierOrg: supplierOrg ? { id: String(supplierOrg._id), name: supplierOrg.name, hasSeal: (supplierOrg.assets || []).some((a: Doc) => a.role === 'seal'), hasSignature: (supplierOrg.assets || []).some((a: Doc) => a.role === 'signature') } : null };
  }

  /** Что задаёт изделие в паспорте-черновике (только отличия от `cur`); пусто — паспорт без изделия или выдан. */
  private async fromProductDiff(cur: Doc, session?: ClientSession): Promise<Doc> {
    if (!followsProduct(cur)) return {};
    const presentation = cur.presentationVersion === 1;
    const prod = await this.connection.collection('products').findOne(
      { _id: this.oid(cur.productId), ...(presentation ? { deletedAt: null } : {}) }, session ? { session } : undefined,
    );
    if (!prod) return presentation ? { passportCategory: null, simpleDescription: null } : {};
    const patch = await productPatch(this.connection.db!, prod as Doc, { presentation, brief: isBriefPresentation(cur) });
    if (presentation) {
      // Снятие значения изделия действует и в существующем черновике.
      for (const k of ['simpleDescription', 'passportCategory', 'kindId', 'height', 'width', 'length', 'weight', 'purpose', 'installationMethod', 'description']) patch[k] ??= null;
      patch.manualText ??= [];
    }
    return diffPatch(cur, patch);
  }

  /**
   * Черновик при чтении и печати (C096 Э1): категория и общие поля — у изделия; собранный текст — по текущим полям, шаблону
   * и справочникам, ручные пункты переносятся. Ничего не изменилось — записи нет. Конфликт ручной правки при чтении
   * паспорт не меняет (ни поля, ни текст): ошибку покажут сохранение и выпуск. Выданные и аннулированные не трогаем.
   */
  async syncFromProduct(id: string, strict = false): Promise<boolean> {
    return this.syncDraft(id, { strict, build: false });
  }

  /** Перед выпуском: то же, но конфликт — 409, и текст собирается, если его ещё нет. */
  async refreshDraftText(id: string): Promise<boolean> {
    return this.syncDraft(id, { strict: true, build: true });
  }

  private async syncDraft(id: string, opts: { strict: boolean; build: boolean }): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const doc = await this.model.findById(id).exec();
    if (!doc) return false;
    const cur = doc.toObject() as unknown as Doc;
    if (cur.status !== 'draft') return false;
    if (cur.presentationVersion === 1) return false; // открытие и печать v1 используют проекцию без записи
    const diff = await this.fromProductDiff(cur);
    const next = { ...cur, ...diff };
    if (Object.keys(diff).length) doc.set(diff);
    let rebuilt = false;
    const hasText = Array.isArray((cur.textSnapshot as Snap | undefined)?.sections);
    if (next.passportCategory && (hasText || opts.build)) {
      try { rebuilt = hasText ? await this.rebuildSafe(doc, next) : await this.applySnapshot(doc, next); }
      catch (e) {
        if (!opts.strict && e instanceof ConflictException) return false; // документ не сохраняем — паспорт остаётся прежним
        throw e;
      }
    }
    if (!Object.keys(diff).length && !rebuilt) return false;
    await this.saveCurrent(doc, cur);
    return true;
  }

  /** Запоздавшая пересборка не может затереть ручную правку или уже выпущенный снимок. */
  private async saveCurrent(doc: ProductPassportDocument, previous: Doc, session?: ClientSession): Promise<ProductPassportDocument> {
    doc.$where = { ...doc.$where, status: previous.status ?? { $exists: false },
      ...(previous.updatedAt ? { updatedAt: previous.updatedAt } : {}),
      textSnapshot: previous.textSnapshot === undefined ? { $exists: false } : previous.textSnapshot };
    try { return await doc.save({ session }); }
    catch (e) {
      // VersionError — две правки одновременно (C115 QA-A B1): тоже 409, не 500
      if (e instanceof Error && (e.name === 'DocumentNotFoundError' || e.name === 'VersionError')) throw new ConflictException('Паспорт изменён другим действием. Обновите карточку и повторите сохранение.');
      throw e;
    }
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
    delete set.creationKey;
    for (const f of OID_FIELDS) if (f in set) set[f] = set[f] ? this.oid(set[f]) : null;
    if ('date' in set) set.date = set.date ? new Date(String(set.date)) : null;
    for (const k of ['saleDate', 'installedAt'] as const) if (k in set) set[k] = set[k] ? new Date(String(set[k])) : null;
    // картинка без вида — только «Фото изделия» (ФП: раньше без вида не попадала никуда)
    if (set.images) set.images = (set.images as Array<Doc>).map((i, k) => ({ kind: i.kind || 'overview', photoId: this.oid(i.photoId), order: i.order ?? k, ...(i.caption ? { caption: i.caption } : {}), ...(i.refCode ? { refCode: i.refCode } : {}) }));
    for (const f of ['elements', 'materialIds'] as const) if (Array.isArray(set[f])) set[f] = (set[f] as unknown[]).map((x) => this.oid(x));
    if ('modules' in set) set.modules = parseModules(set.modules); // C095
    if ('textChoices' in set) set.textChoices = parseChoices(set.textChoices); // ПВ: пусто — выбор снят
    if ('materialsSpec' in set) set.materialsSpec = parseMaterialsSpec(set.materialsSpec); // МИ: тот же разбор, что у изделия; пусто — null
    if (set.passportNumber !== undefined) set.passportNo = Number(set.passportNumber) || undefined;
    return set;
  }

  /** Новый паспорт: номера выдаёт сервер (если не заданы явно), описание собирается из частей, комплектность по умолчанию. */
  async create(dto: CreateProductPassportDto, actorId?: string): Promise<ProductPassportDocument> {
    if (dto.presentationVersion === 1) return this.createPresentation(dto, actorId);
    const baseline = dto.incomeId ? await passportLine(this.connection.db!, dto.incomeId) : null;
    assertSitePassport(baseline);
    const set = this.normalize(await bindDraft(this.connection.db!, dto));
    const productVersion = await passportProductVersion(this.connection, set.productId);
    delete set.variant;
    if (set.incomeId) await assertOneLive(this.model, set.incomeId);
    if (set.incomeId) set.creationScopeKey = lineScopeKey(set.incomeId);
    await this.mi.check((set.materialsSpec as StoredSpec | null | undefined) ?? null);
    const date = (set.date as Date) || dayUtc();
    set.date = date;
    // НМ: новый паспорт — черновик без номера, талона и номера изделия; номер передан явно (перенос) — сразу выпущен
    if (set.passportNumber) { set.status = 'issued'; set.issuedAt = new Date(); set.revision = 1; }
    else {
      for (const f of ['passportNo', 'productCode', 'warrantyCode'] as const) delete set[f];
      set._id = new Types.ObjectId(); set.passportNumber = DRAFT_PREFIX + String(set._id); set.status = 'draft';
      // ПНЗ/C148: название из заказа или явно введённое сохраняется и при следующих чтениях черновика.
      const ownName = String(set.name ?? '').trim();
      const productDiff = await this.fromProductDiff({ ...set });
      Object.assign(set, productDiff);
      if (ownName && productDiff.name && ownName !== String(productDiff.name).trim()) {
        set.name = ownName;
        set.manualText = [...new Set([...(set.manualText as string[] ?? []), 'name'])];
      }
    }
    if (!set.description) set.description = buildDescription(set as never) || undefined;
    if (!set.bom) set.bom = DEFAULT_BOM;
    set.source = set.source || 'app';
    await this.assertFree(set);
    if (baseline && set.passportCategory) {
      const prepared = new this.model(set);
      await this.applySnapshot(prepared, { ...set });
      Object.assign(set, prepared.toObject());
    }
    try {
      const doc = await withPassportSite(this.connection, baseline, outer => withPassportProductWrite(this.connection, productVersion, outer, async session => {
        const attempt = copyPassportValue(set);
        if (attempt.status === 'issued') await this.allocate(attempt, date, session);
        await this.assertFree(attempt, undefined, session);
        return session ? (await this.model.create([attempt], { session }))[0] : await this.model.create(attempt);
      }));
      // v2: паспорт с категорией — сразу снимок текста (правка справочников потом его не меняет)
      if (!baseline && set.passportCategory) return (await this.snapshot(String(doc._id))) ?? doc;
      return doc;
    } catch (e) {
      if (isScopeDuplicate(e)) throw new ConflictException('На эту позицию уже есть паспорт');
      if ((e as { code?: number }).code === 11000) throw new ConflictException('Номер уже занят другим паспортом — повторите создание');
      throw e;
    }
  }

  private scopeIndexReady = false;

  private async requireScopeIndex() {
    if (this.scopeIndexReady) return;
    await assertScopeIndex(this.connection.db!);
    this.scopeIndexReady = true;
  }

  private async createPresentation(dto: CreateProductPassportDto, actorId?: string): Promise<ProductPassportDocument> {
    if (dto.passportNumber || dto.productCode || dto.warrantyCode) throw new BadRequestException('Номера присваиваются при выпуске');
    if (!dto.incomeId && (!dto.creationKey || !actorId)) throw new BadRequestException('Для выпуска изделия нужен ключ создания');
    if (dto.incomeId && dto.creationKey) throw new BadRequestException('Выпуск на позицию не принимает ключ самостоятельного создания');
    const creationScopeKey = dto.incomeId ? lineScopeKey(dto.incomeId) : `single/${actorId}/${dto.creationKey!.toLowerCase()}`;
    const variant = variantOf(dto.variant);
    const db = this.connection.db!;
    await this.requireScopeIndex();
    const baseline = dto.incomeId ? await passportLine(db, dto.incomeId) : null;
    const bound = await bindPresentation(db, dto as unknown as Doc);
    const findExisting = async (expectedBound = bound) => {
      const rows = expectedBound.incomeId
        ? await this.model.find({ incomeId: expectedBound.incomeId, status: { $ne: 'annulled' } }).limit(2).exec()
        : await this.model.find({ creationScopeKey }).setOptions({ includeSoftDeleted: true }).limit(1).exec();
      if (rows.length > 1) throw new ConflictException('На позицию найдено несколько живых паспортов');
      const existing = rows[0];
      if (!existing) return null;
      const saved = existing.toObject() as unknown as Doc;
      if (String(saved.productId) !== String(expectedBound.productId)
        || (expectedBound.incomeId && String(saved.salesOrderId) !== String(expectedBound.salesOrderId))) {
        throw new ConflictException('Паспорт уже связан с другими исходными данными — перечитайте книжку');
      }
      if (!expectedBound.incomeId || !isIssued(saved)) {
        if (saved.supplierOrgId && String(saved.supplierOrgId) !== String(expectedBound.supplierOrgId)) throw new ConflictException('Фирма сохранённого паспорта отличается — перечитайте книжку');
        if (saved.presentationVersion === 1 && saved.variant !== variant) throw new ConflictException('Вариант сохранённого паспорта отличается — откройте его для изменения');
      }
      return existing;
    };
    const existing = await findExisting();
    if (existing) { if (!isIssued(existing.toObject() as unknown as Doc)) assertSitePassport(baseline); return existing; }
    assertSitePassport(baseline);
    const _id = new Types.ObjectId();
    const productVersion = await passportProductVersion(this.connection, bound.productId);
    const set: Doc = { ...bound, _id, presentationVersion: 1, variant, creationScopeKey, date: dayUtc(), status: 'draft', passportNumber: DRAFT_PREFIX + String(_id), source: 'app', bom: DEFAULT_BOM };
    const diff = await this.fromProductDiff(set);
    if (set.name && diff.name && set.name !== diff.name) {
      delete diff.name;
      diff.instanceManualText = ['name'];
      diff.manualText = [...new Set([...((diff.manualText as string[]) ?? []), 'name'])];
    }
    Object.assign(set, diff);
    const draft = new this.model(set);
    await this.applySnapshot(draft, { ...set });
    const prepared = draft.toObject({ minimize: false });
    try { return await withPassportSite(this.connection, baseline, outer => withPassportProductWrite(this.connection, productVersion, outer, session => new this.model(copyPassportValue(prepared)).save({ session }))); }
    catch (e) {
      const stale = e instanceof ConflictException && (e.getResponse() as { code?: string }).code === 'STALE_CONTEXT';
      if (!isScopeDuplicate(e) && !stale) throw e;
      // Повтор создания может проиграть epoch раньше unique insert. Возвращаем только готовый winner, не повторяем запись с новым baseline.
      let replayBound = bound;
      if (baseline) {
        try {
          const live = await passportLine(db, baseline._id, baseline.orderId);
          if (JSON.stringify({ ...lineBaseline(live), passportEpoch: 0 }) !== JSON.stringify({ ...lineBaseline(baseline), passportEpoch: 0 })) throw stalePassport();
          assertSitePassport(live);
          replayBound = await bindPresentation(db, dto as unknown as Doc);
        } catch { throw stalePassport(); }
      }
      const winner = await findExisting(replayBound);
      if (winner) return winner;
      if (stale) throw e;
      throw new ConflictException('Принадлежность паспорта изменилась — повторите создание');
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
    const incomes = await db.collection('incomes').find({ orderId: oid, deletedAt: null, cancelledAt: null, productId: { $ne: null } }, { projection: { title: 1, passportSelection: 1 } }).sort({ lineNo: 1, _id: 1 }).toArray();
    const items: Array<{ incomeId: string; passportId: string }> = [];
    let skipped = 0;
    for (const inc of incomes) {
      if (inc.passportSelection?.mode === 'attachment') { skipped++; continue; }
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
      templateMissing: async (productId, variant, presentationVersion) => {
        try { return (await this.check({ productId, mode: 'template', variant, presentationVersion })).missing.map((m) => m.label); }
        catch (e) { if (e instanceof NotFoundException) return ['Изделие не найдено']; throw e; }
      },
      createDraft: async (incomeId, title, supplierOrgId, context) => {
        const draft = await this.create({
          incomeId, ...(title ? { name: title } : {}), ...(supplierOrgId ? { supplierOrgId } : {}), ...context,
        });
        return { id: String(draft._id), presentationVersion: draft.presentationVersion, variant: draft.variant };
      },
      lineMissing: async (id, picked) => {
        const doc = (await this.findById(id)).toObject() as unknown as Doc;
        const next = { ...doc, supplierOrgId: doc.supplierOrgId ?? picked };
        if (doc.presentationVersion !== 1) {
          try { Object.assign(next, await bindPresentation(this.connection.db!, next)); }
          catch (e) {
            if (e instanceof BadRequestException || e instanceof ConflictException) return [e.message];
            throw e;
          }
          return (await this.readiness({ ...next, ...await this.fromProductDiff(next) })).map((m) => m.label);
        }
        const card = await this.getPresentation(next);
        return ((card.readiness as PassportReadiness | undefined)?.missing ?? []).map((m) => m.label);
      },
      setSupplier: async (passportId, supplierOrgId, expected) => {
        if (!Types.ObjectId.isValid(passportId) || !Types.ObjectId.isValid(supplierOrgId)) return;
        const org = await this.connection.db!.collection('organizations').findOne(
          { _id: new Types.ObjectId(supplierOrgId), isOurCompany: true, deletedAt: null },
          { projection: { name: 1, shortName: 1 } },
        );
        if (!org) throw new BadRequestException('Выберите фирму');
        await this.model.updateOne(
          { _id: new Types.ObjectId(passportId), status: 'draft', deletedAt: null, ...expected, supplierOrgId: null },
          { $set: { supplierOrgId: org._id, supplier: String(org.shortName || org.name || '') } },
        ).exec();
      },
      hasOurSupplier: async () => !!(await ourSupplierId(this.connection.db!)),
      issue: (id, expected) => this.issue(id, expected),
      discard: (id) => this.discardDraft(id),
    };
  }
  /** План по заказу: позиции, изделия, паспорта, готовность к выпуску и чего не хватает. */
  orderPlan(orderId: string, variant?: string, supplierOrgId?: string, presentationVersion?: 1) { return orderPlan(this.orderHost(), orderId, variant, supplierOrgId, presentationVersion); }
  /** Выпуск паспортов для готовых позиций заказа; неготовые и уже выпущенные — в skipped с причиной. */
  orderIssue(orderId: string, opts: { lines?: string[]; variant?: string; supplierOrgId?: string; presentationVersion?: 1 } = {}) { return orderIssue(this.orderHost(), orderId, opts); }
  /** Выпущенные паспорта заказа по порядку позиций (для общего PDF). */
  async issuedOfOrder(orderId: string): Promise<{ items: Doc[]; orderNo: string | null; skipped: Doc[] }> {
    const db = this.connection.db!;
    const order = Types.ObjectId.isValid(orderId) ? await db.collection('salesorders').findOne({ _id: new Types.ObjectId(orderId), deletedAt: null }, { projection: { orderNo: 1 } }) : null;
    if (!order) throw new NotFoundException('Заказ не найден');
    // отменённые позиции заказа в общий PDF не идут (пользователь 2026-11-13: «вычеркнутые путают»)
    const incomes = await db.collection('incomes').find({ orderId: order._id, deletedAt: null, cancelledAt: null }, { projection: { _id: 1, passportSelection: 1 } }).sort({ lineNo: 1, _id: 1 }).toArray();
    const rows = (await this.model.find({ incomeId: { $in: incomes.map((i) => i._id) }, status: 'issued' }).sort({ passportNo: 1 }).lean().exec()) as unknown as Doc[];
    const order2 = new Map(incomes.map((i, k) => [String(i._id), k]));
    rows.sort((a, b) => (order2.get(String(a.incomeId)) ?? 0) - (order2.get(String(b.incomeId)) ?? 0));
    const attached = new Set(incomes.filter(i => i.passportSelection?.mode === 'attachment').map(i => String(i._id)));
    return { items: rows.filter(r => !attached.has(String(r.incomeId))), skipped: rows.filter(r => attached.has(String(r.incomeId))), orderNo: (order.orderNo as string) ?? null };
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
    // Выпуск пишет снимок транзакционным updateOne. Пустые maps в нём нужны для точного сравнения с BSON при сохранении.
    const cur = doc.toObject({ minimize: doc.presentationVersion !== 1 }) as unknown as Doc;
    if (cur.status === 'annulled') throw new ConflictException('Паспорт аннулирован — изменить его нельзя');
    const targetIncome = dto.incomeId ?? cur.incomeId;
    const baseline = targetIncome ? await passportLine(this.connection.db!, targetIncome) : null;
    assertSitePassport(baseline);
    const set = this.normalize(dto);
    const issued = isIssued(cur);
    const presentation = cur.presentationVersion === 1;
    if (!presentation && (dto.presentationVersion !== undefined || dto.variant !== undefined)) throw new ConflictException('Сохранённый паспорт прежней формы остаётся в своей версии');
    if (issued && (dto.presentationVersion !== undefined || dto.variant !== undefined)) throw new ConflictException('Вариант выданного паспорта изменить нельзя');
    if (presentation) {
      for (const k of ['incomeId', 'salesOrderId', 'productId', 'supplierOrgId'] as const) {
        const allowSupplier = k === 'supplierOrgId' && !issued && !cur[k];
        if (k in set && !allowSupplier && String(set[k] ?? '') !== String(cur[k] ?? '')) throw new ConflictException('Связи паспорта изменились — перечитайте книжку');
      }
    }
    if (presentation && !issued) {
      Object.assign(set, await bindPresentation(this.connection.db!, { ...cur, ...set }));
      set.presentationVersion = 1;
      set.variant = variantOf(dto.variant ?? cur.variant);
      if (set.incomeId) {
        await assertOneLive(this.model, set.incomeId, doc._id);
        set.creationScopeKey = lineScopeKey(set.incomeId);
      }
      if (dto.manualText !== undefined) {
        const own = new Set(instanceManualText(cur));
        const requested = dto.manualText ?? [];
        for (const key of INSTANCE_TEXT_FIELDS) {
          if (!requested.includes(key)) own.delete(key);
          else if (dto[key] !== undefined) own.add(key);
        }
        set.instanceManualText = [...own];
        delete set.manualText; // Собирается заново из шаблона и собственных флагов ниже.
      }
    }
    if (!issued) { for (const f of ['passportNumber', 'passportNo', 'productCode', 'warrantyCode'] as const) delete set[f]; } // у черновика номеров нет
    // изделие главнее формы: категория и общие поля черновика с изделием берутся у изделия, что бы ни прислал клиент
    if (!issued) Object.assign(set, await this.fromProductDiff({ ...cur, ...set }));
    const touched = NUMBER_FIELDS.filter((f) => f in set && String(set[f] ?? '') !== String(cur[f] ?? ''));
    if (issued && touched.length) {
      if (!dto.confirmNumbers) throw new ConflictException(`Номер, талон и дата выданного паспорта меняются только с подтверждением (confirmNumbers): ${touched.join(', ')}`);
      if (!(opts.user?.isOwner || opts.user?.role === 'admin')) throw new ForbiddenException('Номер выпущенного паспорта меняет только администратор');
    }
    // Решение пользователя 2026-11-14: выпущенный паспорт правится свободно, как черновик. Номер тот же (привязан к позиции заказа);
    // правка не «после печати» сама становится новой редакцией (редакция +1, прежние значения — в истории).
    const changed = Object.keys(set).filter((k) => k !== 'passportNo' && JSON.stringify(set[k] ?? null) !== JSON.stringify(cur[k] ?? null) && !(String(set[k] ?? '') === '' && (cur[k] === undefined || cur[k] === null)));
    const locked = changed.filter((k) => !(AFTER_PRINT_FIELDS as readonly string[]).includes(k) && !(NUMBER_FIELDS as readonly string[]).includes(k) && k !== 'manualText');
    if (issued && locked.length) {
      // Явная правка модулей — новая редакция: богатые сведения должны стать видимыми, прежний режим остаётся в истории.
      if (changed.includes('modules')) set.compositionPresentation = compositionPresentation({ ...cur, ...set, status: 'draft' });
      const keep = Object.fromEntries([...locked, 'textSnapshot', 'images', ...(presentation ? ['printSnapshot'] : []), ...('compositionPresentation' in set ? ['compositionPresentation'] : [])].map((k) => [k, cur[k] ?? null]));
      set.revisions = [...((cur.revisions as unknown[]) ?? []), { revision: cur.revision ?? 1, at: new Date(), by: opts.user?.id ?? null, data: keep }];
      set.revision = Number(cur.revision ?? 1) + 1;
    }
    // МИ: ссылки на справочники проверяются, только если таблицу меняли (прежняя может ссылаться на запись из корзины)
    if (changed.includes('materialsSpec')) await this.mi.check((set.materialsSpec as StoredSpec | null) ?? null);
    await this.assertFree(set, doc._id);
    if ('incomeId' in set && String(set.incomeId ?? '') !== String(cur.incomeId ?? '')) {
      if (set.incomeId) await assertOneLive(this.model, set.incomeId, doc._id);
      set.creationScopeKey = set.incomeId ? lineScopeKey(set.incomeId) : undefined;
    }
    const hadText = Array.isArray((cur.textSnapshot as Snap | undefined)?.sections);
    doc.set(set);
    // C096 Э1: черновик с категорией — текст по текущим полям в том же сохранении; ручные пункты переносятся,
    // конфликт — 409 до записи (категория и текст остаются прежними). Без текста — собрать сразу (как при создании).
    const after = { ...cur, ...set };
    if (presentation && issued && set.revision) {
      await this.refreshRevisionPrint(doc, cur, after, locked);
    } else if (presentation && !issued) {
      const prepared = await this.evaluatePresentation(after, 'instance');
      if (prepared.readiness.missing.some((m) => m.key === 'textSnapshot')) throw new ConflictException('Не удалось пересобрать ручной текст — перечитайте книжку');
      doc.set({
        textSnapshot: prepared.document.textSnapshot,
        ...(prepared.document.installationTypeId ? { installationTypeId: prepared.document.installationTypeId } : {}),
      });
    } else if ((!issued || set.revision) && after.passportCategory) {
      // Новая редакция, поля и снимок сохраняются атомарно; ручные абзацы не исчезают при пересборке.
      if (set.revision) after.textSnapshot = { ...(cur.textSnapshot as Snap ?? {}), sizeLayout: 2 };
      if (hadText && issued) {
        // выпущенный: правка полей не должна падать из-за ручных правок текста — текст тогда остаётся прежним (2026-11-14)
        try { await this.rebuildSafe(doc, after); } catch (e) { if (!(e instanceof ConflictException)) throw e; }
      } else if (hadText) await this.rebuildSafe(doc, after);
      else await this.applySnapshot(doc, after);
    }
    const prepared = doc.toObject({ minimize: false });
    // toObject опускает undefined: переносим явные удаления в каждую новую попытку отдельно.
    const unsetPaths = baseline ? Object.keys(doc.getChanges().$unset ?? {}) : [];
    try { return await withPassportSite(this.connection, baseline, session => {
      if (!session) return this.saveCurrent(doc, cur);
      const attempt = this.model.hydrate(copyPassportValue(cur));
      attempt.set(copyPassportValue(prepared));
      for (const path of unsetPaths) attempt.set(path, undefined);
      return this.saveCurrent(attempt, cur, session);
    }); }
    catch (e) { if (isScopeDuplicate(e)) throw new ConflictException('На эту позицию уже есть паспорт'); throw e; }
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

  /** Версии для карточки (без тяжёлых снимков): «Версия N · дата · кто». */
  private async revisionList(doc: Doc) {
    const by = [...new Set(((doc.revisions as Array<{ by?: unknown }>) ?? []).map((r) => String(r.by ?? '')).filter((v) => Types.ObjectId.isValid(v)))];
    const users = by.length ? await this.connection.collection('users').find({ _id: { $in: by.map((v) => new Types.ObjectId(v)) } }, { projection: { displayName: 1, username: 1 } }).toArray() : [];
    return revisionRows(doc, new Map(users.map((u) => [String(u._id), String(u.displayName || u.username || '')])));
  }

  /** Удалить прежнюю версию выпущенного паспорта; текущая (она печатается) — 409. */
  async removeRevision(id: string, revision: number) {
    const doc = await this.findById(id);
    assertRevisionRemovable(doc.toObject() as unknown as Doc, revision);
    await this.model.updateOne({ _id: doc._id }, { $pull: { revisions: { revision } } }).exec();
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    if (isIssued(doc.toObject() as unknown as Doc) || doc.status === 'annulled') throw new ConflictException('Выпущенный паспорт не удаляется — «Аннулировать» (номер останется занятым)');
    const result = await this.model.updateOne({ _id: doc._id, status: doc.status ?? { $exists: false } },
      { $set: { deletedAt: new Date() }, ...(doc.incomeId ? { $unset: { creationScopeKey: '' } } : {}) }).exec();
    if (!result.matchedCount) throw new ConflictException('Состояние паспорта изменилось — обновите карточку');
  }

  async restore(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Паспорт ${id} не найден`);
    const _id = new Types.ObjectId(id);
    const gone = await this.model.findOne({ _id, deletedAt: { $ne: null } }).setOptions({ includeSoftDeleted: true }).select('incomeId status').lean().exec();
    if (!gone) throw new NotFoundException(`Паспорт ${id} не найден в корзине`);
    const scope = gone.incomeId && gone.status !== 'annulled';
    if (scope) await assertOneLive(this.model, gone.incomeId, _id);
    try {
      await this.model.updateOne({ _id, deletedAt: { $ne: null } }, { $set: { deletedAt: null, ...(scope ? { creationScopeKey: lineScopeKey(gone.incomeId) } : {}) } }).setOptions({ includeSoftDeleted: true }).exec();
    } catch (e) { if (isScopeDuplicate(e)) throw new ConflictException('На эту позицию уже есть паспорт'); throw e; }
    return this.findById(id);
  }

  // ─── шаблон (ПС.1) ───────────────────────────────────────────────────────────────────────────────
  /** Активная версия именно этой категории (для «Для всех» — в т.ч. без поля category). */
  private ownDoc(category: PassportCategory, session?: ClientSession) {
    const filter = category === 'ALL' ? { isActive: true, category: { $in: [null, 'ALL'] } } : { isActive: true, category };
    return this.templates.findOne(filter).sort({ version: -1 }).session(session ?? null).lean().exec();
  }

  /** Действующий шаблон категории; своей нет — «Для всех»; в базе пусто — встроенный (версия 0, по образцу №549). */
  async template(category?: string, session?: ClientSession): Promise<PassportTemplateContent & { version: number; id?: string; updatedAt?: Date; materialsSpec?: StoredSpec | null; category: PassportCategory }> {
    const cat = normalizeCategory(category);
    const t = (await this.ownDoc(cat, session)) ?? (cat === 'ALL' ? null : await this.ownDoc('ALL', session));
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
    const previous = doc.toObject() as unknown as Doc;
    const snap = previous.textSnapshot as { sections?: SnapshotSection[] } | undefined;
    if (!snap?.sections) throw new BadRequestException('У паспорта нет собранного текста — выберите категорию в «Изменить»');
    doc.set('textSnapshot', { ...snap, sections: editSnapshotItem(snap.sections, String(b.sectionKey ?? ''), String(b.itemKey ?? ''), String(b.text ?? '')), editedAt: new Date() });
    return this.saveCurrent(doc, previous);
  }

  /** Снимок паспорта; у собранного до C132 — со ссылками на источники строк из свежей сборки (в базу не пишется). */
  private async snapshotWithRefs(p: Doc): Promise<FieldSnap> {
    const snap = p.textSnapshot as (FieldSnap & { sections?: unknown[] }) | undefined;
    if (!snap?.sections) throw new BadRequestException('У паспорта нет собранного текста — выберите категорию в «Изменить»');
    if (snap.refs) return snap;
    const built = await this.buildText({ ...p }).catch(() => null);
    return built ? withTextSources(snap as never, built.text) as FieldSnap : snap;
  }

  /** C132: правка строки описания / назначения / монтажа / правил / обслуживания только для этого паспорта { field, index?, text, part?, remove? }. */
  async editSnapshotField(id: string, b: { field?: string; index?: number; text?: string; part?: string; remove?: boolean }) {
    const doc = await this.findById(id);
    const previous = doc.toObject() as unknown as Doc;
    const snap = previous.textSnapshot as FieldSnap | undefined;
    if (!(snap as { sections?: unknown } | undefined)?.sections) throw new BadRequestException('У паспорта нет собранного текста — выберите категорию в «Изменить»');
    const field = parseField(b.field);
    if (isBriefPresentation(previous) && field === 'description') throw new ConflictException('Краткое описание редактируется в шаблоне изделия');
    const index = parseIndex(field, snap!, b.index);
    if (b.remove) {
      if (field !== 'maintenance') throw new BadRequestException('Удалить можно только строку технического обслуживания');
      doc.set('textSnapshot', { ...removeMaintRow(snap!, index!), editedAt: new Date() });
      return this.saveCurrent(doc, previous);
    }
    const next = editField(snap!, field, index, b.text, parseMaintPart(field, b.part));
    doc.set('textSnapshot', { ...next, editedAt: new Date() });
    return this.saveCurrent(doc, previous);
  }

  /** Допустимые источники старого снимка: только текущие связанные записи, без записи в паспорт. */
  private async fieldSources(p: Doc, field: ReturnType<typeof parseField>) {
    const current = { ...p };
    if (p.productId) {
      const product = await this.connection.collection('products').findOne({ _id: this.oid(p.productId), deletedAt: null });
      if (!product) throw new ConflictException('Связанное изделие больше недоступно');
      Object.assign(current, await productPatch(this.connection.db!, product as Doc));
    }
    const built = await this.buildText(current);
    if (!built) throw new ConflictException('Для этого паспорта нельзя определить связанные источники');
    const snap = built.text as unknown as FieldSnap;
    const indices: Array<number | undefined> = field === 'rules' ? (snap.rules ?? []).map((_, i) => i)
      : field === 'maintenance' ? (snap.maintenance ?? []).flatMap((t) => t.rows).map((_, i) => i) : [undefined];
    const names = new Map<string, Promise<string>>();
    const items = new Map<string, { sourceKey: string; label: string; currentText: string; ref: NonNullable<ReturnType<typeof fieldTarget>['ref']> }>();
    for (const index of indices) {
      const t = fieldTarget(snap, field, index);
      if (!t.ref) continue;
      const refKey = sourceToken(t.ref);
      if (!names.has(refKey)) names.set(refKey, fieldSourceName(this.connection.db!, t.ref, String(p.productId ?? '')));
      const sourceKey = sourceToken([String(p._id), field, t.ref, t.text]);
      const name = await names.get(refKey)!;
      const label = name + (index === undefined ? '' : ' · строка ' + (index + 1));
      items.set(sourceKey, { sourceKey, label, currentText: t.text, ref: t.ref });
    }
    return [...items.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }

  async snapshotFieldSources(id: string, b: { field?: string; index?: number }) {
    const p = (await this.findById(id)).toObject() as unknown as Doc;
    const field = parseField(b.field);
    const snap = await this.snapshotWithRefs(p);
    parseIndex(field, snap, b.index);
    const items = await this.fieldSources(p, field);
    return { items: items.map(({ sourceKey, label, currentText }) => ({ sourceKey, label, currentText })) };
  }

  /**
   * C132: «Сохранить в справочнике» — текст строки пишется в её источник (запись справочника или изделие).
   * Выданные паспорта не меняются. Ответ: что изменено и сколько изделий затронуто.
   */
  async promoteSnapshotField(id: string, b: { field?: string; index?: number; text?: string; token?: string; sourceKey?: string }, preview = false) {
    const p = (await this.findById(id)).toObject() as unknown as Doc;
    const snap = await this.snapshotWithRefs(p);
    const field = parseField(b.field);
    let t = fieldTarget(snap, field, parseIndex(field, snap, b.index));
    if (b.sourceKey !== undefined) {
      const source = (await this.fieldSources(p, field)).find((s) => s.sourceKey === b.sourceKey);
      if (!source) throw new ConflictException('Выбранный источник изменился. Выберите источник заново');
      t = { ...t, ref: source.ref, old: source.currentText };
    }
    const text = cleanFieldText(field, b.text === undefined ? t.text : b.text);
    if (!t.ref) throw new ConflictException('Источник старого снимка неизвестен. Выберите связанный источник перед сохранением');
    if (preview) return fieldDestination(this.connection.db!, t.ref, p.productId ? String(p.productId) : '', t.old);
    return promoteField(this.connection.db!, t.ref, text, t.old, p.productId ? String(p.productId) : '', b.token);
  }

  /** «Перенести правку в справочник» (Э5a4): пункт из снимка → новая версия шаблона типа паспорта. */
  async promoteSnapshotItem(id: string, b: { sectionKey?: string; itemKey?: string; text?: string; token?: string }, userId?: string, preview = false) {
    const p = (await this.findById(id)).toObject() as unknown as Doc;
    const cat = String(p.passportCategory || '');
    const sec = ((p.textSnapshot as { sections?: SnapshotSection[] } | undefined)?.sections ?? []).find((s) => s.key === b.sectionKey);
    const item = sec?.items.find((i) => i.key === b.itemKey);
    if (!cat || !item) throw new BadRequestException('Пункт не найден в тексте паспорта');
    const { own: dbOwn } = await this.templatesFor(cat);
    const code = PASSPORT_TEXTS_V2[cat as keyof typeof PASSPORT_TEXTS_V2];
    const own = dbOwn ?? code ?? null;
    const all = await this.v2All();
    const token = sourceToken([cat, own, all.sections]);
    const category = await this.connection.collection('dict_values').findOne({ dict: 'passportCategories', code: cat, deletedAt: null });
    const count = async () => {
      const products = await this.connection.collection('products').find({ deletedAt: null }, { projection: { _id: 1 } }).toArray();
      const categories = await productCategories(this.connection.db!, products.map((p) => p._id));
      return [...categories.values()].filter((c) => c === cat).length;
    };
    const affected = this.versions ? await this.versions.cached('passports.categoryUsage', ['products', 'categories', 'dict_values'], cat, count) : await count();
    const result = { ok: true, target: 'тексты категории «' + String(category?.name ?? cat) + '»', affected, shared: affected > 1, token };
    if (preview) return result;
    if (b.token !== undefined && b.token !== token) throw new ConflictException('Тексты категории изменены — подтвердите сохранение заново');
    if (b.token === undefined) {
      const fresh = await this.buildText({ ...p });
      const current = fresh?.text.sections.find((s) => s.key === b.sectionKey)?.items.find((i) => i.key === b.itemKey);
      if (!current || (current.text !== (item.original ?? item.text) && current.text !== item.text)) throw new ConflictException('Источник изменился. Откройте редактор заново и проверьте источник.');
    }
    const text = cleanFieldText('description', b.text ?? item.text);
    const sections = promoteToOwn(own?.sections as never, all.sections as never, String(b.sectionKey), String(b.itemKey), text);
    return this.saveTemplate({ category: cat, sections: sections as never, tables: (own?.tables ?? []) as never }, userId, dbOwn?.id ?? null, all.version);
  }

  async snapshot(id: string): Promise<ProductPassportDocument | null> {
    const doc = await this.findById(id);
    const previous = doc.toObject() as unknown as Doc;
    const sealed = previous.status === 'issued' || previous.status === 'annulled';
    if (sealed && previous.presentationVersion === 1
      && (previous.simpleDescription as SimpleDescription | undefined)?.mode === 'parts') {
      if (previous.status === 'annulled') throw new ConflictException('Паспорт аннулирован — изменить его нельзя');
      throw new ConflictException('Паспорт уже выдан. Чтобы изменить текст, создайте новую редакцию.');
    }
    const p = { ...previous };
    // черновик с изделием: поля и категория — из изделия (в память; запишет doc.save() в конце)
    const fp = await this.fromProductDiff(p);
    if (Object.keys(fp).length) { doc.set(fp); Object.assign(p, fp); }
    return await this.applySnapshot(doc, p) ? this.saveCurrent(doc, previous) : null;
  }

  /**
   * C096 Э1: пересборка снимка черновика без потери ручных пунктов (в `doc`, без сохранения).
   * false — содержимое и производные поля те же (запись не нужна); конфликт ключа ручной правки — 409, `doc` не меняется.
   */
  private async rebuildSafe(doc: ProductPassportDocument, p: Doc, session?: ClientSession): Promise<boolean> {
    const q: Doc = { ...p };
    const built = await this.buildText(q, undefined, session);
    if (!built) return false;
    const { text, instLeaf } = built;
    const prev = p.textSnapshot as Snap | undefined;
    const { sections, conflicts } = carryManual(prev?.sections, (text.sections ?? []) as unknown as SnapshotSection[]);
    // C132: правки зелёных строк (описание, назначение, монтаж, правила, обслуживание) переносятся так же
    const fields = carryFields(prev as FieldSnap | undefined, text as unknown as FieldSnap);
    if (conflicts.length || fields.conflicts.length) throw manualConflict([...conflicts, ...fields.conflicts]);
    const modernDrawing = p.status === 'draft' || prev?.drawingLayout === 2;
    const next: Snap = { ...(fields.snap as unknown as Snap), sections, ...(modernDrawing ? { drawingLayout: 2 } : {}), ...(p.status === 'draft' || prev?.sizeLayout === 2 ? { sizeLayout: 2 } : {}), ...(prev?.editedAt ? { editedAt: prev.editedAt } : {}) };
    const manual = (p.manualText as string[] | undefined) ?? [];
    const derived: Doc = {
      installationTypeId: q.installationTypeId ?? p.installationTypeId,
      purpose: text.purpose && !manual.includes('purpose') ? text.purpose : p.purpose,
      installationMethod: instLeaf && !manual.includes('installationMethod') ? text.install.text : p.installationMethod,
    };
    const was: Doc = { installationTypeId: doc.get('installationTypeId'), purpose: doc.get('purpose'), installationMethod: doc.get('installationMethod') };
    const str = (o: Doc) => canon(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined || v === null || v === '' ? null : String(v)])));
    if (sameSnapshot(doc.get('textSnapshot') as Snap | undefined, next) && str(derived) === str(was)) return false;
    if (q.installationTypeId) doc.set('installationTypeId', q.installationTypeId);
    if (text.purpose && !manual.includes('purpose')) doc.set('purpose', text.purpose);
    if (instLeaf && !manual.includes('installationMethod')) doc.set('installationMethod', text.install.text);
    doc.set('textSnapshot', { ...next, at: new Date() });
    return true;
  }

  /** Снимок и его исходные поля сохраняются одним doc.save(). Ручные пункты не переносятся — для явной пересборки и нового текста. */
  private async applySnapshot(doc: ProductPassportDocument, p: Doc, session?: ClientSession): Promise<boolean> {
    const built = await this.buildText(p, undefined, session);
    if (!built) return false;
    const { text, instLeaf } = built;
    if (p.installationTypeId) doc.set('installationTypeId', p.installationTypeId);
    // purpose / installationMethod — производные от выбора (их читают kppdf и PDF v1); набранные вручную («свой текст») не трогаем
    const manual = (p.manualText as string[] | undefined) ?? [];
    if (text.purpose && !manual.includes('purpose')) doc.set('purpose', text.purpose);
    if (instLeaf && !manual.includes('installationMethod')) doc.set('installationMethod', text.install.text);
    const modernDrawing = p.status === 'draft' || (p.textSnapshot as { drawingLayout?: number } | undefined)?.drawingLayout === 2;
    doc.set('textSnapshot', { ...text, ...(modernDrawing ? { drawingLayout: 2 } : {}), ...(p.status === 'draft' || (p.textSnapshot as Snap | undefined)?.sizeLayout === 2 ? { sizeLayout: 2 } : {}), at: new Date() });
    return true;
  }

  /**
   * Предпросмотр PDF по изделию без выпуска: черновик в памяти (поля изделия + текст по категории), в базу ничего не пишется.
   * Нет изделия — 404, нет категории — 400.
   */
  async previewDoc(productId: string, presentationVersion?: 1, variant?: PassportVariant): Promise<Doc> {
    if (presentationVersion === 1) {
      const template = await this.passportTemplate(productId, variant);
      if (!template.textSnapshot) throw new BadRequestException(template.readiness.missing[0]?.label || 'У изделия не выбран тип паспорта');
      return template.document;
    }
    if (!Types.ObjectId.isValid(productId)) throw new NotFoundException(`Изделие ${productId} не найдено`);
    const prod = await this.connection.collection('products').findOne({ _id: new Types.ObjectId(productId), deletedAt: null });
    if (!prod) throw new NotFoundException(`Изделие ${productId} не найдено`);
    const p: Doc = { _id: new Types.ObjectId(), productId: prod._id, status: 'draft', passportNumber: '', ...(await productPatch(this.connection.db!, prod as Doc)) };
    const built = await this.buildText(p);
    if (!built) throw new BadRequestException('У изделия не выбран тип паспорта — PDF собирается по нему. Задайте тип паспорта в группе или виде изделия');
    return { ...p, textSnapshot: { ...built.text, sizeLayout: 2, at: new Date() } };
  }

  /** Прежнее представление из сохранённых полей, если у старой записи отсутствует снимок. */
  async legacyPrintDoc(doc: Doc): Promise<Doc> {
    const built = await this.buildText({ ...doc });
    if (!built) throw new BadRequestException('У паспорта не выбран тип паспорта');
    return { ...doc, textSnapshot: { ...built.text, ...(doc.status === 'draft' ? { sizeLayout: 2, drawingLayout: 2 } : {}) } };
  }

  async savePassportTemplate(productId: string, changes: Doc, expected: Doc, variant?: PassportVariant) {
    if (!Types.ObjectId.isValid(productId)) throw new NotFoundException('Изделие не найдено');
    await patchPassportTemplate(this.connection.db!, new Types.ObjectId(productId), changes, expected);
    return this.passportTemplate(productId, variant);
  }

  async passportTemplate(productId: string, variant: PassportVariant = 'short') {
    if (!Types.ObjectId.isValid(productId)) throw new NotFoundException('Изделие не найдено');
    const prod = await this.connection.collection('products').findOne({ _id: new Types.ObjectId(productId), deletedAt: null });
    if (!prod) throw new NotFoundException('Изделие не найдено');
    const productFields = await productPatch(this.connection.db!, prod as Doc, { presentation: true, brief: variant === 'short' });
    const { document, readiness, suggestions } = await this.evaluatePresentation({
      ...productFields, productId, presentationVersion: 1, variant, status: 'draft',
    }, 'template');
    return {
      mode: 'template' as const, productId, presentationVersion: 1 as const, variant,
      product: { name: String(prod.name ?? ''), article: prod.sku ? String(prod.sku) : null, dimensions: prod.dimensions ?? null, weightKg: Number(prod.weightKg) > 0 ? Number(prod.weightKg) : null,
        facetValueIds: Array.isArray(prod.facetValueIds) ? prod.facetValueIds.map(String) : null },
      defaults: presentPassportDefaults(prod.passportDefaults as PassportDefaults) ?? {},
      document,
      passportCategory: document.passportCategory ? String(document.passportCategory) : null,
      effectiveImages: document.effectiveImages,
      standardImages: document.standardImages,
      textSnapshot: document.textSnapshot ?? null,
      readiness,
      simpleDescriptionSource: document.simpleDescriptionSource ?? null,
      simpleDescriptionSuggestions: suggestions,
    };
  }

  async presentationGaps(template: Awaited<ReturnType<ProductPassportService['passportTemplate']>>) {
    const legacy = await this.gaps(template.productId);
    return {
      ...legacy,
      missing: template.readiness.missing.map((m) => ({
        kind: m.key.startsWith('choice:') ? 'choice' : gapKind(m.key),
        ...legacy.missing.find((row) => row.key === m.key), ...m, required: true,
      })),
      readiness: template.readiness, presentationVersion: 1, variant: template.variant,
    };
  }

  private async evaluatePresentation(input: Doc, mode: 'template' | 'instance', session?: ClientSession, previous?: { print: PassportPrintSources; reuseText: boolean }) {
    const db = this.connection.db!;
    const document: Doc = { ...input };
    const brief = isBriefPresentation(document);
    const category = String(document.passportCategory ?? '');
    const [categories, installs] = await Promise.all([this.categoryRules(session), this.installs(session)]);
    const cat = categories.get(category);
    const hasCategory = !!cat || (PASSPORT_CATEGORY_CODES as readonly string[]).includes(category);
    const oldInstall = document.installationTypeId;
    const defaultFields = hasCategory ? applyCategoryDefaults(document, cat) : [];
    if (hasCategory && document.warrantyMonths == null) {
      document.warrantyMonths = 12; // действующее умолчание экземпляра
      defaultFields.push('warrantyMonths');
    }
    if (hasCategory && !document.installationTypeId) this.defaultInstall(document, installs);
    const options = () => ({ category, variant: variantOf(document.variant), install: previous?.reuseText ? previous.print.install : installKindOf(installs.get(String(document.installationTypeId ?? ''))) });
    const makeIssue = (key: string, label: string, hint = missingHint(key, label)) => ({ key, label, hint });
    const own = (document.images as PassportImageLike[] | undefined) ?? [];
    const missing: ReturnType<typeof makeIssue>[] = [];
    const recommendations: ReturnType<typeof makeIssue>[] = [];
    const defaulted: PassportReadiness['defaulted'] = [];
    let built: Awaited<ReturnType<ProductPassportService['buildText']>> = null;
    let simpleWithoutCategory: Awaited<ReturnType<ProductPassportService['resolveSimpleText']>> | null = null;
    const savedText = previous?.reuseText ? input.textSnapshot as NonNullable<typeof built>['text'] : undefined;
    if (!hasCategory) {
      document.passportCategory = null;
      missing.push(makeIssue('category', 'Выберите тип паспорта', 'Карточка изделия → Паспорт → Тип паспорта'));
      if (brief && (document.simpleDescription as SimpleDescription | undefined)?.mode === 'parts') {
        simpleWithoutCategory = await this.resolveSimpleText(document, [], [], session);
      }
    } else if (!savedText) {
      try { built = await this.buildText(document, undefined, session); }
      catch (e) {
        if (session) throw e; // драйвер должен иметь возможность повторить прерванную транзакцию
        missing.push(makeIssue('textSnapshot', 'Текст паспорта не собрался', 'Проверьте тексты и правила категории'));
      }
    }
    const effective = await this.effectiveImages(document, session);
    const installation = installs.get(String(document.installationTypeId ?? ''));
    const frozenStandard = previous?.reuseText && document.schemeSource !== 'own' ? previous.print.standardImages : undefined;
    const currentSchemes = hasCategory ? standardSchemes({ ...document, images: effective } as never, installation) : [];
    const standard = frozenStandard
      ? [
        ...frozenStandard.filter((s) => !effective.some((i) => i.kind === s.kind)).map((s) => ({ kind: String(s.kind), photoId: String(s.photoId), standard: true as const })),
        ...currentSchemes.filter((s) => !frozenStandard.some((row) => row.kind === s.kind)),
      ]
      : currentSchemes;
    const images = [...effective, ...standard];
    const priorReadiness = previous?.reuseText ? previous.print.readiness : undefined;
    const rules = priorReadiness
      ? { required: priorReadiness.requiredImages, slots: priorReadiness.imageSlots }
      : imageRules(document, cat, options());
    const old = { ...input, images };
    const snap = built?.text ?? savedText;
    const simple = built?.simple ?? simpleWithoutCategory;
    const partsIssue = simple?.source?.kind === 'parts' ? selectedPartsIssue(simple.source) : null;
    if (partsIssue) missing.push(partsIssue);
    if (savedText) document.textSnapshot = savedText;
    else if (snap) {
      const had = input.textSnapshot as (Snap & FieldSnap) | undefined;
      const next = { ...snap, sizeLayout: 2, drawingLayout: 2, at: new Date() };
      if (had?.sections && mode === 'instance') {
        const { sections, conflicts } = carryManual(had.sections as SnapshotSection[], next.sections);
        const fields = carryFields(had, { ...next, sections } as unknown as FieldSnap);
        if (conflicts.length || fields.conflicts.length) {
          missing.push(makeIssue('textSnapshot', 'Ручной текст конфликтует с изменившимся шаблоном', 'Перечитайте книжку и проверьте ручные правки'));
        } else Object.assign(next, fields.snap);
      }
      if (brief) next.description = snap.description;
      if (simple?.source) Object.assign(next, { simpleDescriptionSource: simple.source });
      document.textSnapshot = next;
      if (snap.purpose) document.purpose = snap.purpose;
      if (snap.install.text) document.installationMethod = snap.install.text;
    } else document.textSnapshot = null;
    if (simple || (!savedText && snap)) document.simpleDescriptionSource = simple?.source ?? null;
    if (brief) document.description = snap?.description ?? '';
    if (hasCategory) {
      const keep = (m: { key: string }) => {
        if (mode === 'template' && INSTANCE_FIELD_KEYS.includes(m.key)) return false;
        if (m.key === 'purpose' && document.purpose) return false;
        if (brief && shortDetailKeys.has(m.key)) return false;
        if (brief && m.key === 'elements' && document.purpose) return false;
        return true;
      };
      const listed = (savedText ? [] : missingKeyed({ ...document, images } as never, cat, options())).filter(keep);
      missing.push(...listed.map((m) => makeIssue(m.key, m.label)));
      if (brief && !snap?.description && !partsIssue) {
        const root = simple?.unresolvedRoot;
        missing.push(root
          ? makeIssue(`choice:${root.id}`, `Выбор: ${root.name}`)
          : makeIssue('simpleDescription', 'Краткое описание не определено', 'Карточка изделия → Паспорт → Добавьте фразу для изделия'));
      }
      if (!savedText && !installation && !listed.some((m) => m.key === 'installationTypeId')) missing.push(makeIssue('installationTypeId', 'Способ установки не найден'));
      for (const m of missingKeyed(old as never, cat, options())) {
        if (defaultFields.includes(m.key) && keep(m) && !listed.some((l) => l.key === m.key)) defaulted.push({ key: m.key, label: m.label });
      }
      if (defaultFields.includes('warrantyMonths') && !defaulted.some((m) => m.key === 'warrantyMonths')) defaulted.push({ key: 'warrantyMonths', label: 'Гарантия, мес.' });
      if (!oldInstall && installation && !built?.instLeaf?.installTypeId) defaulted.push({ key: 'installationTypeId', label: 'Способ установки' });
      if (snap && built) {
        const manual = (document.manualText as string[] | undefined) ?? [];
        const unresolved = missingChoices(built.resolved, (r) => {
          const o = overrideFor(document.textOverrides, r.id, r.section);
          return !!(o.off || o.text || (r.section === 'purpose' && (brief ? document.purpose : manual.includes('purpose'))) || (r.section === 'installation' && manual.includes('installationMethod')));
        });
        missing.push(...unresolved.map((m) => makeIssue(m.key, m.label)),
          ...blankItems(snap.missing).filter(keep),
          ...(snap.needJoints ? [makeIssue(JOINTS_MISSING.key, JOINTS_MISSING.label)] : []));
      }
      for (const kind of await unreadableRequiredImages(db, images, rules.required, session, previous?.print.photoUrls)) {
        const key = 'img_' + (kind === 'safety_zone' ? 'safety' : kind);
        if (!missing.some((m) => m.key === key)) missing.push(makeIssue(key, `${IMAGE_KIND_LABELS[kind] ?? kind}: файл на сервере повреждён или пропал — замените фото`));
      }
      if (brief && !document.materialsSpec && !document.materials && !(document.materialIds as unknown[] | undefined)?.length) {
        recommendations.push(makeIssue('materials', 'Материалы для полного паспорта'));
      }
    }
    const requiredImages = rules.required.map((k) => k === 'safety_zone' ? 'safety' : k);
    const readiness: PassportReadiness = {
      ready: missing.length === 0,
      missing: [...new Map(missing.map((m) => [m.key, m])).values()],
      recommendations, defaulted, requiredImages, imageSlots: rules.slots,
    };
    const imageIds = [...new Set([...own, ...images].map((i) => String(i.photoId)).filter((id) => Types.ObjectId.isValid(id)))];
    const frozenUrls = previous?.print.photoUrls ?? {};
    const newIds = imageIds.filter((id) => !frozenUrls[id]);
    const rows = newIds.length ? await db.collection('photos').find({ _id: { $in: newIds.map((id) => new Types.ObjectId(id)) }, deletedAt: null }, { session, projection: { storageUrl: 1 } }).toArray() : [];
    const urls = new Map([...Object.entries(frozenUrls), ...rows.map((r): [string, string] => [String(r._id), String(r.storageUrl ?? '')])]);
    const present = (row: PassportImageLike) => ({ ...row, photoId: String(row.photoId), url: urls.get(String(row.photoId)) ?? null });
    Object.assign(document, {
      images: own.map(present),
      effectiveImages: presentEffectiveImages(own, effective, urls).map((i) => ({ ...i, photoId: String(i.photoId) })),
      standardImages: standard.map((i) => present({ ...i })),
      requiredImages, imageSlots: rules.slots,
    });
    return {
      document, readiness, images, urls, install: options().install, categoryName: cat?.name,
      suggestions: simple?.suggestions ?? [],
    };
  }

  private async refreshRevisionPrint(doc: ProductPassportDocument, current: Doc, after: Doc, changed: string[], session?: ClientSession) {
    const print = current.printSnapshot as PassportPrintSources | undefined;
    const reuseText = !!print && !!current.textSnapshot && changed.every((key) => key === 'images');
    // В images при выпуске записываются и типовые схемы. Не считать их собственными при новой редакции.
    const priorSchemes = new Set((print?.standardImages ?? []).map((i) => `${i.kind}/${i.photoId}`));
    const images = ((after.images as PassportImageLike[]) ?? []).filter((i) => !priorSchemes.has(`${i.kind}/${i.photoId}`));
    const evaluated = await this.evaluatePresentation({ ...after, images }, 'instance', session, print ? { print, reuseText } : undefined);
    if (!evaluated.readiness.ready) throw new BadRequestException({ message: 'Проверьте данные новой редакции', missing: evaluated.readiness.missing });
    const sources = await this.printSources(evaluated, session, print, reuseText);
    doc.set({
      textSnapshot: evaluated.document.textSnapshot, images: evaluated.images, printSnapshot: sources,
      ...(evaluated.document.installationTypeId ? { installationTypeId: evaluated.document.installationTypeId } : {}),
    });
  }

  /** C172: подготовка внутри общей транзакции импорта, без самостоятельного save/commit. */
  async prepareImportedPassport(current: Doc, patch: Doc, session: ClientSession): Promise<Doc> {
    const doc = this.model.hydrate(copyPassportValue(current));
    doc.set(copyPassportValue(patch));
    const after = { ...current, ...patch };
    const fields = Object.keys(patch);
    if (current.presentationVersion === 1) {
      if (isIssued(current)) await this.refreshRevisionPrint(doc, current, after, fields, session);
      else {
        const evaluated = await this.evaluatePresentation(after, 'instance', session);
        if (evaluated.readiness.missing.some(m => m.key === 'textSnapshot')) throw new ConflictException('Не удалось пересобрать текст паспорта');
        doc.set('textSnapshot', evaluated.document.textSnapshot);
      }
    } else if (fields.some(k => k !== 'images') && after.passportCategory) {
      after.textSnapshot = { ...(current.textSnapshot as Snap ?? {}), sizeLayout: 2 };
      if ((current.textSnapshot as Snap | undefined)?.sections) await this.rebuildSafe(doc, after, session);
      else await this.applySnapshot(doc, after, session);
    }
    // Пересборка не должна менять нецелевые поля экземпляра.
    const prepared = doc.toObject({ minimize: false }) as unknown as Doc;
    return Object.fromEntries([...fields, 'textSnapshot', 'printSnapshot'].filter(k => prepared[k] !== undefined).map(k => [k, prepared[k]]));
  }

  private async getPresentation(raw: Doc) {
    const { printSnapshot, ...own } = raw;
    delete own.creationScopeKey;
    const draft = raw.status === 'draft';
    let bound: Doc = {}, bindingError: unknown;
    if (draft) {
      try {
        bound = await bindPresentation(this.connection.db!, raw);
        if (raw.incomeId) await assertOneLive(this.model, raw.incomeId, raw._id as Types.ObjectId);
      } catch (e) { bindingError = e; }
    }
    const evaluated = draft ? await this.evaluatePresentation({ ...own, ...bound, ...await this.fromProductDiff(raw) }, 'instance') : null;
    const readiness = evaluated?.readiness ?? (printSnapshot as { readiness?: PassportReadiness } | undefined)?.readiness;
    if (readiness && bindingError) addBindingBlocker(readiness, bindingError);
    const document = evaluated?.document ?? own;
    const frozenSource = (raw.textSnapshot as { simpleDescriptionSource?: SimpleDescriptionSource } | undefined)?.simpleDescriptionSource;
    const revisionList = await this.revisionList(raw);
    return {
      ...document, ...presentPrint(raw), fromProduct: draft && !!raw.productId,
      ...(!draft && frozenSource?.kind === 'parts' ? { simpleDescriptionSource: frozenSource } : {}),
      ...(revisionList.length ? { revisionList } : {}),
      ...(readiness ? { readiness, missing: readiness.missing.map((m) => m.label), requiredImages: readiness.requiredImages, imageSlots: readiness.imageSlots } : {}),
      ...(printSnapshot ? {
        effectiveImages: (printSnapshot as Doc).effectiveImages,
        standardImages: (printSnapshot as Doc).standardImages,
        supplierOrg: (printSnapshot as Doc).supplier,
      } : {}),
    };
  }

  private async preparePresentation(current: Doc, session: ClientSession) {
    let bound: Doc;
    try { bound = await bindPresentation(this.connection.db!, current, session); }
    catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
      const readiness: PassportReadiness = { ready: false, missing: [], recommendations: [], defaulted: [], requiredImages: [], imageSlots: [] };
      addBindingBlocker(readiness, e);
      throw new BadRequestException({ message: e.message, missing: readiness.missing });
    }
    const fromProduct = await this.fromProductDiff(current, session);
    const next = { ...current, ...bound, ...fromProduct };
    const evaluated = await this.evaluatePresentation(next, 'instance', session);
    if (!evaluated.readiness.ready) throw new BadRequestException({ message: 'Заполните недостающее перед выпуском', missing: evaluated.readiness.missing });
    const { document, images } = evaluated;
    const fields: Doc = { ...bound, ...fromProduct };
    for (const key of ['purpose', 'installationMethod', 'installationTypeId', 'serviceLifeYears', 'warrantyMonths', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'foundationDepth', 'seatsCount']) {
      if (document[key] !== undefined) fields[key] = document[key];
    }
    if (current.incomeId) fields.creationScopeKey = lineScopeKey(current.incomeId);
    return { ...fields, textSnapshot: document.textSnapshot, images, printSnapshot: await this.printSources(evaluated, session) };
  }

  private async printSources(evaluated: Awaited<ReturnType<ProductPassportService['evaluatePresentation']>>, session?: ClientSession, previous?: PassportPrintSources, reuseStyle = false): Promise<PassportPrintSources> {
    const { document, urls, readiness, install, categoryName } = evaluated;
    const db = this.connection.db!;
    const snapshot = document.textSnapshot as { traits?: string[]; unknownTraits?: string[]; maintenance?: Array<{ rows: Array<{ photoId?: string }> }> } | null;
    const otherPhotoIds = [...(snapshot?.maintenance ?? []).flatMap((m) => m.rows.map((r) => r.photoId)), ...(!isBriefPresentation(document) ? ((document.modules as Array<{ photoId?: string }>) ?? []).map((m) => m.photoId) : [])];
    const extra = [...new Set(otherPhotoIds.filter((id): id is string => !!id && Types.ObjectId.isValid(id) && !urls.has(id)))];
    const rows = extra.length ? await db.collection('photos').find({ _id: { $in: extra.map((id) => new Types.ObjectId(id)) }, deletedAt: null }, { session, projection: { storageUrl: 1 } }).toArray() : [];
    for (const row of rows) urls.set(String(row._id), String(row.storageUrl ?? ''));
    const images = { effectiveImages: document.effectiveImages as Doc[], standardImages: document.standardImages as Doc[], photoUrls: Object.fromEntries(urls) };
    if (previous && reuseStyle) return { ...previous, ...images, readiness, install };
    const companyId = document.supplierOrgId ? this.oid(document.supplierOrgId) : null;
    const company = companyId ? await db.collection('organizations').findOne({ _id: companyId, deletedAt: null, isOurCompany: true }, { session }) : null;
    const orgFields = ['name', 'shortName', 'fullName', 'inn', 'kpp', 'phone', 'email', 'trademark', 'directorName', 'signerName', 'signerPosition'];
    const org = company ? Object.fromEntries(orgFields.filter((k) => company[k] !== undefined).map((k) => [k, String(company[k] ?? '')])) : null;
    const assets: Record<string, string> = {};
    for (const { role, storageUrl } of (company?.assets ?? []) as Array<{ role: string; storageUrl: string }>) {
      if (['logo', 'seal', 'signature'].includes(role) && typeof storageUrl === 'string') assets[role] ??= storageUrl;
    }
    const look = companyId ? await db.collection('passportlooks').findOne({ companyId }, { session }) as LookDoc | null : null;
    const styleRows = await db.collection('dict_values').find({ dict: 'passportStyle', deletedAt: null }, { session }).toArray();
    const style = resolveStyle(styleRows as never, String(document.passportCategory ?? ''), {
      maxUsers: document.maxUsers as number | undefined, traits: snapshot?.traits ?? [], unknownTraits: snapshot?.unknownTraits ?? [],
    });
    return {
      ...images, readiness, install,
      supplier: company ? { id: String(company._id), name: String(company.name ?? ''), hasSeal: !!assets.seal, hasSignature: !!assets.signature } : null,
      org, assets, style: { ...style, categoryName }, look,
    };
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
  private async buildText(p: Doc, usedFields?: Set<string>, session?: ClientSession) {
    if (!p.passportCategory) return null;
    applyCategoryDefaults(p, (await this.categoryRules(session)).get(String(p.passportCategory))); // C112 А1: умолчание типа — заполнено (в изделие не пишется)
    // v2: общая часть — тексты v2 из кода (шаблон «Для всех» в базе остаётся для PDF v1); версия категории — из базы, иначе из кода
    const cat = String(p.passportCategory);
    const { own: dbOwn } = await this.templatesFor(cat, session);
    const all = await this.v2All(session);
    const code = PASSPORT_TEXTS_V2[cat as keyof typeof PASSPORT_TEXTS_V2];
    const own = dbOwn ?? (code ? { ...code, version: 0 } : null);
    const { dict: standards } = await this.standards(session);
    const dv = this.connection.collection('dict_values');
    const load = (d: string) => { const make = () => dv.find({ dict: d, deletedAt: null }, { session }).toArray() as unknown as Promise<DictRec[]>; return session ? make() : this.dictCached('passports.dict', make, d); };
    const [elements, materials, defects, install] = await Promise.all([load('passportElements'), load('passportMaterials'), load('passportDefects'), load('passportInstall')]);
    // воронка (ПВ): выбор по разделам; вариант раздела «Установка» сам ставит способ установки (схемы, рисунки, основание — в нём)
    const product = await this.productCtx(p.productId, p.presentationVersion === 1 ? String(p.kindId ?? '') : undefined, false, session);
    const allRoots = await this.forest(cat, session);
    const applicableForest = forProduct(allRoots, product); // тексты, привязанные к чужим признакам, изделию не идут
    const forest = printPhraseRoots(applicableForest, isBriefPresentation(p));
    const simple = p.presentationVersion === 1 ? await this.resolveSimpleText(p, await this.simpleChoices(allRoots, product, session), applicableForest, session) : null;
    const resolved = resolveChoices(forest, p.textChoices as Record<string, string> | undefined, product);
    const instRoot = forest.find((r) => r.section === 'installation');
    const instLeaf = instRoot ? resolved.leaves.get(instRoot.id)?.leaf : undefined;
    if (instLeaf?.installTypeId) p.installationTypeId = new Types.ObjectId(instLeaf.installTypeId);
    const text = buildV2Text({ passport: p, all, own, standards, usedFields, dicts: { elements, materials, defects, install }, funnel: { forest, choices: p.textChoices as Record<string, string> | undefined, product } });
    return { text, instLeaf, resolved, simple };
  }

  private async simpleChoices(roots: PhraseTreeNode[], context?: ProductCtx, session?: ClientSession) {
    const ids = simpleFacetIds(roots);
    if (!context || !ids.length) return forProduct(roots, context);
    const all = [...new Set([...ids, ...context.facetValueIds])].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const rows = await this.connection.collection('dict_values').find({
      dict: 'productFacetValues', deletedAt: null, _id: { $in: all },
    }, { session, projection: { parentId: 1 } }).toArray();
    return simpleChoiceForest(roots, context, new Map(rows.filter((r) => r.parentId).map((r) => [String(r._id), String(r.parentId)])));
  }

  private async resolveSimpleText(p: Doc, forest: PhraseTreeNode[], autoForest = forest, session?: ClientSession): Promise<{
    source: SimpleDescriptionSource | null;
    suggestions: ReturnType<typeof simpleDescriptionSuggestions>;
    unresolvedRoot: PhraseTreeNode | null;
  }> {
    const options = simpleDescriptionSuggestions(forest);
    const own = p.simpleDescription as SimpleDescription<Types.ObjectId | string> | undefined;
    const partIds = own?.mode === 'parts' && isBriefPresentation(p) ? [...new Set((own.partIds ?? []).map(String))] : null;
    const ids = [...new Set([...(partIds ?? []), ...options.filter((o) => o.text.includes('{parts}')).flatMap((o) => o.partIds)])]
      .filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const rows = ids.length ? await this.connection.collection('dict_values').find({
      _id: { $in: ids }, dict: 'passportParts', deletedAt: null,
    }, { session, projection: { name: 1, genPlural: 1, genSingular: 1 } }).toArray() : [];
    const parts = new Map(rows.map((row) => [String(row._id), { name: row.name, genPlural: row.genPlural, genSingular: row.genSingular }]));
    const suggestions = options.map((o) => ({ ...o, text: renderSimplePhrase(o.text, o.partIds, parts) })).filter((o) => o.text);
    if (partIds) {
      const { text, invalidPartIds } = renderSelectedParts(partIds, parts);
      p.simpleDescription = { mode: 'parts', partIds, text };
      return {
        source: { kind: 'parts', partIds, text, ...(invalidPartIds.length ? { invalidPartIds } : {}) },
        suggestions, unresolvedRoot: null,
      };
    }
    if (own?.mode !== 'parts' && own?.text?.trim()) return { source: { kind: 'own', partIds: (own.partIds ?? []).map(String) }, suggestions, unresolvedRoot: null };
    const choices = p.textChoices as Record<string, string> | undefined;
    const hasExplicit = forest.some((r) => r.section === 'simple-description' && choices?.[r.id]);
    const selected = selectSimpleDescription(hasExplicit ? forest : autoForest, choices);
    const option = selected ? suggestions.find((o) => o.id === selected.leaf.id) : null;
    if (!option) return { source: null, suggestions, unresolvedRoot: forest.find((r) => suggestions.some((s) => s.rootId === r.id)) ?? null };
    if (isBriefPresentation(p)) p.simpleDescription = { text: option.text, partIds: option.partIds };
    return { source: { kind: 'dictionary', id: option.id, rootId: option.rootId, partIds: option.partIds }, suggestions, unresolvedRoot: null };
  }

  /**
   * Проверка черновика формы (ФП): чего не хватает для выпуска — те же правила, что у сохранённого паспорта
   * (категория, справочник, стандартные схемы способа установки). Ничего не пишет.
   */
  async check(body: Record<string, unknown>, usedFields?: Set<string>) {
    if (body.presentationVersion !== undefined && body.presentationVersion !== 1) throw new BadRequestException('presentationVersion: неизвестная версия паспорта');
    if (body.presentationVersion === 1 || body.passportId !== undefined) return this.checkPresentation(body);
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
    // C112 А0-рис: способ установки — из раздела «Установка» текстов, иначе изделия, иначе умолчание типа; только потом схемы
    const built = p.passportCategory ? await this.buildText({ ...p }, usedFields).catch(() => null) : null;
    if (built?.instLeaf?.installTypeId) p.installationTypeId = new Types.ObjectId(built.instLeaf.installTypeId);
    this.defaultInstall(p, inst);
    const full0 = this.withSchemes(p, inst);
    // C112 А1: умолчания типа паспорта считаются заполненными; что они закрыли — в `defaulted` (для экрана «чего не хватает»)
    const full = { ...full0 } as Doc;
    const usedDefaults = applyCategoryDefaults(full, cat);
    const vopts = { variant: variantOf(body.variant), install: installKindOf(inst.get(String(p.installationTypeId ?? ''))) };
    const rules = imageRules(p as never, cat, { category: String(p.passportCategory ?? ''), ...vopts });
    const choices = await this.choiceMissing({ passportCategory: p.passportCategory, textChoices: parseChoices(p.textChoices), textOverrides: p.textOverrides, manualText: p.manualText });
    const noHint = (m: { label: string; key: string; hint?: string }) => ({ ...m, hint: m.hint ?? missingHint(m.key, m.label) });
    const keep = (m: { key: string; label: string }) => !(template && (INSTANCE_FIELD_KEYS.includes(m.key) || m.label === 'Дата' || m.label === 'Фирма'));
    const blanks = blankItems(built?.text.missing ?? []);
    // C086: назначение, выбранное в текстах (раздел «Назначение»), и есть назначение паспорта — не требовать его второй раз через «Элементы»
    const purposeDone = !!String(built?.text.purpose ?? '').trim();
    const listed = missingKeyed(full as never, cat, vopts).filter((m) => !(purposeDone && m.key === 'purpose'));
    const defaulted = usedDefaults.length ? missingKeyed(full0 as never, cat, vopts).filter((m) => usedDefaults.includes(m.key) && !listed.some((l) => l.key === m.key)).filter(keep) : [];
    const broken = await unreadableRequiredImages(this.connection.db!, (full.images ?? []) as Array<{ kind?: unknown; photoId?: unknown }>, rules.required);
    for (const kind of broken) {
      const key = 'img_' + (kind === 'safety_zone' ? 'safety' : kind);
      // язык менеджера: не «не читается», а что делать
      if (!listed.some((m) => m.key === key)) listed.push({ key, label: `${IMAGE_KIND_LABELS[kind] ?? kind}: файл на сервере повреждён или пропал — замените фото` });
    }
    const extra = blanks.filter((b) => !listed.some((m) => m.key === b.key));
    return { mode: template ? 'template' : 'instance', missing: [...listed, ...extra, ...choices, ...(built?.text.needJoints ? [JOINTS_MISSING] : [])].filter(keep).map(noHint), defaulted, requiredImages: rules.required.map((k) => (k === 'safety_zone' ? 'safety' : k)), imageSlots: rules.slots };
  }

  private async checkPresentation(body: Doc) {
    if (body.variant !== undefined && !PASSPORT_VARIANTS.includes(body.variant as PassportVariant)) throw new BadRequestException('variant: выберите краткий или полный вариант');
    if (body.mode !== undefined && body.mode !== 'instance' && body.mode !== 'template') throw new BadRequestException('mode: неизвестный режим паспорта');
    if (body.passportId !== undefined) {
      const id = String(body.passportId ?? '');
      const existing = (await this.findById(id)).toObject() as unknown as Doc;
      for (const key of ['productId', 'incomeId', 'salesOrderId', 'supplierOrgId', 'presentationVersion', 'variant']) {
        if (body[key] !== undefined && String(body[key]) !== String(existing[key])) throw new ConflictException(`${key}: настройки паспорта изменились — перечитайте книжку`);
      }
      if (body.mode === 'template') throw new BadRequestException('Паспорт экземпляра проверяется в режиме instance');
      if (existing.presentationVersion !== 1) {
        const missing = await this.readiness(existing);
        const { requiredImages, imageSlots } = await this.get(id, { readOnly: true });
        return { mode: 'instance', missing: missing.map((m) => ({ ...m, hint: missingHint(m.key, m.label) })), defaulted: [], requiredImages, imageSlots };
      }
      const card = await this.getPresentation(existing);
      return { mode: 'instance', ...(card.readiness as PassportReadiness), presentationVersion: 1, variant: existing.variant };
    }
    if (body.mode === 'instance') throw new BadRequestException('Для проверки экземпляра укажите passportId');
    const r = await this.passportTemplate(String(body.productId ?? ''), variantOf(body.variant));
    return { mode: r.mode, ...r.readiness, presentationVersion: 1, variant: r.variant };
  }

  /** ПП: чего не хватает для выпуска сохранённого паспорта — [{ label, key }] (стандартные схемы способа установки засчитываются). */
  async readiness(doc: Doc, session?: ClientSession): Promise<Array<{ label: string; key: string }>> {
    const [cats, inst] = await Promise.all([this.categoryRules(session), this.installs(session)]);
    doc = { ...doc, images: await this.effectiveImages(doc, session) };
    this.defaultInstall(doc, inst);
    const cat = cats.get(String(doc.passportCategory ?? '')) ?? null;
    const full = this.withSchemes(doc, inst);
    applyCategoryDefaults(full as Doc, cat); // C112 А1: умолчание типа паспорта — заполнено (копия, в паспорт не пишется)
    const ctx = { category: String(doc.passportCategory ?? ''), variant: 'short' as const, install: installKindOf(inst.get(String(doc.installationTypeId ?? ''))) };
    const missing = [...missingKeyed(full as never, cat, ctx), ...(await this.choiceMissing(doc, session)), ...jointsMissing(doc)];
    const required = imageRules(full, cat, ctx).required;
    const broken = await unreadableRequiredImages(this.connection.db!, (full.images ?? []) as Array<{ kind?: unknown; photoId?: unknown }>, required, session);
    for (const kind of broken) {
      const key = 'img_' + (kind === 'safety_zone' ? 'safety' : kind);
      if (!missing.some((m) => m.key === key)) missing.push({ key, label: `${IMAGE_KIND_LABELS[kind] ?? kind}: файл на сервере повреждён или пропал — замените фото` });
    }
    return missing;
  }

  /** Рисунки изделия «для паспорта» (productphotos purpose:'passport'), по порядку; удалённые не берутся. */
  async productImageRows(productId: string, session?: ClientSession): Promise<ProductImageRow[]> {
    return this.connection.collection('productphotos').find({ productId: new Types.ObjectId(productId), purpose: 'passport', deletedAt: null }, { ...(session ? { session } : {}), projection: { kind: 1, photoId: 1, sortOrder: 1, caption: 1 } }).sort({ sortOrder: 1, createdAt: 1 }).toArray() as Promise<ProductImageRow[]>;
  }

  /**
   * Рисунки паспорта для проверки и печати: у черновика с изделием — рисунки изделия по видам, остальные виды из images[];
   * у выпущенного и аннулированного — только его images[] (замороженные при выпуске).
   */
  async effectiveImages(doc: Doc, session?: ClientSession): Promise<Doc[]> {
    const own = ((doc.images as Doc[]) || []);
    if (isIssued(doc) || doc.status === 'annulled' || !doc.productId) return own;
    return mergeProductImages(await this.productImageRows(String(doc.productId), session), own as PassportImageLike[]) as Doc[];
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
  private async productCtx(productId: unknown, kindId?: string, resolveProductKind = false, session?: ClientSession): Promise<ProductCtx | undefined> {
    if (!productId || !Types.ObjectId.isValid(String(productId))) return undefined;
    const db = this.connection.db!;
    const prod = await db.collection('products').findOne({ _id: new Types.ObjectId(String(productId)), ...(resolveProductKind ? { deletedAt: null } : {}) }, { session, projection: { facetValueIds: 1, categoryId: 1, ...(resolveProductKind ? { passportDefaults: 1 } : {}) } });
    if (!prod) return undefined;
    const resolved = resolveProductKind ? (await resolveKind(db, prod)).kind?.id : kindId;
    const groupIds = new Set<string>();
    if (session) {
      for (let id = String(prod.categoryId ?? ''); Types.ObjectId.isValid(id) && !groupIds.has(id); ) {
        groupIds.add(id);
        const group = await db.collection('categories').findOne({ _id: new Types.ObjectId(id) }, { session, projection: { parentId: 1 } });
        id = String(group?.parentId ?? '');
      }
    }
    return { facetValueIds: new Set(((prod.facetValueIds as unknown[]) ?? []).map(String)), groupIds: session ? groupIds : await groupChain(db, prod.categoryId), ...(resolved ? { kindId: resolved } : {}) };
  }

  /** Дерево текстов, видимое категории (без категории — всё): один расчёт, пока не менялся dict_values. Общий результат — не менять. */
  async forest(category?: string, session?: ClientSession): Promise<PhraseTreeNode[]> {
    const cat = String(category ?? '').trim();
    const make = async () => buildForest((await this.connection.collection('dict_values').find({ dict: 'passportPhrases', deletedAt: null }, { session }).toArray()).map((r) => toNode(r)), cat || undefined);
    return !session && this.versions ? this.versions.cached('passports.funnel', ['dict_values'], cat, make) : make();
  }

  /** GET passports/funnel?category=TRN&productId= → { sections: [раздел → варианты → подварианты → текст] }; с изделием — без текстов чужих признаков. */
  async funnel(category?: string, productId?: string, presentation?: PassportVariant) {
    const allRoots = await this.forest(category);
    const context = await this.productCtx(productId, undefined, !!presentation);
    const forest = forProduct(allRoots, context);
    const roots = printPhraseRoots(forest, presentation === 'short');
    if (presentation === 'short') {
      const choiceRoots = await this.simpleChoices(allRoots, context);
      const simple = await this.resolveSimpleText({}, choiceRoots, forest);
      const texts = new Map(simple.suggestions.map((leaf) => [leaf.id, leaf.text]));
      const withText = (node: PhraseTreeNode): PhraseTreeNode | null => {
        const { children } = node;
        if (!children.length) return texts.has(node.id) ? { ...node, text: texts.get(node.id)! } : null;
        const available = children.map(withText).filter((n): n is PhraseTreeNode => !!n);
        return available.length ? { ...node, children: available } : null;
      };
      for (const root of choiceRoots.filter((r) => r.section === 'simple-description')) {
        const available = withText(root);
        if (available) roots.push(available);
      }
    }
    const sections = presentForest(roots);
    // C100: назначение из вида изделия — вариант «по умолчанию» этого изделия: шаг подставляет его сам, как в PDF (kindPatch)
    const pick = productId ? await this.kindPurpose(productId) : null;
    if (pick) for (const r of sections as Array<Record<string, unknown>>) if (r.id === pick.root) for (const c of r.children as Array<Record<string, unknown>>) c.isDefault = c.id === pick.leaf;
    return { sections };
  }

  /** Лист «Назначения» из вида изделия, если своего выбора нет: { root, leaf } или null. */
  private async kindPurpose(productId: string): Promise<{ root: string; leaf: string } | null> {
    if (!Types.ObjectId.isValid(productId)) return null;
    const db = this.connection.db!;
    const prod = await db.collection('products').findOne({ _id: new Types.ObjectId(productId), deletedAt: null });
    if (!prod) return null;
    const patch = await kindPatch(db, prod, await resolveKind(db, prod));
    const root = await purposeRootId(db);
    const leaf = root ? patch.textChoices?.[root] : undefined;
    return root && leaf ? { root, leaf } : null;
  }

  /** GET passports/funnel?category=&group=&f=&q= → шаги воронки создания паспорта (категория → группа → признаки) и изделия (C028, A2). */
  productFunnel(q: Record<string, unknown>) { return productFunnel(this.connection.db!, q); }

  /** GET showcase/:id/passport-gaps → чего не хватает изделию для паспорта (C028, A3). */
  gaps(productId: string) { return productGaps(this, this.connection.db!, productId); }

  /** GET showcase/:id/fill-queue → «заполнено N из M» и очередь «что заполнить первым» (C114 J; паспорт + материалы/части техописания). */
  async fillQueue(productId: string) {
    const db = this.connection.db!;
    const g = await productGaps(this, db, productId);
    return buildFillQueue({ gaps: g.missing, withTechsheet: true, ...(await loadFillContext(db, productId)) });
  }

  /** GET showcase/:id/techsheet-gaps → чего не хватает техописанию (C114 D-S): { ready, missing[] }. */
  techsheetGaps(productId: string) { return productTechGaps(this.connection.db!, productId); }

  /** GET showcase/:id/techsheet-analogs → похожие изделия группы с таблицей материалов и частые фразы назначения/монтажа (C114). */
  techsheetAnalogs(productId: string) { return productTechAnalogs(this.connection.db!, productId); }

  /** Обязательные разделы воронки без выбора → [{ label, key: 'choice:<id раздела>' }]; текст, набранный вручную, раздел закрывает. */
  private async choiceMissing(d: Doc, session?: ClientSession): Promise<Array<{ label: string; key: string }>> {
    if (!d.passportCategory) return [];
    return choiceMissingIn(forProduct(await this.forest(String(d.passportCategory), session), await this.productCtx(d.productId, undefined, false, session)), d);
  }

  /** Способы установки (справочник) по id — для стандартных схем узлов (Э9.5). */
  async installs(session?: ClientSession) {
    const make = async () => new Map((await this.connection.collection('dict_values').find({ dict: 'passportInstall', deletedAt: null }, { session }).toArray()).map((d) => [String(d._id), d as Record<string, unknown>]));
    return session ? make() : this.dictCached('passports.installs', make);
  }

  /** Р7/Р8 (C112): справочник из dict_values — один расчёт, пока он не менялся (общий результат, не менять). */
  private dictCached<T>(scope: string, make: () => Promise<T>, extra = ''): Promise<T> {
    return this.versions ? this.versions.cached(scope, ['dict_values'], extra, make) : make();
  }

  /** C112: нет способа установки — умолчание типа паспорта (DEFAULT_INSTALL), чтобы стандартные схемы засчитались. */
  private defaultInstall(d: Doc, inst: Map<string, Record<string, unknown>>) {
    if (d.installationTypeId && inst.has(String(d.installationTypeId))) return;
    const code = DEFAULT_INSTALL[String(d.passportCategory ?? '')];
    if (!code) return;
    for (const [id, rec] of inst) if (String(rec.code ?? '') === code) { d.installationTypeId = new Types.ObjectId(id); return; }
  }

  private withSchemes(d: Doc, inst: Map<string, Record<string, unknown>>) {
    if (!d.passportCategory) return d;
    const std = standardSchemes(d as never, inst.get(String(d.installationTypeId ?? '')) ?? null);
    return std.length ? { ...d, images: [...((d.images as unknown[]) || []), ...std] } : d;
  }

  /** Справочник типов паспортов (v2): код → обязательные рисунки и прочее. Пусто — паспорта v1 проверяются как раньше. */
  async categoryRules(session?: ClientSession) {
    const make = async () => {
      const docs = await this.connection.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { session, projection: { code: 1, name: 1, requiredImages: 1, requiredFields: 1, serviceLifeYears: 1, warrantyMonths: 1, standards: 1, fieldDefaults: 1 } }).toArray();
      return new Map(docs.map((d) => [String(d.code), d as { name?: string; requiredImages?: string; requiredFields?: string; serviceLifeYears?: string; warrantyMonths?: string; standards?: string; fieldDefaults?: string }]));
    };
    return session ? make() : this.dictCached('passports.categoryRules', make);
  }

  /** Нормативы для {std:КОД} (справочник «Паспорта → Нормативы», dict_values) — словарь и записи для предупреждений. */
  async standards(session?: ClientSession) {
    const make = async () => {
      const docs = (await this.connection.collection('dict_values').find({ dict: 'passportStandards', deletedAt: null }, { session, projection: { code: 1, name: 1, status: 1, checkedAt: 1 } }).toArray()) as StandardDoc[];
      return { dict: standardsDict(docs), docs };
    };
    return session ? make() : this.dictCached('passports.standards', make);
  }

  /** Для сборщика текста: версия «Для всех» и версия категории (null, если своей нет). */
  async templatesFor(category?: string, session?: ClientSession) {
    const cat = normalizeCategory(category);
    const all = await this.template('ALL', session);
    const own = cat === 'ALL' ? null : await this.ownDoc(cat, session);
    return { all, own: own ? { version: own.version, category: cat, id: String(own._id), sections: own.sections, tables: own.tables } : null };
  }

  /** Правка шаблона — новая версия в пределах категории, прежняя остаётся в истории. */
  async saveTemplate(body: Partial<PassportTemplateContent> & { category?: string; materialsSpec?: unknown }, userId?: string, expectedId?: string | null, expectedAll?: number) {
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
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // Счётчик сериализует также создание первой версии категории.
        await this.connection.collection('counters').updateOne({ entity: 'passport-template-write', prefix: 'texts', year: 0 }, { $inc: { seq: 1 } }, { upsert: true, session });
        const current = await this.templates.findOne({ isActive: true, ...same }).sort({ version: -1 }).session(session).lean().exec();
        if (expectedAll !== undefined) {
          const all = await this.templates.findOne({ isActive: true, category: ALL_V2 }).sort({ version: -1 }).session(session).lean().exec();
          if ((all?.version ?? 0) !== expectedAll) throw new ConflictException('Общие тексты изменены — подтвердите сохранение заново');
        }
        const expected = expectedId === undefined ? (own ? String(own._id) : null) : expectedId;
        if ((current ? String(current._id) : null) !== expected) throw new ConflictException('Тексты категории изменены — подтвердите сохранение заново');
        await this.templates.updateMany({ isActive: true, ...same }, { $set: { isActive: false } }, { session }).exec();
        await this.templates.create([{ version: (own?.version ?? 0) + 1, isActive: true, ...(cat === 'ALL' ? {} : { category: cat }), sections, tables, ...(spec ? { materialsSpec: spec } : {}), ...(userId && Types.ObjectId.isValid(userId) ? { updatedBy: new Types.ObjectId(userId) } : {}) }], { session });
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException('Тексты категории изменены — подтвердите сохранение заново');
      throw err;
    } finally { await session.endSession(); }
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
  private async v2All(session?: ClientSession) {
    const db = await this.templates.findOne({ isActive: true, category: ALL_V2 }).sort({ version: -1 }).session(session ?? null).lean().exec();
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
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          await this.connection.collection('counters').updateOne({ entity: 'passport-template-write', prefix: 'texts', year: 0 }, { $inc: { seq: 1 } }, { upsert: true, session });
          const current = await this.templates.findOne({ category: ALL_V2 }).sort({ version: -1 }).session(session).lean().exec();
          if (String(current?._id ?? '') !== String(last?._id ?? '')) throw new ConflictException('Общие тексты изменены — откройте редактор заново');
          await this.templates.updateMany({ isActive: true, category: ALL_V2 }, { $set: { isActive: false } }, { session }).exec();
          await this.templates.create([{ version: (last?.version ?? 0) + 1, isActive: true, category: ALL_V2, sections, tables: cur.tables, ...(userId && Types.ObjectId.isValid(userId) ? { updatedBy: new Types.ObjectId(userId) } : {}) }], { session });
        });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) throw new ConflictException('Общие тексты изменены — откройте редактор заново');
        throw err;
      } finally { await session.endSession(); }
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
