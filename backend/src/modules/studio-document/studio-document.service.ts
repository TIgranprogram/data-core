import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from '../organization/organization.schema';
import { OrganizationService } from '../organization/organization.service';
import {
  StudioDocument,
  StudioDocumentDocument,
  StudioDocumentStatus,
} from './studio-document.schema';
import { CreateStudioDocumentDto } from './dto/create-studio-document.dto';
import { UpdateStudioDocumentDto } from './dto/update-studio-document.dto';
import { PutStudioDataSetDto } from './dto/put-studio-data-set.dto';
import { DocumentTemplateService } from '../document-template/document-template.service';
import { DocumentTemplateDocument } from '../document-template/document-template.schema';
import { TemplateBlockService } from '../template-block/template-block.service';
import { SaveAsTemplateDto } from './dto/save-as-template.dto';
import { CreateTemplateBlockDto } from '../template-block/dto/create-template-block.dto';
import { UpdateTemplateBlockLayoutsDto } from '../template-block/dto/update-layouts.dto';
import { TemplateBlockDocument } from '../template-block/template-block.schema';
import { StudioDataResolverService } from './studio-data-resolver';

const LIVE_HYDRATABLE_SOURCE_TYPES = new Set([
  'quotation-items',
  'order-items',
  'catalog-products',
  'catalog-modules',
  'catalog-parts',
  'catalog-materials',
]);

export const STUDIO_DOCUMENT_REVISION_CONFLICT = 'STUDIO_DOCUMENT_REVISION_CONFLICT';

/**
 * TZ-DOC-STUDIO-201b — StudioDocument persistence with org scope and revision gate.
 */
@Injectable()
export class StudioDocumentService {
  private readonly logger = new Logger(StudioDocumentService.name);

  constructor(
    @InjectModel(StudioDocument.name)
    private readonly model: Model<StudioDocumentDocument>,
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    private readonly templateService: DocumentTemplateService,
    private readonly blockService: TemplateBlockService,
    private readonly dataResolver: StudioDataResolverService,
    private readonly organizationService: OrganizationService,
  ) {}

  /**
   * Org-scoped documents. System admin JWT may have organizationId=null —
   * fall back to the first Organization (same as FormProfile local dev).
   */
  private async resolveOrganizationId(
    organizationId: string | null | undefined,
  ): Promise<string> {
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      return organizationId;
    }
    const fallback = await this.orgModel
      .findOne()
      .sort({ name: 1 })
      .select('_id')
      .lean()
      .exec();
    if (fallback?._id) {
      this.logger.debug(
        `StudioDocument: using default organization ${String(fallback._id)} (user had no org)`,
      );
      return String(fallback._id);
    }
    throw new BadRequestException(
      'Нет организации: создайте фирму в Админ → Наши организации.',
    );
  }

  private toObjectId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }

  private assertSameScope(
    doc: StudioDocumentDocument,
    organizationId: string,
  ): void {
    if (String(doc.organizationId) !== organizationId) {
      throw new ForbiddenException(
        'Studio document belongs to another organization scope',
      );
    }
  }

  private refId(value: unknown): string {
    if (value && typeof value === 'object' && '_id' in value) {
      return String((value as { _id: unknown })._id);
    }
    return String(value);
  }

  private throwRevisionConflict(doc: StudioDocumentDocument): never {
    const updatedAt =
      (doc as StudioDocumentDocument & { updatedAt?: Date }).updatedAt ??
      new Date();
    throw new ConflictException({
      code: STUDIO_DOCUMENT_REVISION_CONFLICT,
      message: 'Studio document revision conflict',
      revision: doc.revision,
      updatedAt,
    });
  }

  private assertRevision(
    doc: StudioDocumentDocument,
    expectedRevision: number,
  ): void {
    if (doc.revision !== expectedRevision) {
      this.throwRevisionConflict(doc);
    }
  }

  private async bumpRevision(
    doc: StudioDocumentDocument,
    userId?: string,
  ): Promise<StudioDocumentDocument> {
    doc.revision += 1;
    if (userId) {
      doc.updatedBy = this.toObjectId(userId, 'updatedBy');
    }
    return doc.save();
  }

  private assertDocTypeForFinal(
    nextStatus: StudioDocumentStatus | undefined,
    docTypeId: Types.ObjectId | undefined,
    patchDocTypeId?: string,
  ): void {
    if (nextStatus !== 'final') return;
    const effectiveDocTypeId = patchDocTypeId ?? docTypeId;
    if (!effectiveDocTypeId) {
      throw new BadRequestException(
        'docTypeId is required when transitioning status to final',
      );
    }
  }

  async create(
    dto: CreateStudioDocumentDto,
    organizationId: string | null | undefined,
    userId?: string,
  ): Promise<StudioDocumentDocument> {
    const orgId = await this.resolveOrganizationId(organizationId);
    return this.model.create({
      name: dto.name,
      organizationId: new Types.ObjectId(orgId),
      docTypeId: dto.docTypeId
        ? this.toObjectId(dto.docTypeId, 'docTypeId')
        : undefined,
      sourceTemplateId: dto.sourceTemplateId
        ? this.toObjectId(dto.sourceTemplateId, 'sourceTemplateId')
        : undefined,
      pageSize: dto.pageSize ?? 'A4',
      orientation: dto.orientation ?? 'portrait',
      backgroundImage: dto.backgroundImage ?? [],
      defaultBackgroundIndex: dto.defaultBackgroundIndex ?? -1,
      backgroundOpacity: dto.backgroundOpacity ?? 0.3,
      pageMargins: dto.pageMargins ?? { top: 0, right: 0, bottom: 0, left: 0 },
      sheetLayout: dto.sheetLayout ?? { rowsFirstPage: 0, rowsNextPage: 0 },
      pageNumbering: dto.pageNumbering ?? false,
      manualPageCount: dto.manualPageCount ?? 1,
      context: dto.context ?? {},
      dataAnchors: dto.dataAnchors ?? [],
      dataSets: dto.dataSets ?? [],
      status: 'draft',
      revision: 1,
      schemaVersion: 1,
      createdBy: userId ? this.toObjectId(userId, 'createdBy') : undefined,
      updatedBy: userId ? this.toObjectId(userId, 'updatedBy') : undefined,
    });
  }

  /**
   * TZ-NX-DOCSTUDIO-UNSCOPED-ORG-SCOPE — an unscoped/admin caller
   * (organizationId null|undefined) sees every document; only a caller
   * bound to a real org is filtered to it.
   */
  async findAll(organizationId: string | null | undefined): Promise<StudioDocumentDocument[]> {
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      return this.model
        .find({ organizationId: new Types.ObjectId(organizationId) })
        .sort({ updatedAt: -1 })
        .exec();
    }
    return this.model.find().sort({ updatedAt: -1 }).exec();
  }

  /**
   * TZ-NX-DOCSTUDIO-UNSCOPED-ORG-SCOPE — the scope check only applies to a
   * caller bound to a real org (IDOR protection kept). An unscoped/admin
   * caller (organizationId null|undefined) loads by id only: previously this
   * resolved the caller's own tenant scope via resolveOrganizationId's
   * alphabetical-first-org fallback and asserted the DOCUMENT against it, so
   * an admin editing the issuer (TZ-NX-DOCSTUDIO-ISSUER-SELECT) away from
   * that fallback org 403'd themselves out of the document on the very next
   * request (self-lockout — GET/PATCH/addBlock all throw).
   */
  async findById(
    id: string,
    organizationId: string | null | undefined,
  ): Promise<StudioDocumentDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`StudioDocument ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) {
      throw new NotFoundException(`StudioDocument ${id} not found`);
    }
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      this.assertSameScope(doc, organizationId);
    }
    return doc;
  }

  async update(
    id: string,
    dto: UpdateStudioDocumentDto,
    organizationId: string | null | undefined,
    userId?: string,
  ): Promise<StudioDocumentDocument> {
    const doc = await this.findById(id, organizationId);

    this.assertRevision(doc, dto.expectedRevision);

    this.assertDocTypeForFinal(
      dto.status,
      doc.docTypeId,
      dto.docTypeId,
    );

    if (dto.organizationId !== undefined) {
      // TZ-NX-DOCSTUDIO-ISSUER-SELECT: same visibility policy as
      // OrganizationService.findAll/findById — an unscoped/admin caller
      // (organizationId is null/undefined) may pick any existing org; a
      // caller bound to their own org can only "pick" that same org
      // (findById 404s otherwise, closing the same IDOR class as everywhere
      // else in this service). The RAW (unresolved) organizationId is used
      // here on purpose — resolveOrganizationId's fallback would otherwise
      // make an unscoped admin look bound to that fallback org.
      await this.organizationService.findById(dto.organizationId, { organizationId });
      doc.organizationId = this.toObjectId(dto.organizationId, 'organizationId');
    }
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.docTypeId !== undefined) {
      doc.docTypeId = this.toObjectId(dto.docTypeId, 'docTypeId');
    }
    if (dto.sourceTemplateId !== undefined) {
      doc.sourceTemplateId = this.toObjectId(
        dto.sourceTemplateId,
        'sourceTemplateId',
      );
    }
    if (dto.pageSize !== undefined) doc.pageSize = dto.pageSize;
    if (dto.orientation !== undefined) doc.orientation = dto.orientation;
    if (dto.backgroundImage !== undefined) doc.backgroundImage = dto.backgroundImage;
    if (dto.defaultBackgroundIndex !== undefined) {
      doc.defaultBackgroundIndex = dto.defaultBackgroundIndex;
    }
    if (dto.backgroundOpacity !== undefined) doc.backgroundOpacity = dto.backgroundOpacity;
    if (dto.pageMargins !== undefined) doc.pageMargins = dto.pageMargins;
    if (dto.sheetLayout !== undefined) doc.sheetLayout = dto.sheetLayout;
    if (dto.pageNumbering !== undefined) doc.pageNumbering = dto.pageNumbering;
    if (dto.manualPageCount !== undefined) doc.manualPageCount = dto.manualPageCount;
    if (dto.context !== undefined) doc.context = dto.context;
    if (dto.dataAnchors !== undefined) doc.dataAnchors = dto.dataAnchors;
    if (dto.dataSets !== undefined) doc.dataSets = dto.dataSets;
    if (dto.status !== undefined) doc.status = dto.status;

    return this.bumpRevision(doc, userId);
  }

  /**
   * TZ-DOC-STUDIO-701 — upsert one dataSet entry by key with revision gate.
   */
  async putDataSet(
    id: string,
    key: string,
    dto: PutStudioDataSetDto,
    organizationId: string | null | undefined,
    userId?: string,
  ): Promise<StudioDocumentDocument> {
    const doc = await this.findById(id, organizationId);

    this.assertRevision(doc, dto.expectedRevision);

    const trimmedKey = key.trim();
    if (!trimmedKey) {
      throw new BadRequestException('dataSet key must be non-empty');
    }

    const nextEntry = { ...dto.dataSet, key: trimmedKey };
    const dataSets = [...(doc.dataSets ?? [])];
    const idx = dataSets.findIndex(
      (entry) => String((entry as { key?: unknown }).key ?? '') === trimmedKey,
    );
    if (idx >= 0) {
      dataSets[idx] = nextEntry;
    } else {
      dataSets.push(nextEntry);
    }
    doc.dataSets = dataSets;
    const saved = await this.bumpRevision(doc, userId);
    return this.hydrateLiveDataSetRows(saved, trimmedKey);
  }

  /**
   * TZ-NX-DOCSTUDIO-S28 — after putDataSet upsert, live-read rows for the
   * updated entry (canvas liveRows) if its source is quotation/order/catalog.
   * Does not persist the hydrated rows (draft stays as FE sent it); the
   * finalize/PDF snapshot bake path (bakeSnapshot) is untouched.
   */
  private async hydrateLiveDataSetRows(
    doc: StudioDocumentDocument,
    key: string,
  ): Promise<StudioDocumentDocument> {
    const entries = doc.dataSets ?? [];
    const idx = entries.findIndex(
      (entry) => String((entry as { key?: unknown }).key ?? '') === key,
    );
    if (idx < 0) return doc;
    const sourceType = (entries[idx] as { source?: { type?: unknown } }).source
      ?.type;
    if (
      typeof sourceType !== 'string' ||
      !LIVE_HYDRATABLE_SOURCE_TYPES.has(sourceType)
    ) {
      return doc;
    }

    const blocks = await this.blockService.findAllByStudioDocument(
      String(doc._id),
    );
    const resolved = await this.dataResolver.resolveDataSets(
      doc,
      blocks,
      true,
    );
    const resolvedEntry = resolved.find(
      (entry) => String((entry as { key?: unknown }).key ?? '') === key,
    );
    if (resolvedEntry) {
      const nextDataSets = [...entries];
      nextDataSets[idx] = resolvedEntry;
      doc.dataSets = nextDataSets;
    }
    return doc;
  }

  /**
   * TZ-DOC-STUDIO-2002 — create block with revision gate (not LWW).
   */
  async addBlock(
    id: string,
    expectedRevision: number,
    dto: Omit<CreateTemplateBlockDto, 'templateId' | 'parentType' | 'parentId'>,
    organizationId: string | null | undefined,
    userId?: string,
  ): Promise<TemplateBlockDocument> {
    const doc = await this.findById(id, organizationId);
    this.assertRevision(doc, expectedRevision);

    const sourceTemplateId = doc.sourceTemplateId
      ? String(doc.sourceTemplateId)
      : undefined;
    const block = await this.blockService.createForStudioDocument(
      id,
      dto,
      sourceTemplateId,
    );
    await this.bumpRevision(doc, userId);
    return block;
  }

  /**
   * TZ-DOC-STUDIO-2002 — batch layout update with revision gate.
   */
  async updateBlockLayouts(
    id: string,
    expectedRevision: number,
    dto: UpdateTemplateBlockLayoutsDto,
    organizationId: string | null | undefined,
    userId?: string,
  ): Promise<TemplateBlockDocument[]> {
    const doc = await this.findById(id, organizationId);
    this.assertRevision(doc, expectedRevision);

    const blocks = await this.blockService.updateLayoutsForStudioDocument(id, dto);
    await this.bumpRevision(doc, userId);
    return blocks;
  }

  /**
   * TZ-DOC-STUDIO-2002 — reorder blocks with revision gate.
   */
  async reorderBlocks(
    id: string,
    expectedRevision: number,
    blockIds: string[],
    organizationId: string | null | undefined,
    userId?: string,
  ): Promise<TemplateBlockDocument[]> {
    const doc = await this.findById(id, organizationId);
    this.assertRevision(doc, expectedRevision);

    const blocks = await this.blockService.reorderForStudioDocument(id, blockIds);
    await this.bumpRevision(doc, userId);
    return blocks;
  }

  async remove(
    id: string,
    organizationId: string | null | undefined,
  ): Promise<void> {
    const doc = await this.findById(id, organizationId);
    const deletedBlocks = await this.blockService.deleteAllByStudioDocument(id);
    if (deletedBlocks > 0) {
      this.logger.log(
        `StudioDocument ${id}: cascade-deleted ${deletedBlocks} block(s) + unlinked images`,
      );
    }
    await this.model.deleteOne({ _id: doc._id }).exec();
  }

  /**
   * TZ-DOC-STUDIO-1301 — create studio document from DocumentTemplate + cloned blocks.
   */
  async createFromTemplate(
    templateId: string,
    organizationId: string | null | undefined,
    userId?: string,
    name?: string,
  ): Promise<StudioDocumentDocument> {
    const orgId = await this.resolveOrganizationId(organizationId);
    const template = await this.templateService.findById(templateId);

    if (this.refId(template.organizationId) !== orgId) {
      throw new ForbiddenException(
        'Document template belongs to another organization scope',
      );
    }

    const doc = await this.model.create({
      name: name?.trim() || template.name,
      organizationId: new Types.ObjectId(orgId),
      docTypeId: template.docTypeId,
      sourceTemplateId: template._id,
      pageSize: template.pageSize,
      orientation: template.orientation,
      backgroundImage: template.backgroundImage ?? [],
      defaultBackgroundIndex: template.defaultBackgroundIndex ?? -1,
      backgroundOpacity: template.backgroundOpacity ?? 0.3,
      pageMargins: (template as { pageMargins?: { top: number; right: number; bottom: number; left: number } }).pageMargins ?? { top: 0, right: 0, bottom: 0, left: 0 },
      sheetLayout: template.defaultSheetLayout ?? { rowsFirstPage: 0, rowsNextPage: 0 },
      pageNumbering: template.pageNumbering ?? false,
      manualPageCount: 1,
      context: {},
      dataAnchors: [],
      dataSets: [],
      status: 'draft',
      revision: 1,
      schemaVersion: 1,
      createdBy: userId ? this.toObjectId(userId, 'createdBy') : undefined,
      updatedBy: userId ? this.toObjectId(userId, 'updatedBy') : undefined,
    });

    await this.blockService.cloneBlocksFromTemplate(
      templateId,
      String(doc._id),
      templateId,
    );

    return doc;
  }

  /**
   * TZ-DOC-STUDIO-1301 — duplicate studio document as a new draft + cloned blocks.
   */
  async duplicate(
    id: string,
    organizationId: string | null | undefined,
    userId?: string,
  ): Promise<StudioDocumentDocument> {
    const src = await this.findById(id, organizationId);

    const copy = await this.model.create({
      name: `${src.name} (копия)`,
      organizationId: src.organizationId,
      docTypeId: src.docTypeId,
      sourceTemplateId: src.sourceTemplateId,
      pageSize: src.pageSize,
      orientation: src.orientation,
      backgroundImage: src.backgroundImage ?? [],
      defaultBackgroundIndex: src.defaultBackgroundIndex ?? -1,
      backgroundOpacity: src.backgroundOpacity ?? 0.3,
      pageMargins: src.pageMargins ?? { top: 0, right: 0, bottom: 0, left: 0 },
      sheetLayout: src.sheetLayout ?? { rowsFirstPage: 0, rowsNextPage: 0 },
      pageNumbering: src.pageNumbering ?? false,
      manualPageCount: src.manualPageCount ?? 1,
      context: src.context ?? {},
      dataAnchors: src.dataAnchors ?? [],
      dataSets: src.dataSets ?? [],
      status: 'draft',
      revision: 1,
      schemaVersion: src.schemaVersion ?? 1,
      createdBy: userId ? this.toObjectId(userId, 'createdBy') : undefined,
      updatedBy: userId ? this.toObjectId(userId, 'updatedBy') : undefined,
    });

    await this.blockService.cloneBlocksFromStudioDocument(
      id,
      String(copy._id),
      src.sourceTemplateId ? String(src.sourceTemplateId) : undefined,
    );

    return copy;
  }

  /**
   * TZ-DOC-STUDIO-1501 — save studio document as org-scoped DocumentTemplate + blocks.
   */
  async saveAsTemplate(
    id: string,
    organizationId: string | null | undefined,
    userId: string | undefined,
    dto: SaveAsTemplateDto,
  ): Promise<DocumentTemplateDocument> {
    const orgId = await this.resolveOrganizationId(organizationId);
    const doc = await this.findById(id, organizationId);

    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Template name must be non-empty');
    }

    if (!doc.docTypeId) {
      throw new BadRequestException(
        'docTypeId is required to save as template — assign a document type on the studio document first',
      );
    }

    const template = await this.templateService.create(
      {
        name,
        organizationId: orgId,
        docTypeId: String(doc.docTypeId),
        pageSize: doc.pageSize as 'A3' | 'A4' | 'A5',
        orientation: doc.orientation as 'portrait' | 'landscape',
        backgroundImage: doc.backgroundImage ?? [],
        defaultBackgroundIndex: doc.defaultBackgroundIndex ?? -1,
        backgroundOpacity: doc.backgroundOpacity ?? 0.3,
        pageNumbering: doc.pageNumbering ?? false,
      },
      userId,
    );

    await this.blockService.cloneBlocksToTemplate(
      id,
      String(template._id),
      dto.keepDataBindings ?? false,
    );

    return template;
  }
}
