import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Quotation,
  QuotationDocument,
  QuotationItem,
} from './quotation.schema';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { AttachOrganizationsDto } from './dto/attach-organizations.dto';
import { CounterService } from '../counter/counter.service';
import { ContractService } from '../contract/contract.service';
import { OrderService } from '../order/order.service';
import { SiteService } from '../site/site.service';

/** Thin family summary for GET /:id/family (D21 / SALES-303). */
export interface QuotationFamilyMemberSummary {
  id: string;
  number: string;
  organizationId: string;
  familyRole: string;
  familyVersion: number;
  orgMarkupPercent?: number;
  total: number;
  status: string;
}

export interface QuotationFamilyResponse {
  master: QuotationFamilyMemberSummary;
  variants: QuotationFamilyMemberSummary[];
  familyVersion: number;
}

@Injectable()
export class QuotationService {
  constructor(
    @InjectModel(Quotation.name)
    private readonly model: Model<QuotationDocument>,
    private readonly counter: CounterService,
    private readonly contractService: ContractService,
    private readonly orderService: OrderService,
    private readonly sites: SiteService,
  ) {}

  async create(dto: CreateQuotationDto): Promise<QuotationDocument> {
    const number = dto.number ?? (await this.counter.next('Quotation', 'QTN'));
    const markup = dto.orgMarkupPercent ?? 0;
    const items: QuotationItem[] = (dto.items ?? []).map((item) =>
      this.toQuotationItem(item),
    );
    const subtotal =
      items
        .filter((item) => !item.isOptional)
        .reduce((s, i) => s + i.total, 0) *
      (1 + markup / 100);
    const total = this.applyDiscount(
      subtotal,
      dto.discountType,
      dto.discountPercent,
      dto.discountAmount,
    );
    return this.model.create({
      number,
      organizationId: new Types.ObjectId(dto.organizationId),
      counterpartyId: dto.counterpartyId
        ? new Types.ObjectId(dto.counterpartyId)
        : undefined,
      contactPersonId: dto.contactPersonId
        ? new Types.ObjectId(dto.contactPersonId)
        : undefined,
      siteId: dto.siteId ? new Types.ObjectId(dto.siteId) : undefined,
      tenderId: dto.tenderId ? new Types.ObjectId(dto.tenderId) : undefined,
      date: dto.date ? new Date(dto.date) : new Date(),
      validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      status: dto.status ?? 'draft',
      total,
      discountType: dto.discountType ?? 'none',
      discountPercent: dto.discountPercent ?? 0,
      discountAmount: dto.discountAmount ?? 0,
      notes: dto.notes,
      terms: this.mapTerms(dto.terms),
      orgMarkupPercent: dto.orgMarkupPercent,
      vatPercent: dto.vatPercent ?? 20,
      prepaymentPercent: dto.prepaymentPercent ?? 0,
      productionDays: dto.productionDays ?? 0,
      deliveryDays: dto.deliveryDays ?? 0,
      templateId: dto.templateId
        ? new Types.ObjectId(dto.templateId)
        : undefined,
      studioDocumentId: dto.studioDocumentId
        ? new Types.ObjectId(dto.studioDocumentId)
        : undefined,
      designSnapshot: dto.designSnapshot,
      templateSnapshot: dto.templateSnapshot,
      sheetLayout: this.mapSheetLayout(dto.sheetLayout),
      items,
      familyRole: 'solo',
      familyVersion: 1,
    });
  }

  async findAll(
    counterpartyId?: string,
    status?: string,
    from?: Date,
    to?: Date,
  ): Promise<QuotationDocument[]> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (counterpartyId) {
      if (!Types.ObjectId.isValid(counterpartyId)) return [];
      filter.counterpartyId = new Types.ObjectId(counterpartyId);
    }
    if (status) filter.status = status;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      filter.date = range;
    }
    const docs = await this.model
      .find(filter)
      .populate('counterpartyId')
      .populate('contactPersonId')
      .populate('siteId')
      .populate('organizationId')
      .populate('items.productId')
      .sort({ date: -1 })
      .exec();
    await Promise.all(docs.map((doc) => this.populateTypedItemRefs(doc)));
    return docs;
  }

  async findById(id: string): Promise<QuotationDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Quotation ${id} not found`);
    }
    const doc = await this.model
      .findById(id)
      .populate('counterpartyId')
      .populate('contactPersonId')
      .populate('siteId')
      .populate('organizationId')
      .populate('items.productId')
      .exec();
    if (!doc || doc.deletedAt)
      throw new NotFoundException(`Quotation ${id} not found`);
    await this.populateTypedItemRefs(doc);
    return doc;
  }

  async update(
    id: string,
    dto: UpdateQuotationDto,
  ): Promise<QuotationDocument> {
    const doc = await this.findById(id);
    if (doc.status === 'accepted') {
      const nonStatusFields = Object.keys(dto).filter(
        (key) => key !== 'status',
      );
      if (nonStatusFields.length > 0 || dto.status !== 'draft') {
        throw new BadRequestException(
          'Оплаченная КП заблокирована. Снимите статус «Оплачена», чтобы изменить бланк или позиции.',
        );
      }
    }
    if (dto.organizationId !== undefined) {
      doc.organizationId = new Types.ObjectId(dto.organizationId);
    }
    if (dto.counterpartyId !== undefined) {
      doc.counterpartyId = new Types.ObjectId(dto.counterpartyId);
    }
    if (dto.contactPersonId !== undefined) {
      doc.contactPersonId = dto.contactPersonId
        ? new Types.ObjectId(dto.contactPersonId)
        : undefined;
    }
    if (dto.siteId !== undefined) {
      doc.siteId = dto.siteId ? new Types.ObjectId(dto.siteId) : undefined;
    }
    if (dto.orgMarkupPercent !== undefined)
      doc.orgMarkupPercent = dto.orgMarkupPercent;
    if (dto.vatPercent !== undefined) doc.vatPercent = dto.vatPercent;
    if (dto.prepaymentPercent !== undefined)
      doc.prepaymentPercent = dto.prepaymentPercent;
    if (dto.productionDays !== undefined)
      doc.productionDays = dto.productionDays;
    if (dto.deliveryDays !== undefined) doc.deliveryDays = dto.deliveryDays;
    if (dto.templateId !== undefined) {
      doc.templateId = dto.templateId
        ? new Types.ObjectId(dto.templateId)
        : undefined;
    }
    if (dto.templateSnapshot !== undefined)
      doc.templateSnapshot = dto.templateSnapshot;
    if (dto.sheetLayout !== undefined)
      doc.sheetLayout = this.mapSheetLayout(dto.sheetLayout);
    if (dto.designSnapshot !== undefined)
      doc.designSnapshot = dto.designSnapshot;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.terms !== undefined) doc.terms = this.mapTerms(dto.terms);
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.validUntil !== undefined) doc.validUntil = new Date(dto.validUntil);
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.discountType !== undefined) doc.discountType = dto.discountType;
    if (dto.discountPercent !== undefined)
      doc.discountPercent = dto.discountPercent;
    if (dto.discountAmount !== undefined)
      doc.discountAmount = dto.discountAmount;
    if (dto.items !== undefined) {
      doc.items = dto.items.map((item) => this.toQuotationItem(item));
    }
    // Recompute total from items + markup + current discount.
    const subtotal =
      (doc.items ?? [])
        .filter((item) => !item.isOptional)
        .reduce((s, i) => s + (i.total ?? 0), 0) *
      (1 + (doc.orgMarkupPercent ?? 0) / 100);
    doc.total = this.applyDiscount(
      subtotal,
      doc.discountType,
      doc.discountPercent,
      doc.discountAmount,
    );
    return doc.save();
  }

  /**
   * Freeze the current editable quotation into an embedded immutable snapshot.
   * Ordinary PATCH operations never address `versions`, so later line edits
   * cannot mutate a snapshot already sent to a customer.
   */
  async freeze(id: string, frozenBy?: string): Promise<QuotationDocument> {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const doc = await this.findByIdRaw(id);
      const existingMax = (doc.versions ?? []).reduce(
        (max, snapshot) => Math.max(max, snapshot.version),
        0,
      );
      const version = Math.max(doc.currentVersion ?? 0, existingMax) + 1;
      const frozenAt = new Date();
      const payload: Record<string, unknown> = {
        number: doc.number,
        organizationId: doc.organizationId.toString(),
        ...(doc.counterpartyId
          ? { counterpartyId: doc.counterpartyId.toString() }
          : {}),
        contactPersonId: doc.contactPersonId?.toString(),
        siteId: doc.siteId?.toString(),
        tenderId: doc.tenderId?.toString(),
        title: doc.title,
        date: doc.date,
        validUntil: doc.validUntil,
        status: doc.status,
        total: doc.total,
        discountType: doc.discountType,
        discountPercent: doc.discountPercent,
        discountAmount: doc.discountAmount,
        notes: doc.notes,
        terms: (doc.terms ?? []).map((term) => ({
          text: term.text,
          sortOrder: term.sortOrder,
        })),
        familyRole: doc.familyRole,
        masterId: doc.masterId?.toString(),
        familyVersion: doc.familyVersion,
        orgMarkupPercent: doc.orgMarkupPercent,
        vatPercent: doc.vatPercent,
        prepaymentPercent: doc.prepaymentPercent,
        productionDays: doc.productionDays,
        deliveryDays: doc.deliveryDays,
        isActive: doc.isActive,
        convertedContractId: doc.convertedContractId,
        convertedOrderId: doc.convertedOrderId,
        templateId: doc.templateId?.toString(),
        designSnapshot: doc.designSnapshot,
        templateSnapshot: doc.templateSnapshot,
        sheetLayout: this.mapSheetLayout(doc.sheetLayout),
        items: this.cloneItems(doc.items).map((item) => ({
          ...item,
          ...(item.productId ? { productId: item.productId.toString() } : {}),
          ...(item.refId
            ? { refId: this.asObjectId(item.refId)?.toString() }
            : {}),
        })),
      };
      const snapshot = {
        version,
        frozenAt,
        frozenBy:
          frozenBy && Types.ObjectId.isValid(frozenBy)
            ? new Types.ObjectId(frozenBy)
            : undefined,
        payload,
      };
      const currentVersion = doc.currentVersion ?? 0;
      const versionFilter =
        doc.currentVersion == null
          ? { _id: doc._id, currentVersion: { $exists: false } }
          : { _id: doc._id, currentVersion };
      const result = await this.model
        .updateOne(versionFilter, {
          $set: { currentVersion: version },
          $push: { versions: snapshot },
        })
        .exec();
      if (result.matchedCount === 1) {
        doc.currentVersion = version;
        doc.versions = [...(doc.versions ?? []), snapshot];
        return doc;
      }
    }
    throw new ConflictException(
      'Quotation changed while freezing; please retry',
    );
  }

  async listVersions(
    id: string,
  ): Promise<
    Array<{ version: number; frozenAt: Date; frozenBy?: Types.ObjectId }>
  > {
    const doc = await this.findByIdRaw(id);
    return (doc.versions ?? []).map(({ version, frozenAt, frozenBy }) => ({
      version,
      frozenAt,
      frozenBy,
    }));
  }

  async getVersion(
    id: string,
    version: number,
  ): Promise<{
    version: number;
    frozenAt: Date;
    frozenBy?: Types.ObjectId;
    payload: Record<string, unknown>;
  }> {
    const doc = await this.findByIdRaw(id);
    const snapshot = (doc.versions ?? []).find(
      (item) => item.version === version,
    );
    if (!snapshot) {
      throw new NotFoundException(
        `Quotation ${id} version ${version} not found`,
      );
    }
    return snapshot;
  }

  async duplicate(id: string): Promise<QuotationDocument> {
    const src = await this.findById(id);
    const number = await this.counter.next('Quotation', 'QTN');
    return this.model.create({
      number,
      organizationId: src.organizationId,
      counterpartyId: src.counterpartyId,
      contactPersonId: src.contactPersonId,
      siteId: src.siteId,
      tenderId: src.tenderId,
      date: new Date(),
      validUntil: src.validUntil,
      status: 'draft',
      total: src.total,
      discountType: src.discountType,
      discountPercent: src.discountPercent,
      discountAmount: src.discountAmount,
      notes: `Дубликат ${src.number}`,
      terms: this.mapTerms(src.terms),
      templateId: src.templateId,
      designSnapshot: src.designSnapshot,
      templateSnapshot: src.templateSnapshot,
      sheetLayout: this.mapSheetLayout(src.sheetLayout),
      items: src.items.map((item) => this.cloneItem(item)),
    });
  }

  /** Find by ID without populate — returns raw ObjectIds for refs. */
  private async findByIdRaw(id: string): Promise<QuotationDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Quotation ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc || doc.deletedAt)
      throw new NotFoundException(`Quotation ${id} not found`);
    return doc;
  }

  private cloneItem(item: QuotationItem): QuotationItem {
    const refId = this.asObjectId(item.refId);
    const rowPresentation = this.normalizeRowPresentation(item.rowPresentation);
    return {
      lineKind: item.lineKind ?? (item.productId ? 'catalog' : 'custom'),
      ...(item.productId ? { productId: item.productId } : {}),
      ...(refId ? { refId } : {}),
      productName: item.productName,
      description: item.description,
      productSku: item.productSku,
      photoUrl: item.photoUrl,
      sourceItemId: item.sourceItemId,
      ...(item.catalogDirtyFields?.length
        ? { catalogDirtyFields: [...item.catalogDirtyFields] }
        : {}),
      ...(item.catalogDecision ? { catalogDecision: item.catalogDecision } : {}),
      ...(item.catalogSourceVersion !== undefined
        ? { catalogSourceVersion: item.catalogSourceVersion }
        : {}),
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      markupPercent: item.markupPercent,
      discountPercent: item.discountPercent ?? 0,
      isOptional: item.isOptional ?? false,
      ...(rowPresentation ? { rowPresentation } : {}),
      total: item.total,
      sortOrder: item.sortOrder,
    } as QuotationItem;
  }

  private cloneItems(items: QuotationItem[]): QuotationItem[] {
    return (items ?? []).map((item) => this.cloneItem(item));
  }

  /**
   * Persist only non-default visual settings. Missing/partial → backward defaults
   * at read/render time. Returns undefined when everything is default.
   */
  private normalizeRowPresentation(
    value?: {
      density?: 'auto' | 'compact' | 'large';
      emphasis?: 'normal' | 'accent';
      separatorBefore?: boolean;
      pageBreakBefore?: boolean;
      showDescription?: boolean;
      photoFit?: 'inherit' | 'contain' | 'cover';
    } | null,
  ): QuotationItem['rowPresentation'] | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const density = value.density ?? 'auto';
    const emphasis = value.emphasis ?? 'normal';
    const separatorBefore = value.separatorBefore === true;
    const pageBreakBefore = value.pageBreakBefore === true;
    const showDescription = value.showDescription !== false;
    const photoFit = value.photoFit ?? 'inherit';
    const isDefault =
      density === 'auto' &&
      emphasis === 'normal' &&
      !separatorBefore &&
      !pageBreakBefore &&
      showDescription &&
      photoFit === 'inherit';
    if (isDefault) return undefined;
    return {
      density,
      emphasis,
      separatorBefore,
      pageBreakBefore,
      showDescription,
      photoFit,
    };
  }

  private toQuotationItem(item: {
    lineKind?: 'catalog' | 'custom' | 'module' | 'material';
    productId?: string;
    refId?: string;
    productName?: string;
    description?: string;
    productSku?: string;
    photoUrl?: string;
    sourceItemId?: string;
    catalogDirtyFields?: Array<'productName' | 'description' | 'productSku' | 'unit'>;
    catalogDecision?: 'pending' | 'kp-only';
    catalogSourceVersion?: number;
    quantity: number;
    unit?: string;
    unitPrice: number;
    markupPercent?: number;
    discountPercent?: number;
    isOptional?: boolean;
    rowPresentation?: QuotationItem['rowPresentation'];
    sortOrder?: number;
  }): QuotationItem {
    const lineKind = item.lineKind ?? 'catalog';
    if (lineKind === 'catalog' && !item.productId) {
      throw new BadRequestException('Для каталожной строки требуется изделие');
    }
    if (lineKind === 'custom' && !item.productName?.trim()) {
      throw new BadRequestException('Для своей строки требуется название');
    }
    if (
      (lineKind === 'module' || lineKind === 'material') &&
      !item.refId
    ) {
      throw new BadRequestException(
        lineKind === 'module'
          ? 'Для строки модуля требуется ссылка на модуль'
          : 'Для строки материала требуется ссылка на материал',
      );
    }
    const discountPercent = Math.min(
      100,
      Math.max(0, item.discountPercent ?? 0),
    );
    const gross = (item.quantity ?? 0) * (item.unitPrice ?? 0);
    const total = Math.round(gross * (1 - discountPercent / 100) * 100) / 100;
    const rowPresentation = this.normalizeRowPresentation(item.rowPresentation);
    const catalogDirtyFields =
      lineKind === 'catalog'
        ? [...new Set(item.catalogDirtyFields ?? [])]
        : [];
    const catalogDecision =
      lineKind === 'catalog' ? item.catalogDecision : undefined;
    return {
      lineKind,
      ...(item.productId
        ? { productId: new Types.ObjectId(item.productId) }
        : {}),
      ...(item.refId ? { refId: new Types.ObjectId(item.refId) } : {}),
      productName: item.productName,
      description: item.description,
      productSku: item.productSku,
      photoUrl: item.photoUrl,
      sourceItemId: item.sourceItemId,
      ...(catalogDirtyFields.length ? { catalogDirtyFields } : {}),
      ...(catalogDecision ? { catalogDecision } : {}),
      ...(item.catalogSourceVersion !== undefined && lineKind === 'catalog'
        ? { catalogSourceVersion: item.catalogSourceVersion }
        : {}),
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      markupPercent: item.markupPercent ?? 0,
      discountPercent,
      isOptional: item.isOptional ?? false,
      ...(rowPresentation ? { rowPresentation } : {}),
      total,
      sortOrder: item.sortOrder ?? 0,
    } as QuotationItem;
  }

  /** Resolve module/material refs after product populate (SALES-348). */
  private async populateTypedItemRefs(
    doc: QuotationDocument,
  ): Promise<void> {
    const items = doc.items ?? [];
    const moduleIds = items
      .filter((item) => item.lineKind === 'module' && item.refId)
      .map((item) => this.asObjectId(item.refId)!)
      .filter(Boolean);
    const materialIds = items
      .filter((item) => item.lineKind === 'material' && item.refId)
      .map((item) => this.asObjectId(item.refId)!)
      .filter(Boolean);
    if (moduleIds.length === 0 && materialIds.length === 0) return;

    const moduleModel = this.model.db.models['ProductModule'];
    const materialModel = this.model.db.models['Material'];
    const [modules, materials] = await Promise.all([
      moduleIds.length && moduleModel
        ? moduleModel
            .find({ _id: { $in: moduleIds } })
            .select('name article unit')
            .lean()
            .exec()
        : Promise.resolve([] as Array<Record<string, unknown>>),
      materialIds.length && materialModel
        ? materialModel
            .find({ _id: { $in: materialIds } })
            .select('name article sku unit pricePerUnit')
            .lean()
            .exec()
        : Promise.resolve([] as Array<Record<string, unknown>>),
    ]);
    const moduleMap = new Map(
      (modules as Array<{ _id: Types.ObjectId }>).map((row) => [
        row._id.toString(),
        row,
      ]),
    );
    const materialMap = new Map(
      (materials as Array<{ _id: Types.ObjectId }>).map((row) => [
        row._id.toString(),
        row,
      ]),
    );
    for (const item of items) {
      const id = this.asObjectId(item.refId)?.toString();
      if (!id) continue;
      if (item.lineKind === 'module' && moduleMap.has(id)) {
        (item as { refId?: unknown }).refId = moduleMap.get(id);
      } else if (item.lineKind === 'material' && materialMap.has(id)) {
        (item as { refId?: unknown }).refId = materialMap.get(id);
      }
    }
  }

  private asObjectId(
    value: Types.ObjectId | string | { _id?: Types.ObjectId } | undefined | null,
  ): Types.ObjectId | undefined {
    if (!value) return undefined;
    if (value instanceof Types.ObjectId) return value;
    if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
      return new Types.ObjectId(value);
    }
    if (
      typeof value === 'object' &&
      '_id' in value &&
      value._id instanceof Types.ObjectId
    ) {
      return value._id;
    }
    return undefined;
  }

  private toFamilySummary(
    doc: QuotationDocument,
  ): QuotationFamilyMemberSummary {
    return {
      id: doc._id.toString(),
      number: doc.number,
      organizationId: doc.organizationId.toString(),
      familyRole: doc.familyRole ?? 'solo',
      familyVersion: doc.familyVersion ?? 1,
      orgMarkupPercent: doc.orgMarkupPercent,
      total: doc.total ?? 0,
      status: doc.status,
    };
  }

  /** Resolve master for any family member (solo/master → self; variant → master). */
  private async resolveMaster(
    doc: QuotationDocument,
  ): Promise<QuotationDocument> {
    const role = doc.familyRole ?? 'solo';
    if (role !== 'variant') return doc;
    if (!doc.masterId) {
      throw new BadRequestException(
        `Quotation ${doc._id} is a variant without masterId`,
      );
    }
    const master = await this.model.findById(doc.masterId).exec();
    if (!master) {
      throw new NotFoundException(`Master quotation ${doc.masterId} not found`);
    }
    return master;
  }

  private assertConvertibleFamilyRole(q: QuotationDocument): void {
    if ((q.familyRole ?? 'solo') === 'variant') {
      throw new BadRequestException(
        'Cannot convert a family variant — convert the master (or solo) quotation instead',
      );
    }
  }

  /**
   * Attach organizations as variants of this КП family (idempotent per org).
   * solo → master; creates one variant per org with copied lines.
   */
  async attachOrganizations(
    id: string,
    dto: AttachOrganizationsDto,
  ): Promise<QuotationFamilyResponse> {
    const root = await this.findByIdRaw(id);
    const master = await this.resolveMaster(root);

    if ((master.familyRole ?? 'solo') === 'solo') {
      master.familyRole = 'master';
      if (master.familyVersion == null) master.familyVersion = 1;
      await master.save();
    }

    const masterOrg = master.organizationId.toString();
    const version = master.familyVersion ?? 1;

    for (const item of dto.items) {
      if (!Types.ObjectId.isValid(item.organizationId)) {
        throw new BadRequestException(
          `Invalid organizationId: ${item.organizationId}`,
        );
      }
      // Master's own org is already the blank root — skip (idempotent).
      if (item.organizationId === masterOrg) {
        if (item.orgMarkupPercent !== undefined) {
          master.orgMarkupPercent = item.orgMarkupPercent;
          await master.save();
        }
        continue;
      }

      const orgOid = new Types.ObjectId(item.organizationId);
      const existing = await this.model
        .findOne({ masterId: master._id, organizationId: orgOid })
        .exec();

      if (existing) {
        if (item.orgMarkupPercent !== undefined) {
          existing.orgMarkupPercent = item.orgMarkupPercent;
          await existing.save();
        }
        continue;
      }

      const number = await this.counter.next('Quotation', 'QTN');
      try {
        await this.model.create({
          number,
          organizationId: orgOid,
          counterpartyId: master.counterpartyId,
          contactPersonId: master.contactPersonId,
          siteId: master.siteId,
          tenderId: master.tenderId,
          title: master.title,
          date: new Date(),
          validUntil: master.validUntil,
          status: 'draft',
          total: master.total,
          discountType: master.discountType,
          discountPercent: master.discountPercent,
          discountAmount: master.discountAmount,
          notes: master.notes,
          terms: this.mapTerms(master.terms),
          templateId: master.templateId,
          designSnapshot: master.designSnapshot,
          templateSnapshot: master.templateSnapshot,
          sheetLayout: this.mapSheetLayout(master.sheetLayout),
          items: this.cloneItems(master.items),
          familyRole: 'variant',
          masterId: master._id,
          familyVersion: version,
          orgMarkupPercent: item.orgMarkupPercent,
          isActive: true,
        });
      } catch (err) {
        if ((err as { code?: number })?.code === 11000) {
          throw new ConflictException(
            `Variant for organization ${item.organizationId} already exists in this family`,
          );
        }
        throw err;
      }
    }

    return this.getFamily(master._id.toString());
  }

  /** Copy master lines → all variants; bump familyVersion. */
  async syncFromMaster(id: string): Promise<QuotationFamilyResponse> {
    const root = await this.findByIdRaw(id);
    const master = await this.resolveMaster(root);

    if ((master.familyRole ?? 'solo') === 'solo') {
      // No family yet — nothing to sync; keep solo intact.
      return this.getFamily(master._id.toString());
    }

    master.familyVersion = (master.familyVersion ?? 1) + 1;
    await master.save();

    const variants = await this.model.find({ masterId: master._id }).exec();
    const items = this.cloneItems(master.items);
    for (const v of variants) {
      v.items = items;
      v.total = master.total;
      v.discountType = master.discountType;
      v.discountPercent = master.discountPercent;
      v.discountAmount = master.discountAmount;
      v.familyVersion = master.familyVersion;
      await v.save();
    }

    return this.getFamily(master._id.toString());
  }

  async getFamily(id: string): Promise<QuotationFamilyResponse> {
    const root = await this.findByIdRaw(id);
    const master = await this.resolveMaster(root);
    const variants = await this.model
      .find({ masterId: master._id })
      .sort({ organizationId: 1 })
      .exec();

    return {
      master: this.toFamilySummary(master),
      variants: variants.map((v) => this.toFamilySummary(v)),
      familyVersion: master.familyVersion ?? 1,
    };
  }

  async convertToContract(
    id: string,
    title?: string,
  ): Promise<{ quotation: QuotationDocument; contractId: string }> {
    // Use unpopulated query so organizationId / counterpartyId are raw
    // ObjectIds (populate can set them to null if the ref was deleted).
    const q = await this.findByIdRaw(id);
    this.assertConvertibleFamilyRole(q);
    if (q.status === 'converted') {
      throw new NotFoundException(`Quotation already converted`);
    }
    if (!q.counterpartyId) {
      throw new BadRequestException('Нельзя открыть договор без клиента в КП');
    }
    const contract = await this.contractService.create({
      title: title ?? q.title ?? `Договор по КП ${q.number}`,
      proposalId: q._id.toString(),
      organizationId: q.organizationId.toString(),
      customerId: q.counterpartyId.toString(),
      status: 'draft',
      notes: q.notes,
      items: q.items.map((i) => ({
        productId: i.productId.toString(),
        productName: i.productName,
        quantity: i.quantity,
        unit: i.unit,
        unitPrice: i.unitPrice,
      })),
    });
    q.status = 'converted';
    q.convertedContractId = contract._id.toString();
    await q.save();
    return { quotation: q, contractId: contract._id.toString() };
  }

  async convertToOrder(
    id: string,
    deliveryAddress?: string,
    managerId?: string,
  ): Promise<{ quotation: QuotationDocument; orderId: string }> {
    // Use unpopulated query so counterpartyId is a raw ObjectId.
    const q = await this.findByIdRaw(id);
    this.assertConvertibleFamilyRole(q);
    if (q.status === 'converted') {
      throw new NotFoundException(`Quotation already converted`);
    }
    // TZ-ORDERS-301 §strip-commerce: an order may only be created from an
    // ACCEPTED proposal — draft/sent/rejected/cancelled are not convertible.
    if (q.status !== 'accepted') {
      throw new BadRequestException(
        `Cannot convert quotation in status "${q.status}" to an order — only "accepted" is convertible`,
      );
    }
    if (!q.counterpartyId) {
      throw new BadRequestException('Нельзя создать заказ без клиента в КП');
    }
    const site = await this.sites.ensureDefaultForCounterparty(
      q.counterpartyId.toString(),
      deliveryAddress,
    );
    const order = await this.orderService.create({
      counterpartyId: q.counterpartyId.toString(),
      siteId: site._id.toString(),
      quotationId: q._id.toString(),
      status: 'draft',
      deliveryAddress,
      managerId,
      items: q.items.map((i) => ({
        // COPY: FK is immutable. SNAPSHOT: name/sku survive catalog renames.
        productId: i.productId.toString(),
        productName: i.productName,
        productSku: i.productSku,
        quantity: i.quantity,
        unit: i.unit,
        // DROP: commerce (unitPrice/total/discount) is NOT copied — the
        // order carries quantity + FK + inline snapshot only. Order.total
        // stays 0 (stripped) per the strip-commerce manifest.
      })),
    });
    q.status = 'converted';
    q.convertedOrderId = order._id.toString();
    await q.save();
    return { quotation: q, orderId: order._id.toString() };
  }

  private mapSheetLayout(
    layout:
      | CreateQuotationDto['sheetLayout']
      | QuotationDocument['sheetLayout']
      | undefined,
  ): {
    rowsFirstPage: number;
    rowsNextPage: number;
    photoScalePercent: number;
    photoCropYPercent: number;
    showPhotoColumn: boolean;
    tableFontSize: number;
    tableHeaderFontSize: number;
  } {
    return {
      rowsFirstPage: Math.min(200, Math.max(0, layout?.rowsFirstPage ?? 0)),
      rowsNextPage: Math.min(200, Math.max(0, layout?.rowsNextPage ?? 0)),
      photoScalePercent: Math.min(
        400,
        Math.max(10, layout?.photoScalePercent ?? 100),
      ),
      photoCropYPercent: Math.min(
        100,
        Math.max(0, layout?.photoCropYPercent ?? 0),
      ),
      showPhotoColumn: layout?.showPhotoColumn ?? true,
      tableFontSize: Math.min(
        20,
        Math.max(8, Math.round(layout?.tableFontSize ?? 12)),
      ),
      tableHeaderFontSize: Math.min(
        20,
        Math.max(8, Math.round(layout?.tableHeaderFontSize ?? 12)),
      ),
    };
  }

  private mapTerms(
    terms: CreateQuotationDto['terms'] | QuotationDocument['terms'],
  ): Array<{ text: string; sortOrder: number }> {
    return (terms ?? [])
      .map((term, index) => ({
        text: String(term.text ?? ''),
        sortOrder: term.sortOrder ?? index,
      }))
      .filter((term) => term.text.trim().length > 0)
      .map((term, sortOrder) => ({ ...term, sortOrder }));
  }

  private applyDiscount(
    subtotal: number,
    discountType: CreateQuotationDto['discountType'],
    discountPercent?: number,
    discountAmount?: number,
  ): number {
    const discounted =
      discountType === 'percent'
        ? subtotal * (1 - (discountPercent ?? 0) / 100)
        : discountType === 'amount'
          ? subtotal - (discountAmount ?? 0)
          : subtotal;
    return Math.max(0, Math.round(discounted * 100) / 100);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
