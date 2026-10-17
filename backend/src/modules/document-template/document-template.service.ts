import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import {
  DocumentTemplate,
  DocumentTemplateDocument,
} from './document-template.schema';
import { CreateDocumentTemplateDto } from './dto/create-document-template.dto';
import { UpdateDocumentTemplateDto } from './dto/update-document-template.dto';
import {
  BuildDocumentDto,
  BuildPreviewLineDto,
} from './dto/build-document.dto';
import {
  TemplateBlock,
  TemplateBlockDocument,
  type DataBinding,
} from '../template-block/template-block.schema';
import { CounterService } from '../counter/counter.service';
import { Quotation, QuotationDocument } from '../quotation/quotation.schema';
import { Contract, ContractDocument } from '../contract/contract.schema';
import { Order, OrderDocument } from '../order/order.schema';
import {
  Organization,
  OrganizationDocument,
} from '../organization/organization.schema';
import {
  Counterparty,
  CounterpartyDocument,
} from '../counterparty/counterparty.schema';
import { Invoice, InvoiceDocument } from '../invoice/invoice.schema';
import { Person, PersonDocument } from '../person/person.schema';
import { Site, SiteDocument } from '../site/site.schema';
import { Product, ProductDocument } from '../product/product.schema';
import { Material, MaterialDocument } from '../material/material.schema';
import { WorkType, WorkTypeDocument } from '../work-type/work-type.schema';
import { TableTemplateService } from '../table-template/table-template.service';
import {
  KP_LINE_ITEM_COLUMNS,
  TableTemplateDocument,
} from '../table-template/table-template.schema';
import { TextBlock, TextBlockDocument } from '../text-block/text-block.schema';
import { DocumentTemplateCategoryService } from '../document-template-category/document-template-category.service';
import {
  DocumentRenderService,
  escapeHtmlValue,
} from '../document-render/document-render.service';
import { DocType, DocTypeDocument } from '../doc-type/doc-type.schema';
import {
  BLANK_A4_SENTINEL_TAG,
  BLANK_A4_TEMPLATE_NAME,
} from './blank-a4-template.constants';

export { normalizeSubstitutionHtml } from '../document-render/document-render.service';

/**
 * TZ-86 Phase A.4 — DocumentTemplateService extended.
 *
 * New responsibility: `build(id, dto)` — renders an HTML preview of the
 * template using `dataBinding` subdocs to live-resolve block content from
 * a caller-supplied sourceIds map. Distinct from the legacy `preview(id, dataId?)`
 * which auto-detects a single Quotation/Contract/Order for substitution.
 *
 * Algorithm:
 *  1. findExpanded(id) → { template, blocks[] } in display order.
 *  2. resolveSourceIds(dto) → flat `{ organization: {...}, counterparty: {...}, ... }`
 *     bag built via Promise.all parallel lookups (Schema.lean() for speed).
 *  3. resolveBlockContent(b, bag, dto) → TemplateBlockDocument with content
 *     replaced by resolved binding value:
 *       - dataBinding.source === 'static' → use binding.value raw
 *       - dataBinding.source ∈ data sources → look up bag[source], read field
 *       - missing source / missing field → empty (deterministic placeholder)
 *  4. Hand off to existing private renderHtml(template, resolvedBlocks, bag)
 *     so that blocks WITHOUT dataBinding still get `{{key.subkey}}` substitution
 *     against the bag (e.g. header `Документ № {{order.number}}` after build() loads
 *     the bag from orderId).
 *
 * MVP scope: only single-field reads (no nested-path). Format applied via
 * `formatValue()` for currency/date/number (Intl ru-RU defaults). Format hint
 * `text` and undefined fall through to raw String(value).
 *
 * TZ-DOC-307 — Category contract:
 *   - create() accepts an optional `categoryId`; when absent it resolves the
 *     active default category SERVER-SIDE in the template's org scope. When
 *     the default cannot be resolved, creation FAILS with a testable 400 and
 *     no template is persisted (no partial record).
 *   - update() validates any provided `categoryId` (exists + active + same
 *     org scope or system).
 *   - duplicate() preserves the source template's categoryId when it is still
 *     assignable; if the source category was deactivated/deleted/foreign in
 *     the meantime, it falls back to the server-side default so the copy
 *     NEVER persists a reference to an inactive category (TZ-DOC-307 §#9).
 *   - findAll() supports an optional `categoryId` filter.
 */
@Injectable()
export class DocumentTemplateService {
  /** A4 portrait content box (matches proposal-create-template-center). */
  private static readonly KP_A4_HEIGHT_PX = 1123;
  private static readonly DOC_CONTENT_PADDING_PX = 40;
  /** Fallback when line-items block has no layout.height (TZ-SALES-376). */
  private static readonly DEFAULT_ROWS_FIRST = 20;
  private static readonly DEFAULT_ROWS_NEXT = 25;

  constructor(
    @InjectModel(DocumentTemplate.name)
    private readonly model: Model<DocumentTemplateDocument>,
    @InjectModel(TemplateBlock.name)
    private readonly blockModel: Model<TemplateBlockDocument>,
    @InjectModel(Quotation.name)
    private readonly quotationModel: Model<QuotationDocument>,
    @InjectModel(Contract.name)
    private readonly contractModel: Model<ContractDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(Counterparty.name)
    private readonly counterpartyModel: Model<CounterpartyDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Material.name)
    private readonly materialModel: Model<MaterialDocument>,
    @InjectModel(WorkType.name)
    private readonly workTypeModel: Model<WorkTypeDocument>,
    @InjectModel(TextBlock.name)
    private readonly textBlockModel: Model<TextBlockDocument>,
    private readonly counter: CounterService,
    private readonly tableTemplateService: TableTemplateService,
    private readonly categoryService: DocumentTemplateCategoryService,
    @InjectModel(DocType.name)
    private readonly docTypeModel: Model<DocTypeDocument>,
    private readonly documentRender: DocumentRenderService,
    // Optional keeps isolated legacy unit fixtures valid while the Nest module
    // supplies the model in production (ASSETS-302 invoice bindings).
    @Optional()
    @InjectModel(Invoice.name)
    private readonly invoiceModel?: Model<InvoiceDocument>,
    @Optional()
    @InjectModel(Person.name)
    private readonly personModel?: Model<PersonDocument>,
    @Optional()
    @InjectModel(Site.name)
    private readonly siteModel?: Model<SiteDocument>,
  ) {}

  /**
   * TZ-DOC-307 §ШАГ 4 — resolve the category a NEW template must carry.
   *
   * Order:
   *   1. caller-provided `categoryId` → `assertAssignable` (exists, active,
   *      same org scope or system) — otherwise a testable 4xx.
   *   2. no categoryId → active default category in the template's org
   *      scope (org `isDefault` → system «Общее»).
   *   3. default unresolvable → BadRequestException (400); the template is
   *      NOT created partially.
   */
  private async resolveCategoryId(
    dto: Pick<CreateDocumentTemplateDto, 'categoryId' | 'organizationId'>,
  ): Promise<Types.ObjectId> {
    if (dto.categoryId) {
      const cat = await this.categoryService.assertAssignable(
        dto.categoryId,
        dto.organizationId,
      );
      return cat._id;
    }
    const fallback = await this.categoryService.resolveDefault(
      dto.organizationId,
    );
    if (!fallback) {
      throw new BadRequestException(
        'Не удалось определить категорию шаблона: нет активной категории по умолчанию. Создайте категорию шаблонов или активируйте системную «Общее».',
      );
    }
    return fallback._id;
  }

  /**
   * TZ-251 §ШАГ 2 — set `createdBy` on create.
   *
   * `userId` is OPTIONAL for backward compatibility with any callers that
   * haven't been updated. When provided AND valid, the new template is
   * tagged with the creator. When missing or invalid, `createdBy` is
   * `undefined` and the template enters the "legacy data" fallback
   * branch in `OwnershipGuard` (deferred to RBAC).
   *
   * The IDOR ladder in OwnershipGuard is robust to either case.
   *
   * TZ-DOC-307 — the created template ALWAYS carries `categoryId`
   * (validated or server-side default).
   */
  async create(
    dto: CreateDocumentTemplateDto,
    userId?: string,
  ): Promise<DocumentTemplateDocument> {
    if (dto.isDefault) {
      await this.model.updateMany(
        {
          organizationId: new Types.ObjectId(dto.organizationId),
          docTypeId: new Types.ObjectId(dto.docTypeId),
          isDefault: true,
        },
        { $set: { isDefault: false } },
      );
    }
    const categoryId = await this.resolveCategoryId(dto);
    return this.model.create({
      name: dto.name,
      description: dto.description,
      tags: dto.tags ?? [],
      organizationId: new Types.ObjectId(dto.organizationId),
      docTypeId: new Types.ObjectId(dto.docTypeId),
      categoryId,
      isDefault: dto.isDefault ?? false,
      isActive: dto.isActive ?? true,
      pageSize: dto.pageSize ?? 'A4',
      backgroundImage: dto.backgroundImage ?? [],
      defaultBackgroundIndex: dto.defaultBackgroundIndex ?? -1,
      backgroundOpacity: dto.backgroundOpacity ?? 0.3,
      orientation: dto.orientation ?? 'portrait',
      pageNumbering: dto.pageNumbering ?? false,
      defaultSheetLayout: dto.defaultSheetLayout ?? { rowsFirstPage: 0, rowsNextPage: 0 },
      version: dto.version ?? 1,
      notes: dto.notes,
      sourceFileRef: dto.sourceFileRef,
      draftSource: dto.draftSource ?? null,
      createdBy:
        userId && Types.ObjectId.isValid(userId)
          ? new Types.ObjectId(userId)
          : undefined,
    });
  }

  /**
   * TZ-DOC-STUDIO-2004 — idempotent per-org sentinel for blank studio finalize.
   * Satisfies GeneratedDocument.templateId required without making it optional globally.
   *
   * TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM — hardened against the two
   * ways duplicates crept in live: (a) a boot-seed / finalize race both
   * finding none and both creating one, (b) a stale duplicate already sitting
   * in the DB from before this TZ. `findAndDedupeBlankA4Sentinel` always
   * re-checks and folds any extras down to one before deciding whether to
   * create; the `create` itself is wrapped for the race case where another
   * caller wins between that check and this write (unique index, where
   * enforced, turns that into an 11000 duplicate-key error — re-find instead
   * of throwing, since the other writer's row is exactly what we wanted).
   */
  async ensureBlankA4Sentinel(organizationId: string): Promise<DocumentTemplateDocument> {
    if (!Types.ObjectId.isValid(organizationId)) {
      throw new BadRequestException('organizationId must be a valid ObjectId');
    }
    const orgObjectId = new Types.ObjectId(organizationId);
    const existing = await this.findAndDedupeBlankA4Sentinel(orgObjectId);
    if (existing) {
      return existing;
    }

    const docType = await this.docTypeModel
      .findOne({ isActive: true })
      .sort({ slug: 1 })
      .exec();
    if (!docType) {
      throw new BadRequestException(
        'Не удалось создать системный шаблон «Пустой A4»: нет активного типа документа. Создайте тип документа в справочнике.',
      );
    }

    const categoryId = await this.resolveCategoryId({ organizationId });
    try {
      return await this.model.create({
        name: BLANK_A4_TEMPLATE_NAME,
        tags: [BLANK_A4_SENTINEL_TAG],
        organizationId: orgObjectId,
        docTypeId: docType._id,
        categoryId,
        isDefault: false,
        isActive: true,
        pageSize: 'A4',
        orientation: 'portrait',
        backgroundImage: [],
        defaultBackgroundIndex: -1,
        backgroundOpacity: 0.3,
        pageNumbering: false,
        defaultSheetLayout: { rowsFirstPage: 0, rowsNextPage: 0 },
        version: 1,
        notes: 'System sentinel for blank studio documents (TZ-DOC-STUDIO-2004).',
      });
    } catch (err) {
      if (!this.isDuplicateKeyError(err)) throw err;
      const winner = await this.findAndDedupeBlankA4Sentinel(orgObjectId);
      if (winner) return winner;
      throw err;
    }
  }

  /**
   * Finds every non-deleted sentinel for this org; if more than one exists
   * (pre-TZ duplicates, or a lost create race), keeps the oldest and
   * soft-deletes the rest — never a hard wipe. Returns `null` only when no
   * sentinel exists yet at all.
   */
  private async findAndDedupeBlankA4Sentinel(
    orgObjectId: Types.ObjectId,
  ): Promise<DocumentTemplateDocument | null> {
    const candidates = await this.model
      .find({ organizationId: orgObjectId, tags: BLANK_A4_SENTINEL_TAG, deletedAt: null })
      .sort({ createdAt: 1 })
      .exec();
    if (candidates.length === 0) return null;
    const [keep, ...duplicates] = candidates;
    if (duplicates.length > 0) {
      await this.model
        .updateMany(
          { _id: { $in: duplicates.map((doc) => doc._id) } },
          { $set: { deletedAt: new Date() } },
        )
        .exec();
    }
    return keep;
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
  }

  /**
   * TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM — this is the UI-facing list
   * (picker / journal on `/studio`, `/studio/templates`): always excludes
   * soft-deleted rows and the internal blank-A4 sentinel, regardless of org
   * scope. An admin with no org in the JWT used to see every organization's
   * sentinel copy here; a scoped org user saw their own org's sentinel
   * alongside real templates. The sentinel itself is untouched — finalize
   * (`ensureBlankA4Sentinel`) queries the same tag directly, not through
   * this method.
   */
  async findAll(
    organizationId?: string,
    docTypeId?: string,
    isDefault?: boolean,
    categoryId?: string,
  ): Promise<DocumentTemplateDocument[]> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      tags: { $ne: BLANK_A4_SENTINEL_TAG },
    };
    if (organizationId) {
      if (!Types.ObjectId.isValid(organizationId)) return [];
      filter.organizationId = new Types.ObjectId(organizationId);
    }
    if (docTypeId) {
      if (!Types.ObjectId.isValid(docTypeId)) return [];
      filter.docTypeId = new Types.ObjectId(docTypeId);
    }
    if (typeof isDefault === 'boolean') filter.isDefault = isDefault;
    if (categoryId) {
      if (!Types.ObjectId.isValid(categoryId)) return [];
      filter.categoryId = new Types.ObjectId(categoryId);
    }
    return this.model
      .find(filter)
      .populate('organizationId')
      .populate('docTypeId')
      .populate('categoryId')
      .sort({ name: 1 })
      .exec();
  }

  async findById(id: string): Promise<DocumentTemplateDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`DocumentTemplate ${id} not found`);
    }
    const doc = await this.model
      .findById(id)
      .populate('organizationId')
      .populate('docTypeId')
      .populate('categoryId')
      .exec();
    if (!doc) throw new NotFoundException(`DocumentTemplate ${id} not found`);
    return doc;
  }

  async findExpanded(id: string): Promise<{
    template: DocumentTemplateDocument;
    blocks: TemplateBlockDocument[];
  }> {
    const template = await this.findById(id);
    const blocks = await this.blockModel
      .find({ templateId: template._id, isActive: true })
      .sort({ order: 1 })
      .exec();
    return { template, blocks };
  }

  async update(
    id: string,
    dto: UpdateDocumentTemplateDto,
  ): Promise<DocumentTemplateDocument> {
    const doc = await this.findById(id);
    if (dto.isDefault === true) {
      await this.model.updateMany(
        {
          _id: { $ne: doc._id },
          organizationId: doc.organizationId,
          docTypeId: doc.docTypeId,
          isDefault: true,
        },
        { $set: { isDefault: false } },
      );
    }
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.tags !== undefined) doc.tags = dto.tags;
    if (dto.isDefault !== undefined) doc.isDefault = dto.isDefault;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.pageSize !== undefined) doc.pageSize = dto.pageSize;
    if (dto.backgroundImage !== undefined)
      doc.backgroundImage = dto.backgroundImage;
    if (dto.backgroundOpacity !== undefined)
      doc.backgroundOpacity = dto.backgroundOpacity;
    if (dto.pageNumbering !== undefined) doc.pageNumbering = dto.pageNumbering;
    if (dto.defaultSheetLayout !== undefined) doc.defaultSheetLayout = dto.defaultSheetLayout;
    if (dto.orientation !== undefined) doc.orientation = dto.orientation;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.version !== undefined) doc.version = dto.version;
    if (dto.categoryId !== undefined) {
      const orgRef = this.refId(doc.organizationId);
      const cat = await this.categoryService.assertAssignable(
        dto.categoryId,
        orgRef ?? '',
      );
      doc.categoryId = cat._id;
    }
    return doc.save();
  }

  /**
   * TZ-251 §ШАГ 2 — duplicate propagates createdBy to the NEW template.
   *
   * Note: source template ownership is enforced upstream by the
   * OwnershipGuard on the `:id/duplicate` route (Step 8). After passing
   * the source-own check, the newly duplicated template's `createdBy`
   * is set to the ACTING user (`userId`), not the source creator —
   * because the copy is a fresh resource owned by whoever performed the
   * action.
   *
   * TZ-DOC-307 — duplicate PRESERVES the source template's categoryId
   * (no new category record is created server-side; the reference is
   * copied verbatim) — provided the source category is still assignable.
   * If it was deactivated, deleted or moved to another org in the
   * meantime, the copy falls back to the server-side default so we never
   * persist a reference to an inactive category. If no default exists,
   * duplication fails with a testable 400 and nothing is written.
   */
  async duplicate(
    id: string,
    userId?: string,
  ): Promise<DocumentTemplateDocument> {
    const src = await this.findById(id);
    const srcOrgRef = this.refId(src.organizationId);
    const srcCategoryRef = this.refId(src.categoryId);
    let categoryId: Types.ObjectId | undefined = srcCategoryRef
      ? new Types.ObjectId(srcCategoryRef)
      : undefined;
    if (categoryId) {
      try {
        const cat = await this.categoryService.assertAssignable(
          categoryId.toString(),
          srcOrgRef ?? '',
        );
        categoryId = cat._id;
      } catch {
        // Source category no longer assignable → server-side default.
        const fallback = await this.categoryService.resolveDefault(
          srcOrgRef ?? null,
        );
        if (!fallback) {
          throw new BadRequestException(
            'Не удалось определить категорию шаблона: исходная категория недоступна и нет активной категории по умолчанию.',
          );
        }
        categoryId = fallback._id;
      }
    }
    const newTemplate = await this.model.create({
      name: `${src.name} (копия)`,
      description: src.description,
      tags: src.tags,
      organizationId: src.organizationId,
      docTypeId: src.docTypeId,
      categoryId,
      isDefault: false,
      isActive: src.isActive,
      pageSize: src.pageSize,
      orientation: src.orientation,
      backgroundImage: src.backgroundImage,
      defaultBackgroundIndex: src.defaultBackgroundIndex,
      backgroundOpacity: src.backgroundOpacity,
      headerText: src.headerText,
      footerText: src.footerText,
      pageNumbering: src.pageNumbering,
      tableOfContents: src.tableOfContents,
      defaultSheetLayout: src.defaultSheetLayout,
      version: 1,
      notes: src.notes,
      createdBy:
        userId && Types.ObjectId.isValid(userId)
          ? new Types.ObjectId(userId)
          : undefined,
    });
    // Duplicate blocks
    const blocks = await this.blockModel.find({ templateId: src._id }).exec();
    for (const b of blocks) {
      await this.blockModel.create({
        templateId: newTemplate._id,
        type: b.type,
        order: b.order,
        title: b.title,
        content: b.content,
        columns: b.columns,
        height: b.height,
        showLine: b.showLine,
        settings: b.settings,
        dataBinding: b.dataBinding,
        layout: b.layout,
        source: b.source,
        isActive: b.isActive,
      });
    }
    return newTemplate;
  }

  async setDefault(id: string): Promise<DocumentTemplateDocument> {
    const doc = await this.findById(id);
    await this.model.updateMany(
      {
        _id: { $ne: doc._id },
        organizationId: doc.organizationId,
        docTypeId: doc.docTypeId,
        isDefault: true,
      },
      { $set: { isDefault: false } },
    );
    doc.isDefault = true;
    return doc.save();
  }

  // ── Phase A.4 — DataBinding-aware build (TZ-86 §2.6) ───────────────────────────────

  /**
   * Render a template to inline HTML using caller-supplied sourceIds map.
   * Public POST /api/document-templates/:id/build endpoint.
   *
   * Returns the rendered HTML string. Service is read-only (no DB writes);
   * AuditInterceptor auto-skips logging because no @AuditAction decorator.
   */
  /**
   * Validate that caller-supplied build sources belong to the authenticated
   * organization before generated-document persistence can occur. Global and
   * legacy records without an organization remain readable; a concrete
   * foreign organization is rejected without revealing its existence.
   */
  async assertBuildSourcesInOrganization(
    dto: BuildDocumentDto,
    organizationId: string,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(organizationId)) {
      throw new NotFoundException('Organization not found');
    }

    const assertMatch = (value: unknown): void => {
      if (value === null || value === undefined) return;
      if (String(value) !== organizationId) {
        throw new NotFoundException('Source not found');
      }
    };
    const assertSource = (source: unknown): void => {
      if (!source || typeof source !== 'object') {
        throw new NotFoundException('Source not found');
      }
      assertMatch((source as { organizationId?: unknown }).organizationId);
    };
    const assertOrganizationSource = (source: unknown): void => {
      if (!source || typeof source !== 'object') {
        throw new NotFoundException('Source not found');
      }
      const sourceOrgId = (source as { organizationId?: unknown })
        .organizationId;
      if (String(sourceOrgId ?? '') !== organizationId) {
        throw new NotFoundException('Source not found');
      }
    };
    const requireSourceId = (value: string | undefined): string | undefined => {
      if (value === undefined) return undefined;
      if (!Types.ObjectId.isValid(value)) {
        throw new NotFoundException('Source not found');
      }
      return value;
    };

    if (dto.organizationId) assertMatch(dto.organizationId);

    const counterpartyId = requireSourceId(dto.counterpartyId);
    if (counterpartyId) {
      const counterparty = await this.counterpartyModel
        .findById(counterpartyId)
        .lean()
        .exec();
      assertSource(counterparty);
    }
    const quotationId = requireSourceId(dto.quotationId);
    if (quotationId) {
      const quotation = await this.quotationModel
        .findById(quotationId)
        .lean()
        .exec();
      assertOrganizationSource(quotation);
      if (quotation?.counterpartyId) {
        const counterpartyId = requireSourceId(
          String(quotation.counterpartyId),
        );
        const counterparty = await this.counterpartyModel
          .findById(counterpartyId)
          .lean()
          .exec();
        assertOrganizationSource(counterparty);
      }
    }
    const invoiceId = requireSourceId(dto.invoiceId);
    if (invoiceId) {
      if (!this.invoiceModel) throw new NotFoundException('Source not found');
      const invoice = await this.invoiceModel.findById(invoiceId).lean().exec();
      if (!invoice) throw new NotFoundException('Source not found');
      if (invoice.supplierOrgId) assertMatch(invoice.supplierOrgId);
      if (invoice.supplierId) {
        const supplierId = requireSourceId(String(invoice.supplierId));
        const supplier = await this.counterpartyModel
          .findById(supplierId)
          .lean()
          .exec();
        assertOrganizationSource(supplier);
      }
    }
    const contactPersonId = requireSourceId(dto.contactPersonId);
    if (contactPersonId) {
      if (!this.personModel) throw new NotFoundException('Source not found');
      const person = await this.personModel
        .findById(contactPersonId)
        .lean()
        .exec();
      if (!person) throw new NotFoundException('Source not found');
    }
    const siteId = requireSourceId(dto.siteId);
    if (siteId) {
      if (!this.siteModel) throw new NotFoundException('Source not found');
      const site = await this.siteModel.findById(siteId).lean().exec();
      if (!site) throw new NotFoundException('Source not found');
      if (
        dto.counterpartyId &&
        String(site.counterpartyId) !== dto.counterpartyId
      ) {
        throw new NotFoundException('Source not found');
      }
    }
    const productId = requireSourceId(dto.productId);
    if (productId) {
      const product = await this.productModel.findById(productId).lean().exec();
      assertSource(product);
    }
    const materialId = requireSourceId(dto.materialId);
    if (materialId) {
      const material = await this.materialModel
        .findById(materialId)
        .lean()
        .exec();
      assertSource(material);
    }
    const workTypeId = requireSourceId(dto.workTypeId);
    if (workTypeId) {
      const workType = await this.workTypeModel
        .findById(workTypeId)
        .lean()
        .exec();
      if (!workType) throw new NotFoundException('Source not found');
    }
    const contractId = requireSourceId(dto.contractId);
    if (contractId) {
      const contract = await this.contractModel
        .findById(contractId)
        .lean()
        .exec();
      assertSource(contract);
      if (contract?.customerId) {
        const customerId = requireSourceId(String(contract.customerId));
        const counterparty = await this.counterpartyModel
          .findById(customerId)
          .lean()
          .exec();
        assertOrganizationSource(counterparty);
      }
    }
    const orderId = requireSourceId(dto.orderId);
    if (orderId) {
      const order = await this.orderModel.findById(orderId).lean().exec();
      if (!order) throw new NotFoundException('Source not found');
      if (!order.counterpartyId)
        throw new NotFoundException('Source not found');
      assertSource(order);
      if (order.contractId) {
        const contractId = requireSourceId(String(order.contractId));
        const contract = await this.contractModel
          .findById(contractId)
          .lean()
          .exec();
        assertOrganizationSource(contract);
      }
      if (order.quotationId) {
        const quotationId = requireSourceId(String(order.quotationId));
        const quotation = await this.quotationModel
          .findById(quotationId)
          .lean()
          .exec();
        assertOrganizationSource(quotation);
      }

      if (order.counterpartyId) {
        const counterpartyId = requireSourceId(String(order.counterpartyId));
        const counterparty = await this.counterpartyModel
          .findById(counterpartyId)
          .lean()
          .exec();
        assertOrganizationSource(counterparty);
      }
      // Orders are legacy shared records and do not carry organizationId.
      // Their organization boundary is therefore enforced through every
      // organization-scoped relation that can be rendered from the order.
      for (const item of order.items ?? []) {
        if (!item.productId) {
          throw new NotFoundException('Source not found');
        }
        const productId = requireSourceId(String(item.productId));
        const product = await this.productModel
          .findById(productId)
          .lean()
          .exec();
        assertOrganizationSource(product);
      }
    }
  }

  async build(templateId: string, dto: BuildDocumentDto): Promise<string> {
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException(`Invalid templateId ${templateId}`);
    }
    const { template, blocks } = await this.findExpanded(templateId);
    const bag = await this.resolveSourceIds(dto);
    await this.applyIssuerOrganization(template, bag);
    this.mergeDraftContextIntoBag(dto, bag);
    const termsHtml = this.renderQuotationTerms(dto, bag);
    const lineItemsTargetIds = this.resolveLineItemsTargetIds(
      blocks,
      dto.tableTargetId,
    );
    const pages = this.splitPreviewLines(
      dto.previewLines,
      dto.sheetLayout,
      blocks,
      lineItemsTargetIds,
    );
    const pageBlocks: TemplateBlockDocument[][] = [];

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const isLastPage = pageIndex === pages.length - 1;
      const pageLines =
        dto.previewLines === undefined ? undefined : pages[pageIndex];
      const resolved = await Promise.all(
        blocks.map(async (b) => {
          const settings = b.settings as { role?: string } | undefined;
          if (settings?.role === 'terms' && !isLastPage) return null;

          // TZ-SALES-377: Continuation pages
          // On intermediate pages (pageIndex > 0 && !isLastPage), drop all blocks except line-items tables.
          // On the last page (pageIndex > 0 && isLastPage), we also want to drop top decorative blocks 
          // (like headers/logos) so they don't repeat, but keep bottom blocks (signatures, terms).
          // We approximate "top blocks" as any non-table block that is positioned above the table.
          // For MVP, the TZ explicitly asks to drop non-line-items on `!isLastPage`.
          if (pageIndex > 0) {
            const isLineItems = lineItemsTargetIds.has(String(b._id));
            if (!isLastPage) {
              if (!isLineItems) return null;
            } else {
              // On the last page, drop blocks that are purely decorative and likely from page 1 header.
              // We'll keep terms, signatures, and blocks positioned below the table.
              // If layout is missing, keep it to be safe.
              if (!isLineItems && settings?.role !== 'terms' && b.type !== 'signature') {
                // Find the line-items table to compare Y position
                const tableBlock = blocks.find(tb => lineItemsTargetIds.has(String(tb._id)));
                const tableY = tableBlock?.layout?.y ?? 0;
                const thisY = b.layout?.y ?? 0;
                if (thisY < tableY) {
                  return null; // Drop header blocks on the last page too
                }
              }
            }
          }

          const withBinding = await this.resolveBlockContent(b, bag);
          const rendered = await this.resolveTableBlock(
            withBinding,
            pageLines,
            lineItemsTargetIds.has(String(b._id)),
            dto.tableLayout,
            isLastPage ? dto.dealTotals : undefined,
            dto.sheetLayout,
            dto.tableChrome,
            isLastPage &&
            lineItemsTargetIds.has(String(b._id)) &&
            dto.previewLines !== undefined
              ? dto.previewLines
              : undefined,
          );
          return settings?.role === 'terms' && termsHtml
            ? this.cloneResolvedBlock(rendered, { content: termsHtml })
            : rendered;
        }),
      );
      const filtered = resolved.filter((block): block is TemplateBlockDocument =>
        Boolean(block),
      );
      pageBlocks.push(
        pageIndex > 0
          ? filtered.map((block) =>
              this.remapContinuationTableBlock(block, lineItemsTargetIds),
            )
          : filtered,
      );
    }

    if (pageBlocks.length === 1) {
      return this.documentRender.renderHtml(template, pageBlocks[0], {
        ...bag,
        __termsHtml: termsHtml,
      });
    }
    return this.documentRender.renderHtmlPages(template, pageBlocks, {
      ...bag,
      __termsHtml: termsHtml,
    });
  }

  private splitPreviewLines(
    lines: BuildPreviewLineDto[] | undefined,
    layout: BuildDocumentDto['sheetLayout'],
    blocks: TemplateBlockDocument[],
    lineItemsTargetIds: Set<string>,
  ): BuildPreviewLineDto[][] {
    if (lines === undefined) return [[]];
    if (lines.length === 0) return [[]];
    const firstCapacity =
      layout?.rowsFirstPage && layout.rowsFirstPage > 0
        ? layout.rowsFirstPage
        : this.estimateAutoRowCapacity(
            blocks,
            lineItemsTargetIds,
            layout,
            true,
          );
    const nextCapacity =
      layout?.rowsNextPage && layout.rowsNextPage > 0
        ? layout.rowsNextPage
        : this.estimateAutoRowCapacity(
            blocks,
            lineItemsTargetIds,
            layout,
            false,
          );

    const result: BuildPreviewLineDto[][] = [[]];
    let pageIndex = 0;
    let rowsOnPage = 0;
    let capacity = firstCapacity;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const breakBefore =
        line.rowPresentation?.pageBreakBefore === true && index > 0;

      if (breakBefore && rowsOnPage > 0) {
        result.push([]);
        pageIndex += 1;
        rowsOnPage = 0;
        capacity = nextCapacity;
      } else if (rowsOnPage >= capacity && rowsOnPage > 0) {
        result.push([]);
        pageIndex += 1;
        rowsOnPage = 0;
        capacity = nextCapacity;
      }

      if (!result[pageIndex]) result[pageIndex] = [];
      result[pageIndex].push(line);
      rowsOnPage += this.previewLineWeight(line);
    }

    return result;
  }

  /** Conservative table-row budget for product name + description wrapping. */
  private previewLineWeight(line: BuildPreviewLineDto): number {
    const textLength = `${line.productName ?? ''}${line.description ?? ''}`.length;
    const extraWrap = Math.min(3, Math.max(0, Math.ceil(textLength / 36) - 1));
    return 1 + extraWrap;
  }

  /**
   * TZ-SALES-376/378 — estimate rows that fit when rowsFirstPage/rowsNextPage = 0.
   * Page 1 uses the template table frame (layout.height); continuation pages use
   * the full A4 content area (~1.0), not the short first-page frame.
   */
  private estimateAutoRowCapacity(
    blocks: TemplateBlockDocument[],
    lineItemsTargetIds: Set<string>,
    sheetLayout: BuildDocumentDto['sheetLayout'] | undefined,
    isFirstPage: boolean,
  ): number {
    const targetBlock = blocks.find((block) =>
      lineItemsTargetIds.has(String(block._id)),
    );
    const frameHeight = targetBlock?.layout?.height;
    const layoutHeight = isFirstPage ? frameHeight : 1;
    if (
      !targetBlock ||
      layoutHeight === undefined ||
      !(layoutHeight > 0)
    ) {
      return isFirstPage
        ? DocumentTemplateService.DEFAULT_ROWS_FIRST
        : DocumentTemplateService.DEFAULT_ROWS_NEXT;
    }

    const pageContentHeightPx =
      DocumentTemplateService.KP_A4_HEIGHT_PX -
      DocumentTemplateService.DOC_CONTENT_PADDING_PX;
    const slotHeightPx = pageContentHeightPx * layoutHeight;

    const headerFontPx = this.clampTableFontPx(
      sheetLayout?.tableHeaderFontSize,
      12,
    );
    const bodyFontPx = this.clampTableFontPx(sheetLayout?.tableFontSize, 12);
    const theadHeightPx = headerFontPx + 16 + 2;

    const showPhoto = sheetLayout?.showPhotoColumn !== false;
    const photoScale = Math.min(
      400,
      Math.max(10, sheetLayout?.photoScalePercent ?? 100),
    );
    const photoCellPx = showPhoto
      ? Math.min(120, Math.max(10, (48 * photoScale) / 100))
      : 0;

    const baseRowPx = bodyFontPx * 1.5 + 12;
    const rowHeightPx = Math.max(baseRowPx, photoCellPx + 8);

    const usablePx = Math.max(0, slotHeightPx - theadHeightPx);
    const capacity = Math.floor(usablePx / rowHeightPx);

    return Math.min(200, Math.max(1, capacity));
  }

  private clampTableFontPx(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(20, Math.max(8, Math.round(value)));
  }

  /**
   * TZ-SALES-378 — continuation pages stretch the line-items table to full sheet.
   */
  private remapContinuationTableBlock(
    block: TemplateBlockDocument,
    lineItemsTargetIds: Set<string>,
  ): TemplateBlockDocument {
    if (
      block.type !== 'table' ||
      !lineItemsTargetIds.has(String(block._id)) ||
      !block.layout
    ) {
      return block;
    }
    return this.cloneResolvedBlock(block, {
      layout: {
        ...block.layout,
        y: 0,
        height: 1,
      },
    });
  }

  private renderQuotationTerms(
    dto: BuildDocumentDto,
    bag: Record<string, unknown>,
  ): string {
    const quotation = bag.quotation as Record<string, unknown> | undefined;
    const counterparty = bag.counterparty as
      Record<string, unknown> | undefined;
    const terms = (dto.terms ?? [])
      .map((term, index) => ({
        text: term.text,
        sortOrder: term.sortOrder ?? index,
      }))
      .filter((term) => term.text.trim().length > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (terms.length === 0) return '';
    const values: Record<string, string> = {
      client_name: String(counterparty?.['name'] ?? ''),
      kp_number: String(dto.proposalNumber ?? quotation?.['number'] ?? ''),
      total_price: this.formatValue(
        dto.totalPrice ?? quotation?.['total'],
        'currency',
      ),
      date: this.formatValue(dto.proposalDate ?? quotation?.['date'], 'date'),
      valid_until: this.formatValue(
        dto.validUntil ?? quotation?.['validUntil'],
        'date',
      ),
      prepayment_percent: String(
        dto.dealTotals?.prepaymentPercent ??
          quotation?.['prepaymentPercent'] ??
          '',
      ),
      production_days: String(
        dto.dealTotals?.productionDays ?? quotation?.['productionDays'] ?? '',
      ),
      delivery_days: String(
        dto.dealTotals?.deliveryDays ?? quotation?.['deliveryDays'] ?? '',
      ),
    };
    return terms
      .map((term) => {
        const text = escapeHtmlValue(term.text).replace(
          /\{\{([a-z_]+)\}\}/g,
          (token, key: string) => values[key] ?? token,
        );
        return `<p>${text.replace(/\n+/g, '<br>')}</p>`;
      })
      .join('');
  }

  /**
   * Mongoose documents expose persisted fields through `_doc`, so spreading a
   * hydrated block drops fields such as `layout`. Always clone to a plain
   * object before applying build-time overrides.
   */
  private cloneResolvedBlock(
    block: TemplateBlockDocument,
    overrides: Partial<TemplateBlock>,
  ): TemplateBlockDocument {
    const plain =
      typeof (block as TemplateBlockDocument & { toObject?: unknown })
        .toObject === 'function'
        ? (block as TemplateBlockDocument).toObject({ virtuals: false })
        : block;
    return Object.assign({}, plain, overrides) as TemplateBlockDocument;
  }

  /**
   * Resolve table blocks and, when requested, inject request-only КП line items.
   * Explicit `kpLineItems`/`line-items` blocks win; otherwise exactly one live
   * table is the safe MVP target. Snapshot blocks are never changed.
   */
  private async resolveTableBlock(
    block: TemplateBlockDocument,
    previewLines?: BuildPreviewLineDto[],
    isLineItemsTarget = false,
    tableLayout?: { key: string; visible?: boolean; widthPercent?: number }[],
    dealTotals?: {
      vatPercent: number;
      discountType?: 'none' | 'percent' | 'amount';
      discountPercent?: number;
      discountAmount?: number;
      prepaymentPercent?: number;
      productionDays?: number;
      deliveryDays?: number;
    },
    sheetLayout?: BuildDocumentDto['sheetLayout'],
    tableChrome?: BuildDocumentDto['tableChrome'],
    allPreviewLinesForTotals?: BuildPreviewLineDto[],
  ): Promise<TemplateBlockDocument> {
    if (block.type !== 'table') return block;
    const source = block.source;
    const settings = block.settings as
      | {
          tableTemplateId?: string;
          kpLineItems?: boolean;
          role?: string;
        }
      | undefined;
    const tableTemplateId =
      source?.kind === 'table-template'
        ? source.refId
        : settings?.tableTemplateId;
    if (!tableTemplateId) return block;
    try {
      if (source?.kind === 'table-template' && source.mode === 'snapshot')
        return block;
      if (previewLines === undefined) {
        const html = await this.tableTemplateService.preview(tableTemplateId);
        return this.cloneResolvedBlock(block, { content: html });
      }

      const effectiveTableLayout = tableLayout?.filter(
        (entry) =>
          sheetLayout?.showPhotoColumn !== false || !this.isPhotoColumn(entry.key),
      );
      const rows = isLineItemsTarget
        ? await this.mapPreviewLines(tableTemplateId, previewLines, effectiveTableLayout, sheetLayout)
        : [];
      const lineAmount = (line: BuildPreviewLineDto): number =>
        line.quantity *
        line.unitPrice *
        (1 - Math.min(100, Math.max(0, line.discountPercent ?? 0)) / 100);
      const totalsSource = allPreviewLinesForTotals ?? previewLines;
      const baseTotal = isLineItemsTarget
        ? (totalsSource ?? [])
            .filter((line) => line.isOptional !== true)
            .reduce((sum, line) => sum + lineAmount(line), 0)
        : 0;
      const additionalTotal = isLineItemsTarget
        ? (totalsSource ?? [])
            .filter((line) => line.isOptional === true)
            .reduce((sum, line) => sum + lineAmount(line), 0)
        : 0;
      const total =
        dealTotals?.discountType === 'percent'
          ? baseTotal * (1 - (dealTotals.discountPercent ?? 0) / 100)
          : dealTotals?.discountType === 'amount'
            ? Math.max(0, baseTotal - (dealTotals.discountAmount ?? 0))
            : baseTotal;
      const totals =
        isLineItemsTarget && dealTotals
          ? { total, additionalTotal, vatPercent: dealTotals.vatPercent }
          : undefined;
      const html = await this.tableTemplateService.preview(
        tableTemplateId,
        rows,
        isLineItemsTarget ? effectiveTableLayout : undefined,
        totals,
        isLineItemsTarget ? sheetLayout : undefined,
        isLineItemsTarget ? tableChrome : undefined,
        isLineItemsTarget
          ? previewLines.map((line) => line.rowPresentation ?? {})
          : undefined,
      );
      return this.cloneResolvedBlock(block, { content: html });
    } catch {
      return block;
    }
  }

  private resolveLineItemsTargetIds(
    blocks: TemplateBlockDocument[],
    requestedTableTargetId?: string,
  ): Set<string> {
    const liveTables = blocks.filter((block) => {
      if (block.type !== 'table') return false;
      if (
        block.source?.kind === 'table-template' &&
        block.source.mode === 'snapshot'
      ) {
        return false;
      }
      const settings = block.settings as
        { tableTemplateId?: string } | undefined;
      return block.source?.kind === 'table-template'
        ? Boolean(block.source.refId)
        : Boolean(settings?.tableTemplateId);
    });
    if (requestedTableTargetId) {
      const requested = liveTables.filter((block) => {
        const sourceId =
          block.source?.kind === 'table-template'
            ? block.source.refId
            : undefined;
        const settings = block.settings as
          { tableTemplateId?: string } | undefined;
        return (
          sourceId === requestedTableTargetId ||
          settings?.tableTemplateId === requestedTableTargetId
        );
      });
      if (requested.length > 0)
        return new Set(requested.map((block) => String(block._id)));
    }

    const explicit = liveTables.filter((block) => {
      const settings = block.settings as
        { kpLineItems?: boolean; role?: string } | undefined;
      return settings?.kpLineItems === true || settings?.role === 'line-items';
    });
    const targets =
      explicit.length > 0
        ? explicit
        : liveTables.length === 1
          ? liveTables
          : [];
    return new Set(targets.map((block) => String(block._id)));
  }

  private async mapPreviewLines(
    tableTemplateId: string,
    lines: BuildPreviewLineDto[],
    tableLayout?: { key: string; visible?: boolean; widthPercent?: number }[],
    sheetLayout?: BuildDocumentDto['sheetLayout'],
  ): Promise<unknown[][]> {
    const table = await this.tableTemplateService.findById(tableTemplateId);
    const persistedColumns = (table.columns ?? []).filter(
      (column) =>
        sheetLayout?.showPhotoColumn !== false || !this.isPhotoColumn(column.key),
    );
    const layoutColumns = tableLayout
      ? tableLayout
          .filter((entry) => entry.visible !== false)
          .map(
            (entry) =>
              this.findPersistedLayoutColumn(persistedColumns, entry.key) ??
              this.syntheticKpColumn(entry.key),
          )
          .filter((column): column is NonNullable<typeof column> =>
            Boolean(column),
          )
      : [];
    const columns = layoutColumns.length > 0 ? layoutColumns : persistedColumns;
    return lines.map((line, rowIndex) =>
      columns.map((column) =>
        this.previewLineValue(column.key, line, rowIndex),
      ),
    );
  }

  /** Request-only columns merged by Create КП; the shared TableTemplate is unchanged. */
  private isPhotoColumn(key: string): boolean {
    return ['photo', 'image', 'рисунок', 'photourl', 'photoid', 'photo_id', 'photoids', 'photo_ids', 'фото'].includes(
      key.trim().toLowerCase(),
    );
  }

  private findPersistedLayoutColumn(
    persistedColumns: NonNullable<TableTemplateDocument['columns']>,
    layoutKey: string,
  ): NonNullable<TableTemplateDocument['columns']>[number] | undefined {
    const direct = persistedColumns.find((column) => column.key === layoutKey);
    if (direct) return direct;
    if (this.isPhotoColumn(layoutKey)) {
      return persistedColumns.find((column) => this.isPhotoColumn(column.key));
    }
    return undefined;
  }

  private syntheticKpColumn(
    key: string,
  ): NonNullable<TableTemplateDocument['columns']>[number] | null {
    const normalized = key.trim().toLowerCase();
    const aliases: Record<string, string[]> = {
      index: ['index', 'number', '№', 'номер'],
      productName: ['productname', 'name', 'title', 'product', 'наименование'],
      quantity: ['quantity', 'qty', 'count', 'кол-во', 'количество'],
      unit: ['unit', 'ед', 'ед.изм'],
      unitPrice: ['unitprice', 'price', 'unit_price', 'цена'],
      sum: ['sum', 'total', 'amount', 'сумма'],
      photo: ['photo', 'image', 'рисунок', 'photourl', 'photoid', 'photo_id', 'photoids', 'photo_ids', 'фото'],
    };
    const match = Object.entries(aliases).find(([, values]) =>
      values.includes(normalized),
    );
    if (!match) return null;
    const defaults = KP_LINE_ITEM_COLUMNS.find(
      (column) => column.key === match[0],
    );
    if (match[0] === 'photo') {
      return {
        key: 'photo',
        label: 'Фото',
        type: 'text',
        width: 100,
        align: 'center',
      } as NonNullable<TableTemplateDocument['columns']>[number];
    }
    return defaults
      ? ({ ...defaults } as NonNullable<
          TableTemplateDocument['columns']
        >[number])
      : null;
  }

  private previewLineValue(
    key: string,
    line: BuildPreviewLineDto,
    rowIndex = 0,
  ): unknown {
    const normalized = key.trim().toLowerCase();
    if (['index', 'number', '№', 'номер'].includes(normalized)) {
      return rowIndex + 1;
    }
    if (
      ['productname', 'name', 'title', 'product', 'наименование'].includes(
        normalized,
      )
    ) {
      return {
        kind: 'line-text',
        title: line.productName,
        description: line.description,
        optional: line.isOptional === true,
      };
    }
    if (
      ['quantity', 'qty', 'count', 'кол-во', 'количество'].includes(normalized)
    ) {
      return line.quantity;
    }
    if (['unitprice', 'price', 'unit_price', 'цена'].includes(normalized)) {
      return line.unitPrice;
    }
    if (['sum', 'total', 'amount', 'сумма'].includes(normalized)) {
      return (
        line.quantity *
        line.unitPrice *
        (1 - Math.min(100, Math.max(0, line.discountPercent ?? 0)) / 100)
      );
    }
    if (
      ['photo', 'image', 'рисунок', 'photourl', 'photoid', 'photo_id', 'photoids', 'photo_ids', 'фото'].includes(
        normalized,
      )
    ) {
      return { kind: 'image', url: line.photoUrl ?? '' };
    }
    if (['productsku', 'sku', 'article', 'артикул'].includes(normalized)) {
      return line.productSku ?? '';
    }
    if (['unit', 'ед', 'ед.изм'].includes(normalized)) {
      return line.unit ?? '';
    }
    return '';
  }

  /**
   * Parallel lookup of all data sources. Returns flat bag:
   *   `bag.organization = { _id, name, inn, ... }` etc.
   * Empty/invalid ids are silently skipped (defer to per-block resolution
   * which renders empty placeholders).
   *
   * Implementation note: each source is inlined (no shared `add<T>(model: Model<T>, …)`
   * helper) because TypeScript treats `Model<T>` invariant in generic
   * positions when various Mongoose document subtypes flow through, causing
   * TS2345 «not assignable» errors. Inlining avoids the variance problem
   * while keeping identical runtime behaviour.
   */
  private async resolveSourceIds(
    dto: Partial<BuildDocumentDto>,
  ): Promise<Record<string, unknown>> {
    const bag: Record<string, unknown> = {};
    const lookups: Array<Promise<void>> = [];

    if (dto.organizationId && Types.ObjectId.isValid(dto.organizationId)) {
      lookups.push(
        this.orgModel
          .findById(dto.organizationId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.organization = this.organizationRenderData(doc);
          }),
      );
    }
    if (dto.counterpartyId && Types.ObjectId.isValid(dto.counterpartyId)) {
      lookups.push(
        this.counterpartyModel
          .findById(dto.counterpartyId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.counterparty = doc;
          }),
      );
    }
    if (
      dto.contactPersonId &&
      Types.ObjectId.isValid(dto.contactPersonId) &&
      this.personModel
    ) {
      lookups.push(
        this.personModel
          .findById(dto.contactPersonId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.contactPerson = doc;
          }),
      );
    }
    if (dto.siteId && Types.ObjectId.isValid(dto.siteId) && this.siteModel) {
      lookups.push(
        this.siteModel
          .findById(dto.siteId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.site = doc;
          }),
      );
    }
    if (dto.productId && Types.ObjectId.isValid(dto.productId)) {
      lookups.push(
        this.productModel
          .findById(dto.productId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.product = doc;
          }),
      );
    }
    if (dto.materialId && Types.ObjectId.isValid(dto.materialId)) {
      lookups.push(
        this.materialModel
          .findById(dto.materialId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.material = doc;
          }),
      );
    }
    if (dto.workTypeId && Types.ObjectId.isValid(dto.workTypeId)) {
      lookups.push(
        this.workTypeModel
          .findById(dto.workTypeId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.workType = doc;
          }),
      );
    }
    if (dto.orderId && Types.ObjectId.isValid(dto.orderId)) {
      lookups.push(
        this.orderModel
          .findById(dto.orderId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.order = doc;
          }),
      );
    }
    if (dto.contractId && Types.ObjectId.isValid(dto.contractId)) {
      lookups.push(
        this.contractModel
          .findById(dto.contractId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.contract = doc;
          }),
      );
    }
    if (dto.quotationId && Types.ObjectId.isValid(dto.quotationId)) {
      lookups.push(
        this.quotationModel
          .findById(dto.quotationId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.quotation = doc;
          }),
      );
    }
    if (
      dto.invoiceId &&
      Types.ObjectId.isValid(dto.invoiceId) &&
      this.invoiceModel
    ) {
      lookups.push(
        this.invoiceModel
          .findById(dto.invoiceId)
          .lean()
          .exec()
          .then((doc) => {
            if (doc) bag.invoice = doc;
          }),
      );
    }

    await Promise.all(lookups);

    // Cascade related entities from order/contract so {{counterparty.*}} tokens resolve
    const order = bag.order as
      | {
          counterpartyId?: Types.ObjectId | string;
          quotationId?: Types.ObjectId | string;
        }
      | undefined;
    if (order?.quotationId && !bag.quotation) {
      const quotationId = String(order.quotationId);
      if (Types.ObjectId.isValid(quotationId)) {
        const quotation = await this.quotationModel
          .findById(quotationId)
          .lean()
          .exec();
        if (quotation) bag.quotation = quotation;
      }
    }
    if (order?.counterpartyId && !bag.counterparty) {
      const cpId = String(order.counterpartyId);
      if (Types.ObjectId.isValid(cpId)) {
        const cp = await this.counterpartyModel.findById(cpId).lean().exec();
        if (cp) bag.counterparty = cp;
      }
    }

    const contract = bag.contract as
      | {
          customerId?: Types.ObjectId | string;
          organizationId?: Types.ObjectId | string;
        }
      | undefined;
    if (contract?.customerId && !bag.counterparty) {
      const cpId = String(contract.customerId);
      if (Types.ObjectId.isValid(cpId)) {
        const cp = await this.counterpartyModel.findById(cpId).lean().exec();
        if (cp) bag.counterparty = cp;
      }
    }
    if (contract?.organizationId && !bag.organization) {
      const orgId = String(contract.organizationId);
      if (Types.ObjectId.isValid(orgId)) {
        const org = await this.orgModel.findById(orgId).lean().exec();
        if (org) bag.organization = this.organizationRenderData(org);
      }
    }

    const quotation = bag.quotation as
      | {
          counterpartyId?: Types.ObjectId | string;
          contactPersonId?: Types.ObjectId | string;
          siteId?: Types.ObjectId | string;
          organizationId?: Types.ObjectId | string;
        }
      | undefined;
    if (quotation?.counterpartyId && !bag.counterparty) {
      const cpId = String(quotation.counterpartyId);
      if (Types.ObjectId.isValid(cpId)) {
        const cp = await this.counterpartyModel.findById(cpId).lean().exec();
        if (cp) bag.counterparty = cp;
      }
    }
    if (quotation?.organizationId && !bag.organization) {
      const orgId = String(quotation.organizationId);
      if (Types.ObjectId.isValid(orgId)) {
        const org = await this.orgModel.findById(orgId).lean().exec();
        if (org) bag.organization = this.organizationRenderData(org);
      }
    }
    if (quotation?.contactPersonId && !bag.contactPerson) {
      const personId = String(quotation.contactPersonId);
      if (this.personModel && Types.ObjectId.isValid(personId)) {
        const person = await this.personModel.findById(personId).lean().exec();
        if (person) bag.contactPerson = person;
      }
    }
    if (quotation?.siteId && !bag.site) {
      const siteId = String(quotation.siteId);
      if (this.siteModel && Types.ObjectId.isValid(siteId)) {
        const site = await this.siteModel.findById(siteId).lean().exec();
        if (site) bag.site = site;
      }
    }
    const counterparty = bag.counterparty as
      Record<string, unknown> | undefined;
    const contactPerson = bag.contactPerson as
      Record<string, unknown> | undefined;
    const site = bag.site as Record<string, unknown> | undefined;
    if (counterparty) {
      const cpName =
        counterparty['name'] ?? counterparty['shortName'] ?? '';
      bag.counterparty = {
        ...counterparty,
        name: cpName,
        contactName: contactPerson
          ? [
              contactPerson['lastName'],
              contactPerson['firstName'],
              contactPerson['patronymic'],
            ]
              .filter(Boolean)
              .join(' ')
          : '',
        contactPosition: contactPerson?.['position'] ?? '',
        siteName: site?.['name'] ?? '',
        siteAddress: site?.['address'] ?? '',
      };
    }

    const invoice = bag.invoice as
      | {
          supplierId?: Types.ObjectId | string;
          supplierOrgId?: Types.ObjectId | string;
        }
      | undefined;
    if (invoice?.supplierId && !bag.counterparty) {
      const supplierId = String(invoice.supplierId);
      if (Types.ObjectId.isValid(supplierId)) {
        const supplier = await this.counterpartyModel
          .findById(supplierId)
          .lean()
          .exec();
        if (supplier) bag.counterparty = supplier;
      }
    }
    if (invoice?.supplierOrgId && !bag.organization) {
      const orgId = String(invoice.supplierOrgId);
      if (Types.ObjectId.isValid(orgId)) {
        const org = await this.orgModel.findById(orgId).lean().exec();
        if (org) bag.organization = this.organizationRenderData(org);
      }
    }

    return bag;
  }

  /**
   * TZ-NX-DOCSTUDIO-S8-1 — public read-only hydration for studio render.
   *
   * Reuses resolveSourceIds (organization/counterparty/quotation/order lookups
   * plus the order→quotation→counterparty and quotation→counterparty cascade)
   * so NX Document Studio preview/PDF resolve `{{counterparty.*}}` tokens from
   * `doc.context` without duplicating ~200 lines of hydration logic. Unlike
   * build() this performs NO validation side effects and NO draft-KP alias
   * merging — it is a pure data-bag builder.
   */
  async buildSubstitutionBag(
    dto: Partial<BuildDocumentDto> & { anchors?: Record<string, unknown> },
  ): Promise<Record<string, unknown>> {
    const bag = await this.resolveSourceIds(dto);
    const anchors = dto.anchors ?? {};
    const anchorEntries = Object.entries(anchors);
    for (const [anchorKey, raw] of anchorEntries) {
      if (!raw || typeof raw !== 'object') continue;
      const entityId = (raw as { entityId?: unknown }).entityId;
      const entityType = (raw as { entityType?: unknown }).entityType;
      if (typeof entityId !== 'string' || !Types.ObjectId.isValid(entityId)) continue;
      if (anchorKey === 'client' && entityType === 'counterparty') {
        if (!bag.counterparty) {
          const cp = await this.counterpartyModel.findById(entityId).lean().exec();
          if (cp) bag.counterparty = cp;
        }
      } else if ((anchorKey === 'payer' || anchorKey === 'supplier') && entityType === 'counterparty') {
        const cp = await this.counterpartyModel.findById(entityId).lean().exec();
        if (cp) bag.anchor = { ...(bag.anchor as Record<string, unknown> ?? {}), [anchorKey]: cp };
      } else if (anchorKey === 'issuer' && entityType === 'organization') {
        if (!bag.organization) {
          const org = await this.orgModel.findById(entityId).lean().exec();
          if (org) bag.organization = this.organizationRenderData(org);
        }
      }
      const source = anchorKey === 'client' ? bag.counterparty : anchorKey === 'issuer' ? bag.organization : undefined;
      if (source) {
        bag.anchor = { ...(bag.anchor as Record<string, unknown> ?? {}), [anchorKey]: source };
      }
    }
    if (bag.counterparty && !(bag.anchor as Record<string, unknown> | undefined)?.['client']) {
      bag.anchor = { ...(bag.anchor as Record<string, unknown> ?? {}), client: bag.counterparty };
    }
    return bag;
  }

  /**
   * TZ-KP-BIND-513 — merge draft КП fields + top-level aliases so body-text
   * `{{client_name}}`, `{{kp_number}}`, `{{quotation.number}}` resolve like terms.
   */
  private mergeDraftContextIntoBag(
    dto: BuildDocumentDto,
    bag: Record<string, unknown>,
  ): void {
    const quotation = bag.quotation as Record<string, unknown> | undefined;
    const counterparty = bag.counterparty as Record<string, unknown> | undefined;

    const proposalStub: Record<string, unknown> = {
      ...(quotation ?? {}),
      number: dto.proposalNumber ?? quotation?.['number'] ?? '',
      date: dto.proposalDate ?? quotation?.['date'] ?? '',
      validUntil: dto.validUntil ?? quotation?.['validUntil'] ?? '',
      total: dto.totalPrice ?? quotation?.['total'] ?? '',
      prepaymentPercent:
        dto.dealTotals?.prepaymentPercent ??
        quotation?.['prepaymentPercent'] ??
        '',
      productionDays:
        dto.dealTotals?.productionDays ?? quotation?.['productionDays'] ?? '',
      deliveryDays:
        dto.dealTotals?.deliveryDays ?? quotation?.['deliveryDays'] ?? '',
    };
    bag.proposal = proposalStub;
    if (!bag.quotation) {
      bag.quotation = { ...proposalStub };
    }

    bag.client_name = String(
      counterparty?.['name'] ?? counterparty?.['shortName'] ?? '',
    );
    bag.kp_number = String(dto.proposalNumber ?? quotation?.['number'] ?? '');
    bag.total_price = this.formatValue(
      dto.totalPrice ?? quotation?.['total'],
      'currency',
    );
    bag.date = this.formatValue(
      dto.proposalDate ?? quotation?.['date'],
      'date',
    );
    bag.valid_until = this.formatValue(
      dto.validUntil ?? quotation?.['validUntil'],
      'date',
    );
    bag.prepayment_percent = String(
      dto.dealTotals?.prepaymentPercent ??
        quotation?.['prepaymentPercent'] ??
        '',
    );
    bag.production_days = String(
      dto.dealTotals?.productionDays ?? quotation?.['productionDays'] ?? '',
    );
    bag.delivery_days = String(
      dto.dealTotals?.deliveryDays ?? quotation?.['deliveryDays'] ?? '',
    );
  }

  /**
   * Resolve the issuer side for order/quotation/invoice builds. The document
   * template belongs to the issuing organization, so callers do not need to
   * duplicate that ID when printing an order or its stub КП.
   */
  private async applyIssuerOrganization(
    template: DocumentTemplateDocument,
    bag: Record<string, unknown>,
  ): Promise<void> {
    if (bag.organization) {
      bag.organization = this.organizationRenderData(bag.organization);
      return;
    }
    const templateOrgId = this.refId(template.organizationId);
    if (templateOrgId && typeof this.orgModel.findById === 'function') {
      const org = await this.orgModel.findById(templateOrgId).lean().exec();
      if (org) {
        bag.organization = this.organizationRenderData(org);
        return;
      }
    }
    if (typeof this.orgModel.findOne === 'function') {
      const own = await this.orgModel
        .findOne({ isOurCompany: true, deletedAt: null })
        .lean()
        .exec();
      if (own) bag.organization = this.organizationRenderData(own);
    }
  }

  /**
   * Expose the typed organization vault as stable template fields. Templates
   * should not know the storage shape (`assets[]`); missing slots deliberately
   * become empty strings so image blocks render their existing empty state.
   */
  private organizationRenderData(value: unknown): Record<string, unknown> {
    const organization = (
      value && typeof value === 'object' ? value : {}
    ) as Record<string, unknown>;
    const assets: unknown[] = Array.isArray(organization['assets'])
      ? (organization['assets'] as unknown[])
      : [];
    const urlFor = (role: string): string => {
      const asset = assets.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        return (entry as Record<string, unknown>)['role'] === role;
      });
      if (!asset || typeof asset !== 'object') return '';
      const storageUrl = (asset as Record<string, unknown>)['storageUrl'];
      return typeof storageUrl === 'string' ? storageUrl : '';
    };
    return {
      ...organization,
      logoUrl: urlFor('logo'),
      sealUrl: urlFor('seal'),
      signatureUrl: urlFor('signature'),
    };
  }

  /**
   * For blocks with dataBinding, derive a new block with content replaced.
   * Returns the original block reference if no dataBinding present (pure
   * `{{key.subkey}}` substitution happens inside renderHtml).
   *
   * Build-time overrides use `cloneResolvedBlock()` so persisted fields,
   * especially `layout`, survive the transition from hydrated Mongoose
   * document to render input.
   */
  private async resolveBlockContent(
    block: TemplateBlockDocument,
    bag: Record<string, unknown>,
  ): Promise<TemplateBlockDocument> {
    const source = block.source;
    if (source?.kind === 'literal') {
      return this.cloneResolvedBlock(block, { content: source.value });
    }
    if (source?.kind === 'text-block') {
      if (source.mode === 'snapshot') return block;
      if (!Types.ObjectId.isValid(source.refId)) return block;
      const text = await this.textBlockModel
        .findById(source.refId)
        .lean()
        .exec();
      if (!text) return block;
      return this.cloneResolvedBlock(block, {
        content: text.content ?? '',
        columns: text.columns?.map((column) => ({
          ...column,
          fontSize: column.fontSize ?? 14,
        })),
      });
    }
    if (source?.kind === 'field') {
      const resolved = this.resolveBinding(
        { source: source.source, field: source.field, format: source.format },
        bag,
      );
      return resolved === undefined
        ? block
        : this.cloneResolvedBlock(block, { content: resolved });
    }

    const binding = block.dataBinding;
    if (!binding) return block;

    // Legacy Builder versions stored the source id in static.value together
    // with an explicit textBlockId marker. Only that marker opts a block into
    // legacy reference resolution; static values otherwise remain literals.
    const settings = block.settings as { textBlockId?: string } | undefined;
    const legacyTextId = settings?.textBlockId;
    const hasExplicitLegacyMarker =
      binding.source === 'static' &&
      typeof legacyTextId === 'string' &&
      Types.ObjectId.isValid(legacyTextId);
    if (hasExplicitLegacyMarker) {
      const legacyText = await this.textBlockModel
        .findById(legacyTextId)
        .lean()
        .exec();
      // A legacy source is live only when the document carries the explicit
      // marker. Never infer a reference from an ObjectId-shaped literal or a
      // matching snapshot; that would silently change user-authored content.
      if (legacyText) {
        return this.cloneResolvedBlock(block, {
          content: legacyText.content ?? '',
          columns: legacyText.columns?.map((column) => ({
            ...column,
            fontSize: column.fontSize ?? 14,
          })),
        });
      }
    }

    const resolved = this.resolveBinding(binding, bag);
    if (resolved === undefined) return block;
    return this.cloneResolvedBlock(block, { content: resolved });
  }

  /**
   * Resolve a single dataBinding to a string value. Returns undefined if
   * neither static nor a successful lookup is possible so the caller can
   * decide whether to mutate the block.
   */
  private resolveBinding(
    binding: DataBinding,
    bag: Record<string, unknown>,
  ): string | undefined {
    // Static literal — explicit user-controlled value
    if (binding.source === 'static') {
      return escapeHtmlValue(binding.value ?? '');
    }
    // Sources not implemented in MVP: cost-calculation. Render empty.
    if (binding.source === 'cost-calculation') {
      return '';
    }
    // Live data source lookup
    const entity = bag[binding.source] as Record<string, unknown> | undefined;
    if (!entity) return '';
    if (!binding.field) return '';
    const raw = entity[binding.field];
    return this.formatValue(raw, binding.format);
  }

  /**
   * Apply Intl formatting per dataBinding.format. ru-RU / RUB is the
   * project-wide default. `undefined`/`text` formats pass value through
   * after String() coercion.
   */
  private formatValue(v: unknown, format?: string): string {
    if (v === null || v === undefined) return '';
    if (format === 'currency') {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return String(v);
      try {
        return new Intl.NumberFormat('ru-RU', {
          style: 'currency',
          currency: 'RUB',
        }).format(n);
      } catch {
        return String(v);
      }
    }
    if (format === 'date') {
      const d = v instanceof Date ? v : new Date(String(v));
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString('ru-RU');
    }
    if (format === 'number') {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return String(v);
      try {
        return new Intl.NumberFormat('ru-RU').format(n);
      } catch {
        return String(v);
      }
    }
    return escapeHtmlValue(String(v));
  }

  // ── TZ-86 legacy preview (kept for backward compat /A.7 manual smoke) ─────

  async preview(id: string, dataId?: string): Promise<string> {
    const { template, blocks } = await this.findExpanded(id);
    const data = dataId ? await this.loadData(dataId) : {};
    return this.documentRender.renderHtml(template, blocks, data);
  }

  private async loadData(dataId: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(dataId)) return {};
    const q = await this.quotationModel.findById(dataId).exec();
    if (q) return { kind: 'quotation', ...JSON.parse(JSON.stringify(q)) };
    const c = await this.contractModel.findById(dataId).exec();
    if (c) return { kind: 'contract', ...JSON.parse(JSON.stringify(c)) };
    const o = await this.orderModel.findById(dataId).exec();
    if (o) return { kind: 'order', ...JSON.parse(JSON.stringify(o)) };
    return {};
  }

  // ── Phase A.6 — Upload background image (TZ-86 §2.6) ─────────────────────────────────

  /**
   * MVP-allowlist: 5 background images per template (Photoshop-style z-axis layers).
   * 6th upload → 409 Conflict. Use a separate DELETE endpoint to remove.
   * Adjust if user feedback changes the limit.
   */
  private static readonly MAX_BACKGROUND_IMAGES = 5;

  /**
   * MIME → extension mapping for generated filenames. NEVER trust
   * `file.originalname` — only safe to derive extension from server-validated
   * MIME (the controller's `fileFilter` enforces this whitelist).
   */
  private static readonly MIME_TO_EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };

  /**
   * Persist a background image for this template.
   *
   * Flow:
   *   1. `findById(id)` → validates ObjectId + soft-delete (throws 404 if missing).
   *   2. Enforce 5-image cap (409 if over).
   *   3. Derive safe filesystem path (no user input in filename — UUIDv4 + ext map).
   *   4. Write buffer to disk before DB push — if save() fails we have something
   *      concrete to unlink.
   *   5. Push public URL to `backgroundImage[]` via `doc.save()` so the audit
   *      plugin (`updatedBy` from AsyncLocalStorage) fires the same way as
   *      update()/setDefault().
   *   6. On save() failure → best-effort `fs.unlink()` of the orphan file +
   *      re-throw so the client gets a real error and the disk stays clean.
   *
   * Storage: memoryStorage() upload from controller → `file.buffer` is in RAM.
   * Filename: `${randomUUID()}.${ext}` — collision-free without coordination.
   * URL: `/uploads/document-templates/{id}/{filename}` per main.ts useStaticAssets.
   * Memory footprint: ≤ MAX_FILE_SIZE bytes transiently (5 MB).
   */
  async uploadBackground(
    id: string,
    file: Express.Multer.File,
  ): Promise<string> {
    if (!file) {
      throw new BadRequestException(
        'Файл не получен. Выберите PNG, JPEG или WebP (поле «file»).',
      );
    }

    const doc = await this.findById(id);

    if (
      (doc.backgroundImage?.length ?? 0) >=
      DocumentTemplateService.MAX_BACKGROUND_IMAGES
    ) {
      throw new ConflictException(
        `Превышен лимит фоновых изображений (макс. ${DocumentTemplateService.MAX_BACKGROUND_IMAGES}). Удалите одно из существующих, прежде чем добавлять новое.`,
      );
    }

    const ext = DocumentTemplateService.MIME_TO_EXT[file.mimetype];
    if (!ext) {
      // Defense-in-depth: controller's fileFilter already rejects non-whitelisted MIME.
      // Reaching here means someone bypassed the whitelist — fail loudly.
      throw new BadRequestException(
        `Недопустимый MIME-тип файла: ${file.mimetype}. Ожидается image/png | image/jpeg | image/webp.`,
      );
    }

    const filename = `${randomUUID()}.${ext}`;
    const dirPath = join(process.cwd(), 'uploads', 'document-templates', id);
    const filePath = join(dirPath, filename);
    const publicUrl = `/uploads/document-templates/${id}/${filename}`;

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, file.buffer);

    try {
      const isFirst = (doc.backgroundImage?.length ?? 0) === 0;
      doc.backgroundImage.push(publicUrl);
      if (isFirst) doc.defaultBackgroundIndex = 0;
      await doc.save();
      return publicUrl;
    } catch (err) {
      // Best-effort cleanup of orphan file before surfacing the error.
      await fs.unlink(filePath).catch((unlinkErr) => {
        // Don't shadow the original error — log unlink warning separately.
        // eslint-disable-next-line no-console
        console.warn(
          `[uploadBackground] Failed to unlink orphan file ${filePath}: ${String(unlinkErr)}`,
        );
      });
      throw err;
    }
  }

  async removeBackground(id: string, index: number): Promise<void> {
    const doc = await this.findById(id);
    if (index < 0 || index >= doc.backgroundImage.length) {
      throw new BadRequestException(
        `Индекс ${index} вне диапазона (0..${doc.backgroundImage.length - 1})`,
      );
    }
    const removedUrl = doc.backgroundImage[index];
    doc.backgroundImage.splice(index, 1);
    if (doc.defaultBackgroundIndex === index) {
      doc.defaultBackgroundIndex = doc.backgroundImage.length > 0 ? 0 : -1;
    } else if (doc.defaultBackgroundIndex > index) {
      doc.defaultBackgroundIndex--;
    }
    await doc.save();
    const filePath = join(process.cwd(), removedUrl);
    await fs.unlink(filePath).catch(() => {});
  }

  async setDefaultBackground(id: string, index: number): Promise<void> {
    const doc = await this.findById(id);
    if (index < -1 || index >= doc.backgroundImage.length) {
      throw new BadRequestException(`Индекс ${index} вне диапазона`);
    }
    doc.defaultBackgroundIndex = index;
    await doc.save();
  }

  async setOrientation(
    id: string,
    orientation: 'portrait' | 'landscape',
  ): Promise<void> {
    const doc = await this.findById(id);
    doc.orientation = orientation;
    await doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.deleteOne({ _id: doc._id }).exec();
    await this.blockModel.deleteMany({ templateId: doc._id }).exec();
  }

  /**
   * Extract a stable ObjectId string from a possibly-populated reference
   * field. `findById`/`findAll` populate `organizationId`/`docTypeId`/
   * `categoryId`, so the raw field may be a full document; this helper
   * returns the underlying `_id` in both cases.
   */
  private refId(value: unknown): string | undefined {
    if (!value) return undefined;
    const id = (value as { _id?: unknown })._id ?? value;
    if (!id) return undefined;
    const s = String(id);
    return Types.ObjectId.isValid(s) ? s : undefined;
  }
}
