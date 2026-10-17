import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { TemplateBlock, TemplateBlockDocument } from './template-block.schema';
import { StudioDocument } from '../studio-document/studio-document.schema';
import { CreateTemplateBlockDto } from './dto/create-template-block.dto';
import { UpdateTemplateBlockDto } from './dto/update-template-block.dto';
import { UpdateTemplateBlockLayoutsDto } from './dto/update-layouts.dto';
import { SessionRunner } from '../../common/db/session-runner';

import { normalizeBlockLayout, type BlockSource } from './template-block-layout';
import type { BlockSourceDto } from './dto/create-template-block.dto';
import { sanitizeBlockHtml } from './block-content-sanitizer';

const PARENT_REF_BACKFILL_FLAG = 'template_blocks_parent_ref_v1';

@Injectable()
export class TemplateBlockService implements OnModuleInit {
  private readonly logger = new Logger(TemplateBlockService.name);

  constructor(
    @InjectModel(TemplateBlock.name)
    private readonly model: Model<TemplateBlockDocument>,
    @InjectModel(StudioDocument.name)
    private readonly studioDocumentModel: Model<{ manualPageCount?: number }>,
    private readonly sessionRunner: SessionRunner,
  ) {}

  /** TZ-DOC-STUDIO-201a — idempotent backfill: parentType/parentId from legacy templateId. */
  async onModuleInit(): Promise<void> {
    await this.backfillParentRefs();
  }

  private async backfillParentRefs(): Promise<void> {
    const flags = this.model.db.collection('migration_flags');
    const existing = await flags.findOne({ key: PARENT_REF_BACKFILL_FLAG });
    if (existing) return;

    const missing = await this.model.countDocuments({ parentType: { $exists: false } }).exec();
    if (missing === 0) {
      await flags.insertOne({ key: PARENT_REF_BACKFILL_FLAG, completedAt: new Date() });
      return;
    }

    const res = await this.model
      .updateMany(
        { parentType: { $exists: false }, templateId: { $exists: true, $ne: null } },
        [{ $set: { parentType: 'template', parentId: '$templateId' } }],
      )
      .exec();

    await flags.insertOne({
      key: PARENT_REF_BACKFILL_FLAG,
      completedAt: new Date(),
      modifiedCount: res.modifiedCount,
    });

    if (res.modifiedCount > 0) {
      this.logger.log(
        `TZ-DOC-STUDIO-201a backfill parentType/parentId for ${res.modifiedCount} template block(s)`,
      );
    }
  }

  /** Dual-read filter: legacy templateId OR canonical parent ref (excludes studio clones). */
  private templateParentFilter(templateId: string): Record<string, unknown> {
    const templateObjectId = new Types.ObjectId(templateId);
    return {
      $or: [
        { templateId: templateObjectId, parentType: { $ne: 'studio-document' } },
        { parentType: 'template', parentId: templateObjectId },
      ],
    };
  }

  /** Studio-document scoped filter (canonical parent ref only). */
  private studioParentFilter(studioDocId: string): Record<string, unknown> {
    if (!Types.ObjectId.isValid(studioDocId)) {
      return { parentType: 'studio-document', parentId: null };
    }
    return {
      parentType: 'studio-document',
      parentId: new Types.ObjectId(studioDocId),
    };
  }

  async create(dto: CreateTemplateBlockDto): Promise<TemplateBlockDocument> {
    const templateObjectId = new Types.ObjectId(dto.templateId);
    const parentType = dto.parentType ?? 'template';
    const parentId = dto.parentId
      ? new Types.ObjectId(dto.parentId)
      : parentType === 'template'
        ? templateObjectId
        : undefined;

    if (parentType === 'studio-document' && !parentId) {
      throw new BadRequestException('studio-document blocks require parentId');
    }

    const maxPage =
      parentType === 'studio-document' && parentId
        ? await this.resolveStudioMaxPage(String(parentId))
        : 1;
    const layoutOpts = { maxPage };

    return this.model.create({
      templateId: templateObjectId,
      parentType,
      parentId,
      type: dto.type,
      order: dto.order,
      title: dto.title,
      content: sanitizeBlockHtml(dto.content ?? ''),
      columns: dto.columns?.map((c) => ({
        id: c.id,
        content: sanitizeBlockHtml(c.content || ''),
        width: c.width ?? 1,
        ...(c.fontSize !== undefined ? { fontSize: c.fontSize } : {}),
      })),
      height: dto.height,
      showLine: dto.showLine ?? false,
      settings: this.sanitizeSettings(dto.settings),
      dataBinding: dto.dataBinding,
      style: dto.style,
      layout: dto.layout
        ? (this.assertSupportedPage(dto.layout.page, maxPage),
          normalizeBlockLayout(dto.layout, layoutOpts))
        : undefined,
      source: this.normalizeSource(dto.source),
      groupId: dto.groupId ?? null,
      locked: dto.locked ?? false,
      isActive: dto.isActive ?? true,
    });
  }

  private normalizeSource(source: BlockSourceDto | undefined): BlockSource | undefined {
    if (!source) return undefined;

    switch (source.kind) {
      case 'literal':
        if (source.value === undefined) {
          throw new BadRequestException('Literal block source requires value');
        }
        return { kind: 'literal', value: source.value };
      case 'text-block':
        if (!source.refId) {
          throw new BadRequestException('Text-block source requires refId');
        }
        return { kind: 'text-block', refId: source.refId, mode: source.mode ?? 'live' };
      case 'table-template':
        if (!source.refId) {
          throw new BadRequestException('Table-template source requires refId');
        }
        return { kind: 'table-template', refId: source.refId, mode: source.mode ?? 'live' };
      case 'field':
        if (!source.source || !source.field) {
          throw new BadRequestException('Field source requires source and field');
        }
        return {
          kind: 'field',
          source: source.source,
          field: source.field,
          ...(source.format ? { format: source.format } : {}),
        };
    }
  }

  async findAll(templateId?: string): Promise<TemplateBlockDocument[]> {
    const filter: Record<string, unknown> = { isActive: true };
    if (templateId) {
      if (!Types.ObjectId.isValid(templateId)) return [];
      Object.assign(filter, this.templateParentFilter(templateId));
    }
    return this.model.find(filter).sort({ order: 1 }).exec();
  }

  /** TZ-DOC-STUDIO-401 — list blocks for a studio document instance. */
  async findAllByStudioDocument(studioDocId: string): Promise<TemplateBlockDocument[]> {
    if (!Types.ObjectId.isValid(studioDocId)) return [];
    return this.model
      .find({ isActive: true, ...this.studioParentFilter(studioDocId) })
      .sort({ order: 1 })
      .exec();
  }

  /**
   * TZ-DOC-STUDIO-401 — create a block on a studio document.
   * Legacy `templateId` = sourceTemplateId when present, else studioDocId (ADR §7).
   */
  async createForStudioDocument(
    studioDocId: string,
    dto: Omit<CreateTemplateBlockDto, 'templateId' | 'parentType' | 'parentId'>,
    sourceTemplateId?: string,
  ): Promise<TemplateBlockDocument> {
    if (!Types.ObjectId.isValid(studioDocId)) {
      throw new BadRequestException('studioDocId must be a valid ObjectId');
    }
    const legacyTemplateId =
      sourceTemplateId && Types.ObjectId.isValid(sourceTemplateId)
        ? sourceTemplateId
        : studioDocId;
    return this.create({
      ...dto,
      templateId: legacyTemplateId,
      parentType: 'studio-document',
      parentId: studioDocId,
    });
  }

  async findById(id: string): Promise<TemplateBlockDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`TemplateBlock ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`TemplateBlock ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateTemplateBlockDto): Promise<TemplateBlockDocument> {
    const doc = await this.findById(id);
    if (dto.type !== undefined) doc.type = dto.type;
    if (dto.order !== undefined) doc.order = dto.order;
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.content !== undefined) doc.content = sanitizeBlockHtml(dto.content);
    if (dto.columns !== undefined) {
      const previousById = new Map((doc.columns ?? []).map((c) => [c.id, c]));
      doc.columns = dto.columns.map((c) => ({
        id: c.id,
        content: sanitizeBlockHtml(c.content || ''),
        width: c.width ?? 1,
        fontSize: c.fontSize ?? previousById.get(c.id)?.fontSize ?? 14,
      }));
    }
    if (dto.height !== undefined) doc.height = dto.height;
    if (dto.showLine !== undefined) doc.showLine = dto.showLine;
    if (dto.settings !== undefined) doc.settings = this.sanitizeSettings(dto.settings);
    if (dto.dataBinding !== undefined) doc.dataBinding = dto.dataBinding;
    if (dto.style !== undefined) doc.style = { ...(doc.style ?? {}), ...dto.style };
    if (dto.layout !== undefined) {
      const maxPage = await this.resolveMaxPageForBlock(doc);
      this.assertSupportedPage(dto.layout.page, maxPage);
      doc.layout = normalizeBlockLayout({ ...doc.layout, ...dto.layout }, { maxPage });
    }
    if (dto.source !== undefined) doc.source = this.normalizeSource(dto.source);
    if (dto.groupId !== undefined) doc.groupId = dto.groupId;
    if (dto.locked !== undefined) doc.locked = dto.locked;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.parentType !== undefined) doc.parentType = dto.parentType;
    if (dto.parentId !== undefined) doc.parentId = new Types.ObjectId(dto.parentId);
    return doc.save();
  }

  async updateLayouts(
    templateId: string,
    dto: UpdateTemplateBlockLayoutsDto,
  ): Promise<TemplateBlockDocument[]> {
    if (!Types.ObjectId.isValid(templateId)) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    dto.updates.forEach((update) => this.assertSupportedPage(update.layout.page));
    const ids = dto.updates.map((update) => update.blockId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Layout updates must contain unique block IDs');
    }
    if (ids.some((id) => !Types.ObjectId.isValid(id))) {
      throw new BadRequestException('Layout update contains an invalid block ID');
    }

    const blockObjectIds = ids.map((id) => new Types.ObjectId(id));
    const blocks = await this.model.find({
      _id: { $in: blockObjectIds },
      ...this.templateParentFilter(templateId),
      isActive: true,
    }).exec();
    if (blocks.length !== ids.length) {
      throw new BadRequestException('Every layout block must belong to the active template');
    }

    await this.sessionRunner.run(async (session) => {
      await this.model.bulkWrite(
        dto.updates.map((update) => ({
          updateOne: {
            filter: {
              _id: new Types.ObjectId(update.blockId),
              ...this.templateParentFilter(templateId),
            },
            update: { $set: { layout: normalizeBlockLayout(update.layout) } },
          },
        })),
        { ordered: true, session },
      );
    });
    return this.findAll(templateId);
  }

  /** TZ-DOC-STUDIO-401 — batch layout update for studio-document blocks. */
  async updateLayoutsForStudioDocument(
    studioDocId: string,
    dto: UpdateTemplateBlockLayoutsDto,
  ): Promise<TemplateBlockDocument[]> {
    if (!Types.ObjectId.isValid(studioDocId)) {
      throw new NotFoundException(`StudioDocument ${studioDocId} not found`);
    }

    const maxPage = await this.resolveStudioMaxPage(studioDocId);
    dto.updates.forEach((update) => this.assertSupportedPage(update.layout.page, maxPage));
    const ids = dto.updates.map((update) => update.blockId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Layout updates must contain unique block IDs');
    }
    if (ids.some((id) => !Types.ObjectId.isValid(id))) {
      throw new BadRequestException('Layout update contains an invalid block ID');
    }

    const blockObjectIds = ids.map((id) => new Types.ObjectId(id));
    const blocks = await this.model.find({
      _id: { $in: blockObjectIds },
      ...this.studioParentFilter(studioDocId),
      isActive: true,
    }).exec();
    if (blocks.length !== ids.length) {
      throw new BadRequestException('Every layout block must belong to the studio document');
    }

    await this.sessionRunner.run(async (session) => {
      await this.model.bulkWrite(
        dto.updates.map((update) => ({
          updateOne: {
            filter: {
              _id: new Types.ObjectId(update.blockId),
              ...this.studioParentFilter(studioDocId),
            },
            update: { $set: { layout: normalizeBlockLayout(update.layout, { maxPage }) } },
          },
        })),
        { ordered: true, session },
      );
    });
    return this.findAllByStudioDocument(studioDocId);
  }

  async reorder(templateId: string, blockIds: string[]): Promise<TemplateBlockDocument[]> {
    if (!Types.ObjectId.isValid(templateId)) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }
    if (blockIds.length === 0 || new Set(blockIds).size !== blockIds.length) {
      throw new BadRequestException('Reorder requires a unique, non-empty block ID list');
    }
    if (blockIds.some((id) => !Types.ObjectId.isValid(id))) {
      throw new BadRequestException('Reorder contains an invalid block ID');
    }

    const existing = await this.model.find({
      ...this.templateParentFilter(templateId),
      isActive: true,
    }).select({ _id: 1 }).lean().exec();
    const existingIds = new Set(existing.map((block) => String(block._id)));
    if (existingIds.size !== blockIds.length || blockIds.some((id) => !existingIds.has(id))) {
      throw new BadRequestException('Reorder must contain every active block in the template exactly once');
    }

    await this.sessionRunner.run(async (session) => {
      await this.model.bulkWrite(
        blockIds.map((id, order) => ({
          updateOne: {
            filter: {
              _id: new Types.ObjectId(id),
              ...this.templateParentFilter(templateId),
              isActive: true,
            },
            update: { $set: { order } },
          },
        })),
        { ordered: true, session },
      );
    });
    return this.findAll(templateId);
  }

  /** TZ-DOC-STUDIO-401 — reorder blocks within a studio document. */
  async reorderForStudioDocument(
    studioDocId: string,
    blockIds: string[],
  ): Promise<TemplateBlockDocument[]> {
    if (!Types.ObjectId.isValid(studioDocId)) {
      throw new NotFoundException(`StudioDocument ${studioDocId} not found`);
    }
    if (blockIds.length === 0 || new Set(blockIds).size !== blockIds.length) {
      throw new BadRequestException('Reorder requires a unique, non-empty block ID list');
    }
    if (blockIds.some((id) => !Types.ObjectId.isValid(id))) {
      throw new BadRequestException('Reorder contains an invalid block ID');
    }

    const existing = await this.model.find({
      ...this.studioParentFilter(studioDocId),
      isActive: true,
    }).select({ _id: 1 }).lean().exec();
    const existingIds = new Set(existing.map((block) => String(block._id)));
    if (existingIds.size !== blockIds.length || blockIds.some((id) => !existingIds.has(id))) {
      throw new BadRequestException(
        'Reorder must contain every active block in the studio document exactly once',
      );
    }

    await this.sessionRunner.run(async (session) => {
      await this.model.bulkWrite(
        blockIds.map((id, order) => ({
          updateOne: {
            filter: {
              _id: new Types.ObjectId(id),
              ...this.studioParentFilter(studioDocId),
              isActive: true,
            },
            update: { $set: { order } },
          },
        })),
        { ordered: true, session },
      );
    });
    return this.findAllByStudioDocument(studioDocId);
  }

  private assertSupportedPage(page: number | undefined, maxPage = 1): void {
    if (page === undefined) return;
    const safeMax = Math.max(1, Math.floor(maxPage));
    if (page < 1 || page > safeMax) {
      if (safeMax === 1) {
        throw new BadRequestException('Only page 1 is currently supported by the document builder');
      }
      throw new BadRequestException(`Page must be between 1 and ${safeMax}`);
    }
  }

  private async resolveStudioMaxPage(studioDocId: string): Promise<number> {
    if (!Types.ObjectId.isValid(studioDocId)) return 1;
    const doc = await this.studioDocumentModel
      .findById(studioDocId)
      .select({ manualPageCount: 1 })
      .lean()
      .exec();
    return Math.max(1, doc?.manualPageCount ?? 1);
  }

  private async resolveMaxPageForBlock(block: TemplateBlockDocument): Promise<number> {
    if (block.parentType === 'studio-document' && block.parentId) {
      return this.resolveStudioMaxPage(String(block.parentId));
    }
    return 1;
  }

  /**
   * TZ-DOC-333 — reject ephemeral image URLs on create/update.
   *
   * `settings.imageUrl` may only be:
   *   - absent / null / ''  → no image (or remove existing);
   *   - a `/uploads/...` path → persisted disk URL (canonical).
   * Anything else (`blob:`, `data:`, absolute http(s), relative paths) is
   * rejected with a 400 and an actionable message. Browser `blob:` URLs are
   * session-local and would render as broken images after reload — the FE
   * must upload via `POST /template-blocks/:id/image` and persist only the
   * returned `/uploads/...` URL.
   */
  private sanitizeSettings(
    settings: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!settings) return settings;
    const imageUrl = settings['imageUrl'];
    if (imageUrl === undefined || imageUrl === null || imageUrl === '') {
      return settings;
    }
    if (typeof imageUrl !== 'string') {
      throw new BadRequestException(
        'settings.imageUrl должен быть строкой: пустая строка (удалить фото) или URL вида /uploads/...',
      );
    }
    if (!imageUrl.startsWith('/uploads/')) {
      throw new BadRequestException(
        `settings.imageUrl содержит недопустимый URL. Разрешён только путь вида /uploads/template-blocks/... . Временные blob:/data: URL сохранять нельзя — загрузите файл через POST /template-blocks/:id/image.`,
      );
    }
    if (imageUrl.split('/').includes('..')) {
      throw new BadRequestException(
        'settings.imageUrl содержит недопустимый путь (../): путь не должен покидать каталог /uploads/.',
      );
    }
    return settings;
  }

  /**
   * TZ-DOC-333 — MIME → extension map for generated filenames. NEVER trust
   * `file.originalname`; derive the extension from the server-validated MIME
   * (controller `fileFilter` enforces the whitelist first). Mirrors the
   * DocumentTemplate `uploadBackground` reference implementation.
   */
  private static readonly MIME_TO_EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };

  /**
   * Exact shape of a persisted block-photo URL. Used as the ONLY allowlist
   * for the replace-unlink, so `..`/absolute/foreign paths can never escape
   * `uploads/template-blocks/{blockId}/`.
   */
  private static readonly BLOCK_IMAGE_URL_RE =
    /^\/uploads\/template-blocks\/[a-f0-9]{24}\/[a-f0-9-]{36}\.(png|jpg|webp)$/;

  /**
   * TZ-DOC-333 — persist a photo for an image block.
   *
   * Mirror of `DocumentTemplateService.uploadBackground` (canonical storage
   * pattern), with 1 block → 1 «current» imageUrl (replace semantics):
   *
   *   1. `findById(id)` → 404 on missing/invalid block.
   *   2. Derive safe filename `${randomUUID()}.${ext}` (no user input).
   *   3. Write buffer to `uploads/template-blocks/{id}/{filename}` BEFORE the
   *      DB write so a failed save leaves a concrete file to unlink.
   *   4. Set `settings.imageUrl = /uploads/template-blocks/{id}/{filename}`
   *      via `doc.save()` (audit plugin fires the same as update()).
   *   5. Best-effort `fs.unlink()` of the PREVIOUS block image (only paths
   *      inside `/uploads/template-blocks/` are ever touched).
   *   6. On save() failure → best-effort unlink of the orphan file + re-throw.
   *
   * Returns `{ url }` — the shape `TemplateBlocksService.uploadImage` (FE)
   * already expects. main.ts `useStaticAssets` serves `/uploads/*`.
   */
  async uploadImage(id: string, file: Express.Multer.File): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException(
        'Файл не получен. Выберите PNG, JPEG или WebP (поле «file»).',
      );
    }

    const doc = await this.findById(id);

    const ext = TemplateBlockService.MIME_TO_EXT[file.mimetype];
    if (!ext) {
      // Defense-in-depth: controller's fileFilter already rejects non-whitelisted MIME.
      throw new BadRequestException(
        `Недопустимый MIME-тип файла: ${file.mimetype}. Ожидается image/png | image/jpeg | image/webp.`,
      );
    }

    const filename = `${randomUUID()}.${ext}`;
    const dirPath = join(process.cwd(), 'uploads', 'template-blocks', id);
    const filePath = join(dirPath, filename);
    const publicUrl = `/uploads/template-blocks/${id}/${filename}`;

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, file.buffer);

    try {
      const settings = (doc.settings ?? {}) as Record<string, unknown>;
      const previousUrl = settings['imageUrl'];
      doc.settings = { ...settings, imageUrl: publicUrl };
      await doc.save();

      // Replace semantics: best-effort unlink of the previous block image.
      // STRICT shape check — an attacker-controlled value like
      // /uploads/template-blocks/../../secret must never reach fs.unlink
      // even though sanitizeSettings already rejects `..` on writes (defense
      // in depth for legacy/duplicated records).
      if (
        typeof previousUrl === 'string' &&
        TemplateBlockService.BLOCK_IMAGE_URL_RE.test(previousUrl)
      ) {
        await fs.unlink(join(process.cwd(), previousUrl)).catch(() => {});
      }
      return { url: publicUrl };
    } catch (err) {
      // Best-effort cleanup of the orphan file before surfacing the error.
      await fs.unlink(filePath).catch((unlinkErr) => {
        // Don't shadow the original error.
        // eslint-disable-next-line no-console
        console.warn(
          `[uploadImage] Failed to unlink orphan file ${filePath}: ${String(unlinkErr)}`,
        );
      });
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.unlinkBlockImage(doc);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date(), isActive: false } }).exec();
  }

  /**
   * TZ-DOC-STUDIO-1801 — hard-delete all blocks for a studio document and unlink images.
   */
  async deleteAllByStudioDocument(studioDocId: string): Promise<number> {
    if (!Types.ObjectId.isValid(studioDocId)) return 0;
    const blocks = await this.model.find(this.studioParentFilter(studioDocId)).exec();
    for (const block of blocks) {
      await this.unlinkBlockImage(block);
    }
    const result = await this.model.deleteMany(this.studioParentFilter(studioDocId)).exec();
    return result.deletedCount ?? 0;
  }

  private async unlinkBlockImage(doc: TemplateBlockDocument): Promise<void> {
    const settings = (doc.settings ?? {}) as Record<string, unknown>;
    const imageUrl = settings['imageUrl'];
    if (
      typeof imageUrl === 'string' &&
      TemplateBlockService.BLOCK_IMAGE_URL_RE.test(imageUrl)
    ) {
      await fs.unlink(join(process.cwd(), imageUrl)).catch(() => {});
    }
  }

  /**
   * TZ-DOC-STUDIO-1301 — copy active template blocks onto a studio document.
   *
   * @param templateId — template whose blocks are copied (dual-read parent filter)
   * @param studioDocId — target studio document id (parentId)
   * @param sourceTemplateId — legacy `templateId` stored on cloned blocks
   */
  async cloneBlocksFromTemplate(
    templateId: string,
    studioDocId: string,
    sourceTemplateId: string,
  ): Promise<TemplateBlockDocument[]> {
    if (!Types.ObjectId.isValid(studioDocId)) {
      throw new BadRequestException('studioDocId must be a valid ObjectId');
    }
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException('templateId must be a valid ObjectId');
    }

    const blocks = await this.findAll(templateId);
    const legacyTemplateId =
      sourceTemplateId && Types.ObjectId.isValid(sourceTemplateId)
        ? sourceTemplateId
        : studioDocId;

    const created: TemplateBlockDocument[] = [];
    for (const block of blocks) {
      created.push(
        await this.model.create({
          templateId: new Types.ObjectId(legacyTemplateId),
          parentType: 'studio-document',
          parentId: new Types.ObjectId(studioDocId),
          type: block.type,
          order: block.order,
          title: block.title,
          content: block.content,
          columns: block.columns,
          height: block.height,
          showLine: block.showLine,
          settings: block.settings,
          dataBinding: block.dataBinding,
          layout: block.layout,
          source: block.source,
          groupId: block.groupId,
          locked: block.locked,
          isActive: block.isActive,
        }),
      );
    }
    return created;
  }

  /**
   * TZ-DOC-STUDIO-1501 — copy active studio-document blocks onto a template
   * (inverse of {@link cloneBlocksFromTemplate}).
   */
  async cloneBlocksToTemplate(
    studioDocId: string,
    templateId: string,
    keepDataBindings = false,
  ): Promise<TemplateBlockDocument[]> {
    if (!Types.ObjectId.isValid(studioDocId)) {
      throw new BadRequestException('studioDocId must be a valid ObjectId');
    }
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException('templateId must be a valid ObjectId');
    }

    const blocks = await this.findAllByStudioDocument(studioDocId);
    const templateObjectId = new Types.ObjectId(templateId);

    const created: TemplateBlockDocument[] = [];
    for (const block of blocks) {
      const payload: Record<string, unknown> = {
        templateId: templateObjectId,
        parentType: 'template',
        parentId: templateObjectId,
        type: block.type,
        order: block.order,
        title: block.title,
        content: block.content,
        columns: block.columns,
        height: block.height,
        showLine: block.showLine,
        settings: block.settings,
        layout: block.layout,
        groupId: block.groupId,
        locked: block.locked,
        isActive: block.isActive,
      };

      if (keepDataBindings) {
        payload.dataBinding = block.dataBinding;
        payload.source = block.source;
      } else {
        const source = block.source as BlockSource | undefined;
        if (
          source &&
          typeof source === 'object' &&
          'kind' in source &&
          source.kind !== 'field'
        ) {
          payload.source = block.source;
        }
      }

      created.push(await this.model.create(payload));
    }
    return created;
  }

  /** TZ-DOC-STUDIO-1301 — clone active blocks between studio document instances. */
  async cloneBlocksFromStudioDocument(
    sourceStudioDocId: string,
    targetStudioDocId: string,
    sourceTemplateId?: string,
  ): Promise<TemplateBlockDocument[]> {
    if (!Types.ObjectId.isValid(sourceStudioDocId)) {
      throw new BadRequestException('sourceStudioDocId must be a valid ObjectId');
    }
    if (!Types.ObjectId.isValid(targetStudioDocId)) {
      throw new BadRequestException('targetStudioDocId must be a valid ObjectId');
    }

    const blocks = await this.findAllByStudioDocument(sourceStudioDocId);
    const legacyTemplateId =
      sourceTemplateId && Types.ObjectId.isValid(sourceTemplateId)
        ? sourceTemplateId
        : targetStudioDocId;

    const created: TemplateBlockDocument[] = [];
    for (const block of blocks) {
      created.push(
        await this.model.create({
          templateId: new Types.ObjectId(legacyTemplateId),
          parentType: 'studio-document',
          parentId: new Types.ObjectId(targetStudioDocId),
          type: block.type,
          order: block.order,
          title: block.title,
          content: block.content,
          columns: block.columns,
          height: block.height,
          showLine: block.showLine,
          settings: block.settings,
          dataBinding: block.dataBinding,
          layout: block.layout,
          source: block.source,
          groupId: block.groupId,
          locked: block.locked,
          isActive: block.isActive,
        }),
      );
    }
    return created;
  }
}
