import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Material, MaterialDocument } from './material.schema';
import { CounterService } from '../counter/counter.service';
import { Category, CategoryDocument } from '../category/category.schema';
import { CatalogGraphService } from '../catalog-graph/catalog-graph.service';
import { CompositionLineService } from '../catalog/composition-line.service';
import { CreateCompositionLineDto, UpdateCompositionLineDto } from '../catalog/composition-line.dto';
import { CompositionLineDocumentShape } from '../catalog/composition-line.schema';
import { blankMissingUploadUrls } from '../document-render/document-render.utils';

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name);
  private readonly compositionLines: CompositionLineService;

  constructor(
    @InjectModel(Material.name) private readonly model: Model<MaterialDocument>,
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    private readonly counter: CounterService,
    private readonly catalogGraph: CatalogGraphService,
    @Optional() compositionLines: CompositionLineService | undefined,
  ) {
    this.compositionLines = compositionLines ?? new CompositionLineService();
  }

  async create(dto: CreateMaterialDto, organizationId?: string | null): Promise<MaterialDocument> {
    this.assertUniqueDimensionTypes(dto.dimensions);
    const article = this.normalizeRequiredArticle(dto.article);
    let sku = dto.sku;
    const category = dto.categoryId ? await this.loadAssignableMaterialCategory(dto.categoryId, organizationId) : null;
    if (!sku && category) {
      if (!category.skuPrefix) throw new BadRequestException(`У категории «${category.name}» не настроен префикс внутреннего кода материала`);
      sku = await this.counter.next('Material', category.skuPrefix);
    }
    const colors = this.normalizeColors(dto.colors);
    try {
      return await this.model.create({
        ...dto,
        article,
        sku,
        ...(colors !== undefined ? { colors } : {}),
        ...this.organizationWrite(organizationId),
      });
    } catch (err) {
      this.rethrowDuplicate(err);
    }
  }

  async findAll(q: { page?: number; limit?: number; search?: string; categoryId?: string; supplierId?: string; materialKind?: CreateMaterialDto['materialKind'] } = {}, organizationId?: string | null) {
    const page = Math.max(1, q.page ?? 1); const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const filter: Record<string, unknown> = { deletedAt: null, ...this.organizationFilter(organizationId) };
    if (q.search) { const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const re = new RegExp(escaped, 'i'); filter.$or = [{ name: re }, { article: re }, { sku: re }]; }
    // TZ-SUPPLY-320: legacy rows store `categoryId` as a plain string (the audit
    // plugin's `setUpdate()` in pre('findOneAndUpdate') replaces the already-cast
    // update, so PATCH persisted the raw string). Matching both shapes keeps
    // `?categoryId=` from silently returning 0 items for real assignments.
    if (q.categoryId) filter.categoryId = { $in: [new Types.ObjectId(q.categoryId), q.categoryId] };
    if (q.supplierId) filter.supplierId = { $in: [new Types.ObjectId(q.supplierId), q.supplierId] };
    if (q.materialKind) filter.materialKind = q.materialKind;
    const [items, total] = await Promise.all([
      this.model.find(filter).populate('categoryId').populate('photoIds').populate('mainPhotoId').populate('supplierId').sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    // TZ-NX-DOCSTUDIO-VITRINA-PHOTO-BROKEN-IMG: same orphan-reference guard as
    // ProductService.findAll, applied to both photoIds and the populated
    // mainPhotoId (material list — unlike product — populates it directly).
    await blankMissingUploadUrls([
      ...items.flatMap((item) => (Array.isArray(item.photoIds) ? (item.photoIds as Array<{ storageUrl?: unknown }>) : [])),
      ...items.map((item) => item.mainPhotoId as { storageUrl?: unknown } | undefined),
    ]);
    return { items, total, page, limit };
  }

  async getWhereUsed(id: string, options: { page?: number; limit?: number; organizationId?: string | null } = {}) { return this.catalogGraph.getWhereUsed('material', id, options); }

  /** Деталь BOM (TZ-NX-DETAIL-MATERIAL-BOM). Only meaningful for materialKind='part' rows. */
  async getComposition(id: string, organizationId?: string | null): Promise<CompositionLineDocumentShape[]> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Material ${id} not found`);
    const raw = await this.model
      .findOne({ _id: new Types.ObjectId(id), deletedAt: null, ...this.organizationFilter(organizationId) })
      .select('composition')
      .lean()
      .exec();
    if (!raw) throw new NotFoundException(`Material ${id} not found`);
    return (raw.composition ?? []) as unknown as CompositionLineDocumentShape[];
  }

  async addComposition(
    id: string,
    dto: CreateCompositionLineDto,
    organizationId?: string | null,
  ): Promise<CompositionLineDocumentShape[]> {
    const doc = await this.findById(id, organizationId);
    const incoming = this.compositionLines.toStoredLine(dto);
    await this.compositionLines.validateReference('material', incoming, { materialModel: this.model });
    const raw = ((doc.composition ?? []) as unknown as CompositionLineDocumentShape[]).map((line) =>
      this.plainCompositionLine(line),
    );
    const next = this.compositionLines.upsertDeduplicated(raw, incoming);
    this.compositionLines.ensureLineLimit(next);
    const saved = await this.model
      .findOneAndUpdate(
        { ...this.versionedCompositionFilter(doc), ...this.organizationFilter(organizationId) },
        { $set: { composition: next }, $inc: { __v: 1 } },
        { new: true, runValidators: true },
      )
      .exec();
    if (!saved) throw new ConflictException(`Material ${id} changed while composition was being updated`);
    return saved.composition as unknown as CompositionLineDocumentShape[];
  }

  async updateComposition(
    id: string,
    lineId: string,
    dto: UpdateCompositionLineDto,
    organizationId?: string | null,
  ): Promise<CompositionLineDocumentShape[]> {
    if (!Types.ObjectId.isValid(lineId)) throw new BadRequestException('Invalid composition line id');
    const doc = await this.findById(id, organizationId);
    const raw = ((doc.composition ?? []) as unknown as CompositionLineDocumentShape[]).map((line) =>
      this.plainCompositionLine(line),
    );
    const index = raw.findIndex((line) => line._id.toString() === lineId);
    if (index < 0) throw new NotFoundException(`Composition line ${lineId} not found`);
    const updated = this.compositionLines.toStoredLine(dto, raw[index]);
    await this.compositionLines.validateReference('material', updated, { materialModel: this.model });
    const next = raw.slice();
    next[index] = updated;
    this.compositionLines.ensureNoDuplicateKeys(next);
    const saved = await this.model
      .findOneAndUpdate(
        { ...this.versionedCompositionFilter(doc), ...this.organizationFilter(organizationId) },
        { $set: { composition: next }, $inc: { __v: 1 } },
        { new: true, runValidators: true },
      )
      .exec();
    if (!saved) throw new ConflictException(`Material ${id} changed while composition was being updated`);
    return saved.composition as unknown as CompositionLineDocumentShape[];
  }

  async removeComposition(id: string, lineId: string, organizationId?: string | null): Promise<void> {
    if (!Types.ObjectId.isValid(lineId)) throw new BadRequestException('Invalid composition line id');
    const doc = await this.findById(id, organizationId);
    const raw = ((doc.composition ?? []) as unknown as CompositionLineDocumentShape[]).map((line) =>
      this.plainCompositionLine(line),
    );
    const next = raw.filter((line) => line._id.toString() !== lineId);
    if (next.length === raw.length) throw new NotFoundException(`Composition line ${lineId} not found`);
    const saved = await this.model
      .findOneAndUpdate(
        { ...this.versionedCompositionFilter(doc), ...this.organizationFilter(organizationId) },
        { $set: { composition: next }, $inc: { __v: 1 } },
        { new: true, runValidators: true },
      )
      .exec();
    if (!saved) throw new ConflictException(`Material ${id} changed while composition was being updated`);
  }

  async findById(id: string, organizationId?: string | null): Promise<MaterialDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Material ${id} not found`);
    const doc = organizationId
      ? await this.model.findOne({ _id: new Types.ObjectId(id), deletedAt: null, ...this.organizationFilter(organizationId) }).populate('categoryId').populate('photoIds').populate('mainPhotoId').populate('supplierId').exec()
      : await this.model.findById(id).populate('categoryId').populate('photoIds').populate('mainPhotoId').populate('supplierId').exec();
    if (!doc || doc.deletedAt) throw new NotFoundException(`Material ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateMaterialDto, organizationId?: string | null): Promise<MaterialDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Material ${id} not found`);
    if (dto.categoryId) await this.loadAssignableMaterialCategory(dto.categoryId, organizationId);
    if (dto.article !== undefined) dto.article = this.normalizeRequiredArticle(dto.article);
    if (dto.dimensions !== undefined) this.assertUniqueDimensionTypes(dto.dimensions);
    const colors = this.normalizeColors(dto.colors);
    const doc = organizationId
      ? await this.model.findOne({ _id: new Types.ObjectId(id), deletedAt: null, ...this.organizationFilter(organizationId) }).exec()
      : await this.model.findById(id).exec();
    if (!doc || doc.deletedAt) throw new NotFoundException(`Material ${id} not found`);

    // findOneAndUpdate — тот же баг photoIds/VersionError, что у Product (TZ-CATALOG-339).
    const $set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto as Record<string, unknown>)) {
      if (value !== undefined) $set[key] = value;
    }
    if (colors !== undefined) $set.colors = colors;
    if (Array.isArray(dto.photoIds)) {
      $set.photoIds = dto.photoIds.map((pid) => new Types.ObjectId(String(pid)));
    }
    // TZ-SUPPLY-320: same reason as photoIds — the audit plugin re-sets the update
    // in a pre-hook, which bypasses Mongoose casting. Without an explicit cast the
    // FK lands as a string and every `?categoryId=` / `?supplierId=` filter misses it.
    for (const key of ['categoryId', 'supplierId', 'mainPhotoId'] as const) {
      const value = $set[key];
      if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
        $set[key] = new Types.ObjectId(value);
      }
    }
    try {
      const updated = await this.model
        .findOneAndUpdate(
          { _id: doc._id, deletedAt: null, ...this.organizationFilter(organizationId) },
          { $set, $inc: { __v: 1 } },
          { new: true, runValidators: true },
        )
        .exec();
      if (!updated) throw new NotFoundException(`Material ${id} not found`);
      return updated;
    } catch (err) {
      this.rethrowDuplicate(err);
    }
  }

  private async loadAssignableMaterialCategory(categoryId: string, organizationId?: string | null): Promise<CategoryDocument> {
    const category = organizationId
      ? await this.categoryModel.findOne({ _id: new Types.ObjectId(categoryId), deletedAt: null, ...this.organizationFilter(organizationId) }).exec()
      : await this.categoryModel.findById(categoryId).exec();
    if (!category || category.deletedAt) throw new BadRequestException(`Категория материала ${categoryId} не найдена`);
    if (category.type !== 'material' || category.isActive === false) throw new BadRequestException(`Категория «${category.name}» недоступна для создания материала`);
    return category;
  }

  private assertUniqueDimensionTypes(dimensions?: Array<{ type?: string }> | null): void {
    if (!dimensions?.length) return; const seen = new Set<string>();
    for (const d of dimensions) { const t = d?.type; if (!t) continue; if (seen.has(t)) throw new BadRequestException(`Габарит «${t}» указан дважды. У материала каждый тип размера только один раз.`); seen.add(t); }
  }

  private normalizeRequiredArticle(value: string | undefined): string {
    const article = value?.trim() ?? '';
    if (!article) throw new BadRequestException('Артикул материала обязателен');
    return article;
  }

  /** Keep the material color picker deterministic: trim blanks and dedupe case-insensitively. */
  private normalizeColors(value: string[] | undefined): string[] | undefined {
    if (value === undefined) return undefined;
    const result: string[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
      const color = raw.trim();
      const key = color.toLocaleLowerCase();
      if (!color || seen.has(key)) continue;
      seen.add(key);
      result.push(color);
    }
    return result;
  }

  private rethrowDuplicate(err: unknown): never {
    if ((err as { code?: number })?.code === 11000) {
      const keyPattern = JSON.stringify((err as { keyPattern?: unknown })?.keyPattern ?? {});
      if (keyPattern.includes('article')) throw new ConflictException('Артикул уже используется');
      throw new ConflictException('Материал с таким внутренним кодом уже существует');
    }
    throw err;
  }

  async remove(id: string, organizationId?: string | null): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Material ${id} not found`);
    const doc = organizationId
      ? await this.model.findOne({ _id: new Types.ObjectId(id), deletedAt: null, ...this.organizationFilter(organizationId) }).exec()
      : await this.model.findById(id).exec();
    if (!doc || doc.deletedAt) throw new NotFoundException(`Material ${id} not found`);
    const moduleRefs = await this.model.db.collection('productmodules').findOne({ $or: [{ 'composition.refId': doc._id, 'composition.lineType': 'material' }, { 'materials.materialId': doc._id }] });
    const costRefs = await this.model.db.collection('costcalculations').findOne({ 'materials.materialId': doc._id });
    const purchaseRefs = await this.model.db.collection('purchaseorders').findOne({ 'items.materialId': doc._id });
    if (moduleRefs || costRefs || purchaseRefs) throw new ConflictException('Material is referenced by catalog history and cannot be archived');
    await this.model.updateOne({ _id: doc._id, deletedAt: null, ...this.organizationFilter(organizationId) }, { $set: { deletedAt: new Date() } }).exec();
  }

  async duplicate(sourceId: string, organizationId?: string | null): Promise<MaterialDocument> {
    if (!Types.ObjectId.isValid(sourceId)) throw new NotFoundException(`Material ${sourceId} not found`);
    const source = organizationId
      ? await this.model.findOne({ _id: new Types.ObjectId(sourceId), deletedAt: null, ...this.organizationFilter(organizationId) }).exec()
      : await this.model.findById(sourceId).exec();
    if (!source || source.deletedAt) throw new NotFoundException(`Material ${sourceId} not found`);
    const sourceObj = (source.toObject ? source.toObject() : source) as unknown as Record<string, unknown>;
    const { _id: ignoredId, sku: ignoredSourceSku, photoIds: ignoredPhotos, mainPhotoId: ignoredMainPhoto, deletedAt: ignoredDeletedAt, createdAt: ignoredCreatedAt, updatedAt: ignoredUpdatedAt, organizationId: legacyOrg, isSystem: ignoredIsSystem, ...copiableFields } = sourceObj;
    void [ignoredId, ignoredSourceSku, ignoredPhotos, ignoredMainPhoto, ignoredDeletedAt, ignoredCreatedAt, ignoredUpdatedAt, legacyOrg, ignoredIsSystem];
    const baseName = String(copiableFields.name ?? 'Материал'); const suffix = ' (копия)'; const copiedName = baseName.length + suffix.length <= 256 ? `${baseName}${suffix}` : `${baseName.slice(0, 256 - suffix.length)}${suffix}`;
    const sourceArticle = String(copiableFields.article ?? '').trim();
    const articleSuffix = '-COPY';
    const copiedArticle = sourceArticle.length + articleSuffix.length <= 64
      ? `${sourceArticle}${articleSuffix}`
      : `${sourceArticle.slice(0, 64 - articleSuffix.length)}${articleSuffix}`;
    let nextSku: string | undefined;
    if (copiableFields.categoryId) {
      const categoryId = String((copiableFields.categoryId as Types.ObjectId)?.toString?.() ?? copiableFields.categoryId);
      try { const category = await this.loadAssignableMaterialCategory(categoryId, organizationId); if (category.skuPrefix) nextSku = await this.counter.next('Material', category.skuPrefix); } catch { nextSku = undefined; }
    }
    const payload: Record<string, unknown> = { ...copiableFields, name: copiedName, article: copiedArticle, ...(nextSku ? { sku: nextSku } : {}), photoIds: [], mainPhotoId: undefined, ...this.organizationWrite(organizationId) };
    try { return await this.model.create(payload); } catch (err) { this.rethrowDuplicate(err); }
  }

  private versionedCompositionFilter(doc: MaterialDocument): Record<string, unknown> {
    return { _id: doc._id, $or: [{ __v: doc.__v ?? 0 }, { __v: { $exists: false } }] };
  }

  private plainCompositionLine(line: CompositionLineDocumentShape): CompositionLineDocumentShape {
    return {
      _id: line._id,
      lineType: line.lineType,
      refId: line.refId,
      quantity: Number(line.quantity),
      sortOrder: Number(line.sortOrder ?? 0),
      unit: line.unit,
      overrideDimensions: line.overrideDimensions,
      isPurchased: line.isPurchased,
      sourcePosition: line.sourcePosition,
      sourceCode: line.sourceCode,
      notes: line.notes,
    };
  }

  private organizationFilter(organizationId?: string | null): Record<string, unknown> {
    if (!organizationId) return {}; if (!Types.ObjectId.isValid(organizationId)) throw new BadRequestException('Invalid organization scope');
    const id = new Types.ObjectId(organizationId); return { $or: [{ organizationId: id }, { organizationId: null }, { organizationId: { $exists: false } }] };
  }
  private organizationWrite(organizationId?: string | null): Record<string, unknown> { if (!organizationId) return {}; if (!Types.ObjectId.isValid(organizationId)) throw new BadRequestException('Invalid organization scope'); return { organizationId: new Types.ObjectId(organizationId) }; }
}
