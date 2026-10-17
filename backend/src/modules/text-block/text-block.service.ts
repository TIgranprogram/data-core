import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TextBlockCategoryService } from '../text-block-category/text-block-category.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TextBlock, type TextBlockDocument } from './text-block.schema';
import { CreateTextBlockDto } from './dto/create-text-block.dto';
import { UpdateTextBlockDto } from './dto/update-text-block.dto';
import { sanitizeHtml, sanitizeBlockContent } from '../../common/sanitize-html';

/**
 * TZ-86 Phase A.1 — TextBlock service.
 *
 * CRUD over reusable text chunks. Markdown content stored plain; frontend
 * parser converts at consumption. Slug uniqueness enforced by Mongoose unique
 * index + duplicate-key catch (11000 → ConflictException 409). Soft-delete via
 * project plugin — deleteOne() captures `deletedAt` + audit_log automatically.
 *
 * TZ-DOC-322 — `categoryId` resolution contract (canonical):
 *   - `dto.categoryId` caller-supplied → `TextBlockCategoryService.assertAssignable()`.
 *   - else → `TextBlockCategoryService.resolveDefault(organizationId)`.
 *     Returns null only when the AppModule-wired seed
 *     (`TextBlockCategoriesSeed`, TZ-DOC-321) did not run or was
 *     deactivated by an administrator — in that case we surface a
 *     deterministic 4xx so ops notices missing-default-category instead
 *     of silently self-healing via a hidden upsert (TZ-DOC-320 ladder).
 *
 * TZ-NX-TEXT-CAT-PARENT — the silent-«Общее»-fallback above is GONE for
 * `create()`. PO decision: a subcategory is now mandatory for every new
 * text block. `dto.categoryId` is required and must resolve to a LEAF
 * (subcategory) via `assertAssignable` (which itself now rejects root
 * categories) — omitting it is a deterministic 400, not a silent
 * `resolveDefault()` upsert. Pre-existing blocks that still point at a
 * root category are left readable (no mass migration); only a NEW
 * create or an explicit `categoryId` on `update()` enforces the leaf
 * rule going forward.
 *
 * TZ-DOC-323 — the legacy `category: 'legal'|'intro'|'outro'|'custom'`
 * enum is GONE. The schema no longer has the field, the DTO rejects any
 * incoming `category` property via `ValidationPipe.forbidNonWhitelisted`
 * with an explicit 400, the controller's `?category=` query parameter is
 * removed. New callers must use `categoryId` exclusively. Pre-existing
 * DB rows have the legacy field `$unset` by the companion migration.
 */
@Injectable()
export class TextBlockService {
  constructor(
    @InjectModel(TextBlock.name)
    private readonly model: Model<TextBlockDocument>,
    private readonly categoryService: TextBlockCategoryService,
  ) {}

  async create(
    dto: CreateTextBlockDto,
    organizationId?: string | null,
  ): Promise<TextBlockDocument> {
    const slug = dto.slug ?? this.slugify(dto.name);
    const sanitizedTags = (dto.tags ?? []).map((t: string) => this.tagSanitize(t));

    if (!dto.categoryId) {
      throw new BadRequestException('Укажите подкатегорию для текстового блока');
    }
    const cat = await this.categoryService.assertAssignable(
      dto.categoryId,
      organizationId ?? '',
    );
    const categoryId = cat._id;

    try {
      return await this.model.create({
        name: dto.name,
        slug,
        categoryId,
        tags: sanitizedTags,
        content: sanitizeHtml(dto.content ?? ''),
        columns: (dto.columns ?? []).map((c) => ({
          ...c,
          content: sanitizeBlockContent(c.content ?? ''),
        })),
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      });
    } catch (err) {
      if (this.isDuplicateSlug(err)) {
        throw new ConflictException(
          `TextBlock with slug "${slug}" already exists`,
        );
      }
      throw err;
    }
  }

  async findAll(filter?: {
    isActive?: boolean;
    categoryId?: string;
  }): Promise<TextBlockDocument[]> {
    const q: Record<string, unknown> = {};
    if (filter?.categoryId) {
      if (!Types.ObjectId.isValid(filter.categoryId)) {
        throw new BadRequestException(`Invalid categoryId ${filter.categoryId}`);
      }
      q.categoryId = new Types.ObjectId(filter.categoryId);
    }
    if (typeof filter?.isActive === 'boolean') q.isActive = filter.isActive;
    return this.model
      .find(q)
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

  async findById(id: string): Promise<TextBlockDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`TextBlock ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`TextBlock ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    dto: UpdateTextBlockDto,
    organizationId?: string | null,
  ): Promise<TextBlockDocument> {
    const doc = await this.findById(id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.slug !== undefined && dto.slug !== doc.slug) {
      doc.slug = dto.slug;
      // Mark slug change but DO NOT return early — the rest of the dto
      // fields (content, columns, isActive, sortOrder, tags)
      // must still be applied. The single atomic `doc.save()` at the
      // end below enforces the slug unique index in one go.
    }
    if (dto.tags !== undefined) {
      doc.tags = dto.tags.map((t: string) => this.tagSanitize(t));
    }
    if (dto.content !== undefined) doc.content = sanitizeHtml(dto.content);
    if (dto.columns !== undefined) {
      doc.columns = dto.columns.map((c) => ({
        ...c,
        content: sanitizeBlockContent(c.content ?? ''),
      })) as any;
    }
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) doc.sortOrder = dto.sortOrder;
    if (dto.categoryId !== undefined) {
      // TZ-NX-TEXT-CAT-PARENT — an explicit categoryId on update must
      // resolve to a leaf (assertAssignable rejects roots). Omitting the
      // field leaves the existing category untouched — a pre-hierarchy
      // block still pointing at a root stays readable until the operator
      // explicitly re-files it (no mass migration).
      const cat = await this.categoryService.assertAssignable(
        dto.categoryId,
        organizationId ?? '',
      );
      doc.categoryId = cat._id;
    }
    // Single atomic save at the end — slug uniqueness is enforced by the
    // unique index; if it collides Mongoose throws E11000 and we surface
    // it as ConflictException.
    try {
      await doc.save();
    } catch (err) {
      if (this.isDuplicateSlug(err)) {
        throw new ConflictException(
          `TextBlock with slug "${doc.slug}" already exists`,
        );
      }
      throw err;
    }
    return doc;
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.deleteOne({ _id: doc._id }).exec();
    // softDelete plugin captures deletedAt + audit_log automatically.
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────

  /** Slugify: lowercase + transliterate Russian→Latin + kebab. Conservative map for MVP. */
  private slugify(name: string): string {
    const map: Record<string, string> = {
      а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
      з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
      п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
      ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
      я: 'ya',
    };
    const cleaned = name
      .toLowerCase()
      .split('')
      .map((ch) => map[ch] ?? ch)
      .join('')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return cleaned || `block-${Date.now().toString(36)}`;
  }

  /** Tag sanitisation: kebab-case, lowercase, max 30 chars. */
  private tagSanitize(t: string): string {
    return t
      .toLowerCase()
      .replace(/[^a-zа-я0-9\s-]/gi, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
  }

  /** Mongoose duplicate-key error code (MongoServerError). */
  private isDuplicateSlug(err: unknown): boolean {
    return (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: number }).code === 11000
    );
  }
}
