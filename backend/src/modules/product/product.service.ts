import { ConflictException, GoneException, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CounterService } from '../counter/counter.service';
import { Category, CategoryDocument } from '../category/category.schema';
import { InjectModel as InjectCategoryModel } from '@nestjs/mongoose';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { DuplicateProductDto } from './dto/duplicate-product.dto';
import { Product, ProductDocument } from './product.schema';
import { ProductModule as ProductModuleEntity, ProductModuleDocument } from '../product-module/product-module.schema';
import { Material, MaterialDocument } from '../material/material.schema';
import { EavService } from '../../common/eav/eav.service';
import { CompositionLineDocumentShape } from '../catalog/composition-line.schema';
import { CompositionLineService } from '../catalog/composition-line.service';
import { CreateCompositionLineDto, UpdateCompositionLineDto } from '../catalog/composition-line.dto';
import { CatalogGraphService } from '../catalog-graph/catalog-graph.service';
import { blankMissingUploadUrls } from '../document-render/document-render.utils';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  constructor(
    @InjectModel(Product.name) private readonly model: Model<ProductDocument>,
    @InjectCategoryModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(ProductModuleEntity.name) private readonly productModuleModel: Model<ProductModuleDocument>,
    @InjectModel(Material.name) private readonly materialModel: Model<MaterialDocument>,
    private readonly counter: CounterService,
    private readonly eav: EavService,
    private readonly compositionLines: CompositionLineService,
    private readonly catalogGraph: CatalogGraphService,
  ) {}

  async create(dto: CreateProductDto, organizationId?: string | null): Promise<ProductDocument> {
    const sku = this.normalizeRequiredCode(dto.sku, 'Артикул изделия');
    const { attributes, ...rest } = dto;
    // WAVE-NX-CATALOG-PHOTOS P2: photoIds → ObjectId; main ∈ photoIds (после normalize) или null.
    const photoObjectIds = rest.photoIds?.map((pid) => new Types.ObjectId(String(pid)));
    let mainObjectId: Types.ObjectId | null | undefined;
    if (rest.mainPhotoId === null) {
      mainObjectId = null;
    } else if (rest.mainPhotoId !== undefined) {
      const main = String(rest.mainPhotoId);
      if (!photoObjectIds || !photoObjectIds.some((pid) => pid.toString() === main)) {
        throw new BadRequestException('Главное фото должно быть среди фото изделия');
      }
      mainObjectId = new Types.ObjectId(main);
    }
    try {
      const doc = await this.model.create({
        ...rest,
        ...(photoObjectIds ? { photoIds: photoObjectIds } : {}),
        ...(mainObjectId !== undefined ? { mainPhotoId: mainObjectId } : {}),
        sku,
        ...this.organizationWrite(organizationId),
      });
      if (attributes && Object.keys(attributes).length > 0) {
        const catId = doc.categoryId
          ? new Types.ObjectId(doc.categoryId as unknown as string)
          : undefined;
        await this.eav.resolveAttributes('Product', doc._id, attributes, catId);
      }
      return doc;
    } catch (err) {
      this.rethrowDuplicateSku(err);
    }
  }

  async findAll(q: { page?: number; limit?: number; search?: string; categoryId?: string; status?: string; isActive?: boolean; isComplex?: boolean; sortBy?: string; sortOrder?: 'asc' | 'desc' } = {}, organizationId?: string | null): Promise<{ items: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, q.page ?? 1); const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const filter: Record<string, unknown> = { deletedAt: null }; const clauses: Record<string, unknown>[] = []; const scope = this.organizationFilter(organizationId);
    if (scope.$or) clauses.push(scope);
    if (q.search) { const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const re = new RegExp(escaped, 'i'); clauses.push({ $or: [{ name: re }, { sku: re }] }); }
    if (q.isComplex === true) {
      filter.composition = { $elemMatch: { lineType: 'product' } };
    } else if (q.isComplex === false) {
      clauses.push({ $nor: [{ composition: { $elemMatch: { lineType: 'product' } } }] });
    }
    if (clauses.length > 0) filter.$and = clauses;
    // KP3/migrate rows may store categoryId as string; ObjectId-only equality → total:0.
    // Match both BSON ObjectId and string forms (TZ-MIG-306).
    if (q.categoryId) {
      filter.categoryId = Types.ObjectId.isValid(q.categoryId)
        ? { $in: [new Types.ObjectId(q.categoryId), q.categoryId] }
        : q.categoryId;
    }
    if (q.status) filter.status = q.status;
    if (typeof q.isActive === 'boolean') filter.isActive = q.isActive;
    const sortField = q.sortBy ?? 'createdAt'; const sortOrder = q.sortOrder === 'asc' ? 1 : -1;
    const [rawItems, total] = await Promise.all([this.model.find(filter).populate('categoryId').populate('photoIds').populate('productModuleIds').sort({ [sortField]: sortOrder }).skip((page - 1) * limit).limit(limit).lean().exec(), this.model.countDocuments(filter).exec()]);
    // TZ-NX-DOCSTUDIO-VITRINA-PHOTO-BROKEN-IMG: an orphaned photoIds entry
    // (Photo doc survives, file on disk does not) must not reach the client
    // as a truthy-but-404 storageUrl — blank it so the vitrina/list UI shows
    // the same empty-media placeholder as a genuinely photo-less product.
    await blankMissingUploadUrls(
      rawItems.flatMap((item) => (Array.isArray(item.photoIds) ? (item.photoIds as Array<{ storageUrl?: unknown }>) : [])),
    );
    const items = rawItems.map((item) => {
      const composition = (item.composition ?? []) as unknown as CompositionLineDocumentShape[];
      const isComplex = composition.some((line) => line.lineType === 'product');
      return { ...item, name: item.name?.trim() || item.sku, isComplex } as Record<string, unknown>;
    });
    return { items, total, page, limit };
  }

  async findByIds(ids: string[], organizationId?: string | null): Promise<(ProductDocument & { attributes?: Record<string, unknown>; isComplex?: boolean })[]> {
    const validIds = ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
    if (validIds.length === 0) return [];
    
    const populated = await this.model.find({ 
      _id: { $in: validIds }, 
      deletedAt: null, 
      ...this.organizationFilter(organizationId) 
    })
    .populate('categoryId')
    .populate('photoIds')
    .populate({ 
      path: 'productModuleIds', 
      populate: [
        { path: 'workTypes.workTypeId', model: 'WorkType' }, 
        { path: 'materials.materialId', model: 'Material', select: 'name photoIds unit materialKind' }
      ] 
    })
    .exec();

    return Promise.all(populated.map(async (doc) => {
      if (!doc.name?.trim()) doc.name = doc.sku;
      const composition = (doc.composition ?? []) as unknown as CompositionLineDocumentShape[]; 
      const isComplex = composition.some((line) => line.lineType === 'product');
      return Object.assign(doc, { 
        attributes: await this.eav.loadAttributes('Product', doc._id), 
        isComplex 
      });
    }));
  }

  async findById(id: string, organizationId?: string | null): Promise<ProductDocument & { attributes?: Record<string, unknown>; isComplex?: boolean }> {
    const doc = await this.findActive(id, organizationId);
    const populated = await this.model.findOne({ _id: doc._id, deletedAt: null, ...this.organizationFilter(organizationId) }).populate('categoryId').populate('photoIds').populate({ path: 'productModuleIds', populate: [{ path: 'workTypes.workTypeId', model: 'WorkType' }, { path: 'materials.materialId', model: 'Material', select: 'name photoIds unit materialKind' }] }).exec();
    if (!populated) throw new NotFoundException(`Product ${id} not found`);
    if (!populated.name?.trim()) populated.name = populated.sku;
    const composition = (populated.composition ?? []) as unknown as CompositionLineDocumentShape[]; const isComplex = composition.some((line) => line.lineType === 'product');
    return Object.assign(populated, { attributes: await this.eav.loadAttributes('Product', populated._id), isComplex });
  }

  async update(id: string, dto: UpdateProductDto, organizationId?: string | null): Promise<ProductDocument> {
    const doc = await this.findActive(id, organizationId);
    const { attributes, expectedVersion, ...rest } = dto;
    if (dto.sku !== undefined) rest.sku = this.normalizeRequiredCode(dto.sku, 'Артикул изделия');

    // findOneAndUpdate — не doc.save(): массив photoIds + legacy optimisticLockPlugin
    // (ручной __v) давали VersionError → «Изделие уже изменено» при добавлении фото.
    // Composition по-прежнему versioned; passport/photo — last-write-wins на полях $set.
    const $set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) $set[key] = value;
    }
    if (Array.isArray(rest.photoIds)) {
      $set.photoIds = rest.photoIds.map((pid) => new Types.ObjectId(String(pid)));
    }
    // WAVE-NX-CATALOG-PHOTOS P2: main ∈ final photoIds (merged) или null.
    if (rest.mainPhotoId !== undefined) {
      const finalPhotoIds = (
        (Array.isArray(rest.photoIds) ? rest.photoIds : (doc.photoIds ?? []).map((pid) => String(pid))) as Array<
          string | Types.ObjectId
        >
      ).map((pid) => String(pid));
      if (rest.mainPhotoId === null) {
        $set.mainPhotoId = null;
      } else {
        const main = String(rest.mainPhotoId);
        if (!finalPhotoIds.includes(main)) {
          throw new BadRequestException('Главное фото должно быть среди фото изделия');
        }
        $set.mainPhotoId = new Types.ObjectId(main);
      }
    }

    let saved: ProductDocument;
    try {
      const updated = await this.model
        .findOneAndUpdate(
          {
            _id: doc._id,
            deletedAt: null,
            ...this.organizationFilter(organizationId),
            ...(expectedVersion === undefined ? {} : { __v: expectedVersion }),
          },
          { $set, $inc: { __v: 1 } },
          { new: true, runValidators: true },
        )
        .exec();
      if (!updated) {
        throw new ConflictException(
          `Изделие уже изменено (обновите карточку и сохраните снова)`,
        );
      }
      saved = updated;
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      if ((err as { name?: string })?.name === 'VersionError') {
        throw new ConflictException(
          `Изделие уже изменено (обновите карточку и сохраните снова)`,
        );
      }
      this.rethrowDuplicateSku(err);
    }
    if (attributes && Object.keys(attributes).length > 0) {
      const catId = saved.categoryId
        ? new Types.ObjectId(saved.categoryId as unknown as string)
        : undefined;
      await this.eav.resolveAttributes('Product', saved._id, attributes, catId);
    }
    return saved;
  }

  async duplicate(id: string, overrides: DuplicateProductDto = {}, organizationId?: string | null): Promise<ProductDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Product ${id} not found`);
    const source = await this.model
      .findOne({ _id: new Types.ObjectId(id), deletedAt: null, ...this.duplicateOrganizationFilter(organizationId) })
      .exec();
    if (!source) throw new NotFoundException(`Product ${id} not found`);

    const sourceName = source.name?.trim() || source.sku;
    const name = overrides.name?.trim() || (await this.nextDuplicateName(sourceName, organizationId));
    const explicitSku = overrides.sku?.trim();
    let sku = explicitSku || (await this.nextDuplicateSku(source.sku, organizationId));
    const sourceCategoryId = source.categoryId
      ? new Types.ObjectId(String(source.categoryId))
      : undefined;
    const payload: Record<string, unknown> = {
      name,
      sku,
      kind: source.kind,
      unit: overrides.unit?.trim() || source.unit,
      categoryId: sourceCategoryId,
      subcategory: source.subcategory,
      listPrice: source.listPrice,
      basePrice: source.basePrice,
      costPrice: source.costPrice,
      defaultMarkupPercent: source.defaultMarkupPercent,
      description: overrides.description ?? source.description,
      notes: source.notes,
      photoIds: [...(source.photoIds ?? [])],
      mainPhotoId: source.mainPhotoId ?? null,
      dimensions: source.dimensions ? { ...source.dimensions } : undefined,
      weightKg: source.weightKg,
      ralCode: source.ralCode,
      hasPassport: source.hasPassport,
      hasDrawing: source.hasDrawing,
      purpose: source.purpose,
      installation: source.installation,
      productModuleIds: [...(source.productModuleIds ?? [])],
      composition: this.cloneComposition(source.composition),
      copiedFromProductId: source._id,
      stockQty: 0,
      status: 'draft',
      isActive: true,
      isSystem: false,
      ...(source.organizationId ? { organizationId: source.organizationId } : {}),
    };

    let created: ProductDocument | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        created = await this.model.create(payload);
        break;
      } catch (err) {
        if ((err as { code?: number })?.code !== 11000 || explicitSku || attempt === 3) {
          this.rethrowDuplicateSku(err);
        }
        sku = await this.nextDuplicateSku(source.sku, organizationId, attempt + 2);
        payload.sku = sku;
      }
    }
    if (!created) throw new ConflictException('Не удалось создать копию изделия');

    const attributes = await this.eav.loadAttributes('Product', source._id);
    if (Object.keys(attributes).length > 0) {
      await this.eav.resolveAttributes('Product', created._id, attributes, sourceCategoryId);
    }
    return created;
  }

  async getTree(id: string, maxDepth = 8, organizationId?: string | null) { await this.findActive(id, organizationId); return this.catalogGraph.getTree('product', id, maxDepth); }

  async getComposition(id: string, organizationId?: string | null): Promise<CompositionLineDocumentShape[]> {
    const doc = await this.findActive(id, organizationId); const raw = await this.model.findOne({ _id: doc._id, deletedAt: null, ...this.organizationFilter(organizationId) }).select('composition productModuleIds').lean().exec(); if (!raw) throw new NotFoundException(`Product ${id} not found`);
    const legacy = (raw.productModuleIds ?? []).map((refId) => ({ _id: new Types.ObjectId(), lineType: 'module' as const, refId: new Types.ObjectId(String(refId)), quantity: 1, sortOrder: 0 })); return this.compositionLines.dualRead(raw, legacy);
  }

  async addComposition(id: string, dto: CreateCompositionLineDto, organizationId?: string | null): Promise<CompositionLineDocumentShape[]> {
    const doc = await this.findActive(id, organizationId); const incoming = this.compositionLines.toStoredLine(dto);
    await this.catalogGraph.assertNoCycleAndDepth(id, 'product', { lineType: incoming.lineType, refId: incoming.refId.toString() }); await this.compositionLines.validateReference('product', incoming, { materialModel: this.materialModel, moduleModel: this.productModuleModel, productModel: this.model });
    const raw = ((doc.composition ?? []) as unknown as CompositionLineDocumentShape[]).map((line) => this.plainCompositionLine(line)); const next = this.compositionLines.upsertDeduplicated(raw, incoming); this.compositionLines.ensureLineLimit(next);
    const saved = await this.model.findOneAndUpdate({ ...this.versionedCompositionFilter(doc), ...this.organizationFilter(organizationId) }, { $set: { composition: next }, $inc: { __v: 1 } }, { new: true, runValidators: true }).exec(); if (!saved) throw new ConflictException(`Product ${id} changed while composition was being updated`); return saved.composition as unknown as CompositionLineDocumentShape[];
  }

  async updateComposition(id: string, lineId: string, dto: UpdateCompositionLineDto, organizationId?: string | null): Promise<CompositionLineDocumentShape[]> {
    if (!Types.ObjectId.isValid(lineId)) throw new BadRequestException('Invalid composition line id'); const doc = await this.findActive(id, organizationId); const raw = ((doc.composition ?? []) as unknown as CompositionLineDocumentShape[]).map((line) => this.plainCompositionLine(line)); const index = raw.findIndex((line) => line._id.toString() === lineId); if (index < 0) throw new NotFoundException(`Composition line ${lineId} not found`);
    const updated = this.compositionLines.toStoredLine(dto, raw[index]); await this.catalogGraph.assertNoCycleAndDepth(id, 'product', { lineType: updated.lineType, refId: updated.refId.toString() }, lineId); await this.compositionLines.validateReference('product', updated, { materialModel: this.materialModel, moduleModel: this.productModuleModel, productModel: this.model });
    const next = raw.slice(); next[index] = updated; this.compositionLines.ensureNoDuplicateKeys(next); const saved = await this.model.findOneAndUpdate({ ...this.versionedCompositionFilter(doc), ...this.organizationFilter(organizationId) }, { $set: { composition: next }, $inc: { __v: 1 } }, { new: true, runValidators: true }).exec(); if (!saved) throw new ConflictException(`Product ${id} changed while composition was being updated`); return saved.composition as unknown as CompositionLineDocumentShape[];
  }

  async removeComposition(id: string, lineId: string, organizationId?: string | null): Promise<void> {
    if (!Types.ObjectId.isValid(lineId)) throw new BadRequestException('Invalid composition line id'); const doc = await this.findActive(id, organizationId); const raw = ((doc.composition ?? []) as unknown as CompositionLineDocumentShape[]).map((line) => this.plainCompositionLine(line)); const next = raw.filter((line) => line._id.toString() !== lineId); if (next.length === raw.length) throw new NotFoundException(`Composition line ${lineId} not found`);
    const saved = await this.model.findOneAndUpdate({ ...this.versionedCompositionFilter(doc), ...this.organizationFilter(organizationId) }, { $set: { composition: next }, $inc: { __v: 1 } }, { new: true, runValidators: true }).exec(); if (!saved) throw new ConflictException(`Product ${id} changed while composition was being updated`);
  }

  async remove(id: string, organizationId?: string | null): Promise<void> {
    const doc = await this.findActive(id, organizationId); const refs = await Promise.all([this.model.db.collection('orders').findOne({ 'items.productId': doc._id }), this.model.db.collection('quotations').findOne({ 'items.productId': doc._id }), this.model.db.collection('costcalculations').findOne({ productId: doc._id }), this.model.db.collection('boms').findOne({ productId: doc._id })]);
    if (refs.some(Boolean)) throw new ConflictException('Product is referenced by catalog history and cannot be archived');
    await this.model.updateOne({ _id: doc._id, deletedAt: null, ...this.organizationFilter(organizationId) }, { $set: { deletedAt: new Date(), isActive: false, status: 'archived' } }).exec();
  }

  async attachModule(_productId: string, _moduleId: string): Promise<ProductDocument> { void _productId; void _moduleId; throw new GoneException('Legacy productModuleIds writes are disabled; use the composition API'); }
  async detachModule(_productId: string, _moduleId: string): Promise<void> { void _productId; void _moduleId; throw new GoneException('Legacy productModuleIds writes are disabled; use the composition API'); }

  private async findActive(id: string, organizationId?: string | null): Promise<ProductDocument> { if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Product ${id} not found`); const doc = await this.model.findOne({ _id: new Types.ObjectId(id), deletedAt: null, ...this.organizationFilter(organizationId) }).exec(); if (!doc) throw new NotFoundException(`Product ${id} not found`); return doc; }
  private normalizeRequiredCode(value: string | undefined, label: string): string {
    const code = value?.trim() ?? '';
    if (!code) throw new BadRequestException(`${label} обязателен`);
    return code;
  }
  private rethrowDuplicateSku(err: unknown): never {
    if ((err as { code?: number })?.code === 11000) {
      throw new ConflictException('Артикул уже используется');
    }
    throw err;
  }
  private organizationFilter(organizationId?: string | null): Record<string, unknown> { if (!organizationId) return {}; if (!Types.ObjectId.isValid(organizationId)) throw new BadRequestException('Invalid organization scope'); const id = new Types.ObjectId(organizationId); return { $or: [{ organizationId: id }, { organizationId: null }, { organizationId: { $exists: false } }] }; }
  private duplicateOrganizationFilter(organizationId?: string | null): Record<string, unknown> {
    if (organizationId) {
      if (!Types.ObjectId.isValid(organizationId)) throw new BadRequestException('Invalid organization scope');
      return { organizationId: new Types.ObjectId(organizationId) };
    }
    return { $or: [{ organizationId: null }, { organizationId: { $exists: false } }] };
  }
  private organizationWrite(organizationId?: string | null): Record<string, unknown> { if (!organizationId) return {}; if (!Types.ObjectId.isValid(organizationId)) throw new BadRequestException('Invalid organization scope'); return { organizationId: new Types.ObjectId(organizationId) }; }
  private versionedCompositionFilter(doc: ProductDocument): Record<string, unknown> { return { _id: doc._id, $or: [{ __v: doc.__v ?? 0 }, { __v: { $exists: false } }] }; }
  private plainCompositionLine(line: CompositionLineDocumentShape): CompositionLineDocumentShape { return { _id: line._id, lineType: line.lineType, refId: line.refId, quantity: Number(line.quantity), sortOrder: Number(line.sortOrder ?? 0), unit: line.unit, overrideDimensions: line.overrideDimensions, isPurchased: line.isPurchased, sourcePosition: line.sourcePosition, sourceCode: line.sourceCode, notes: line.notes }; }
  private cloneComposition(lines: Product['composition']): CompositionLineDocumentShape[] {
    return (lines ?? []).map((line) => {
      const candidate = line as CompositionLineDocumentShape & {
        toObject?: () => CompositionLineDocumentShape;
      };
      const plain = candidate.toObject ? candidate.toObject() : candidate;
      const { _id: _sourceLineId, ...copy } = plain;
      void _sourceLineId;
      return copy as CompositionLineDocumentShape;
    });
  }
  private async nextDuplicateName(sourceName: string, organizationId?: string | null): Promise<string> {
    const base = sourceName.replace(/\s— копия(?: \d+)?$/u, '').trim();
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rows = await this.model.find({
      deletedAt: null,
      ...this.duplicateOrganizationFilter(organizationId),
      name: new RegExp(`^${escaped} — копия(?: \\d+)?$`, 'u'),
    }).select('name').lean().exec();
    const used = new Set(rows.map((row) => String(row.name ?? '')));
    const first = `${base} — копия`;
    if (!used.has(first)) return first;
    let suffix = 2;
    while (used.has(`${base} — копия ${suffix}`)) suffix += 1;
    return `${base} — копия ${suffix}`;
  }
  private async nextDuplicateSku(sourceSku: string, organizationId?: string | null, startAt = 1): Promise<string> {
    const escaped = sourceSku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rows = await this.model.find({
      deletedAt: null,
      ...this.duplicateOrganizationFilter(organizationId),
      sku: new RegExp(`^${escaped}-COPY-\\d+$`, 'i'),
    }).select('sku').lean().exec();
    const used = new Set(rows.map((row) => String(row.sku ?? '').toUpperCase()));
    let suffix = Math.max(1, startAt);
    while (used.has(`${sourceSku}-COPY-${suffix}`.toUpperCase())) suffix += 1;
    return `${sourceSku}-COPY-${suffix}`;
  }
}
