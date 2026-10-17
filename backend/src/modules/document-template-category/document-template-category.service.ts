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
import { CreateDocumentTemplateCategoryDto } from './dto/create-document-template-category.dto';
import { UpdateDocumentTemplateCategoryDto } from './dto/update-document-template-category.dto';
import {
  DocumentTemplateCategory,
  DocumentTemplateCategoryDocument,
} from './document-template-category.schema';
import { DocumentTemplate, DocumentTemplateDocument } from '../document-template/document-template.schema';

/** Slug of the seeded system default category. */
export const SYSTEM_DEFAULT_CATEGORY_SLUG = 'obshchee';

export interface DocumentTemplateCategoryListQuery {
  /** Only active categories (for the template-create form). */
  activeOnly?: boolean;
  /** Organization scope of the requesting user; system categories always included. */
  organizationId?: string | null;
  search?: string;
}

/**
 * TZ-DOC-307 — Category service for document templates.
 *
 * Ownership-scoped CRUD + the server-side default resolution that the
 * DocumentTemplateService delegates to:
 *
 *   - `resolveDefault(organizationId)` — active `isDefault` category in the
 *     org scope, falling back to the active system «Общее» (slug
 *     `obshchee`). Never returns an inactive/system category that a new
 *     template could not reference.
 *   - `assertAssignable(categoryId, organizationId)` — throws a testable
 *     4xx unless the category exists, is active, and belongs to the same
 *     org scope (or is a system/global category).
 *   - `update`/`remove` take the CALLER's `organizationId` and refuse to
 *     touch categories owned by another organization (403 Forbidden) —
 *     closing the IDOR gap where an admin from org B could rename/delete
 *     org A's category by guessing the id.
 *   - `remove(id)` — refuses (409) when the category is referenced by
 *     templates, so we never leave dangling references. System categories
 *     are seed-managed and cannot be removed OR renamed via the API.
 *
 * Uniqueness: scoped by the compound unique index {organizationId, slug}
 * (schema). Duplicate-key errors surface as 409 Conflict.
 */
@Injectable()
export class DocumentTemplateCategoryService {
  private readonly logger = new Logger(DocumentTemplateCategoryService.name);

  constructor(
    @InjectModel(DocumentTemplateCategory.name)
    private readonly model: Model<DocumentTemplateCategoryDocument>,
    @InjectModel(DocumentTemplate.name)
    private readonly templateModel: Model<DocumentTemplateDocument>,
  ) {}

  async create(
    dto: CreateDocumentTemplateCategoryDto,
    organizationId?: string | null,
  ): Promise<DocumentTemplateCategoryDocument> {
    const org = this.toOrgId(organizationId);
    const slug = dto.slug ?? this.slugify(dto.name);
    const existing = await this.model
      .findOne({ organizationId: org, slug })
      .exec();
    if (existing) {
      throw new ConflictException(
        `Категория с ключом «${slug}» уже существует в этой области`,
      );
    }
    const doc = await this.model.create({
      name: dto.name,
      slug,
      description: dto.description,
      isActive: dto.isActive ?? true,
      isDefault: dto.isDefault ?? false,
      sortOrder: dto.sortOrder ?? 0,
      organizationId: org,
      isSystem: false,
    });
    this.logger.log(`Created document-template category ${slug}`);
    return doc;
  }

  /**
   * List categories visible to the requesting org: the org's own
   * categories plus every system/global category. Never leaks another
   * org's categories.
   *
   * The optional `search` (by name) and the org-scope `$or` are MERGED
   * via `$and` — the search term must never silently drop when an org
   * scope filter is also applied (regression guard added in spec).
   * The search term is regex-escaped so metacharacters (`(`, `[`, …)
   * behave as a literal filter instead of throwing a SyntaxError.
   */
  async findAll(
    query: DocumentTemplateCategoryListQuery = {},
  ): Promise<DocumentTemplateCategoryDocument[]> {
    const filter: Record<string, unknown> = {};
    if (query.activeOnly === true) filter.isActive = true;

    const scope: Record<string, unknown>[] = [];
    if (query.organizationId) {
      const org = this.toOrgId(query.organizationId);
      scope.push(
        { organizationId: org },
        { organizationId: { $exists: false } },
      );
    }

    if (query.search) {
      const safeTerm = this.escapeRegex(query.search);
      const nameRe = { name: new RegExp(safeTerm, 'i') };
      if (scope.length > 0) {
        // Search AND (own org OR system) — combined, not overwritten.
        filter.$and = [nameRe, { $or: scope }];
      } else {
        filter.$or = [nameRe];
      }
    } else if (scope.length > 0) {
      filter.$or = scope;
    }

    return this.model
      .find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

  async findById(id: string): Promise<DocumentTemplateCategoryDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`DocumentTemplateCategory ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`DocumentTemplateCategory ${id} not found`);
    return doc;
  }

  /**
   * Update / rename. `organizationId` is the CALLER's org scope from the
   * authenticated request — a category owned by a different organization
   * is refused with 403 (IDOR guard). System (seed-managed) categories
   * cannot be modified via the API (they are global bootstrap data).
   * Renaming keeps `_id` (and therefore every template reference) stable.
   */
  async update(
    id: string,
    dto: UpdateDocumentTemplateCategoryDto,
    organizationId?: string | null,
  ): Promise<DocumentTemplateCategoryDocument> {
    const doc = await this.findById(id);
    this.assertCallerCanManage(doc, organizationId);
    if (doc.isSystem) {
      throw new ConflictException(
        `Системную категорию «${doc.name}» изменять нельзя — она управляется сервером`,
      );
    }
    const newSlug = dto.slug ?? doc.slug;
    if (dto.slug !== undefined && dto.slug !== doc.slug) {
      const org = doc.organizationId ?? undefined;
      const existing = await this.model
        .findOne({ _id: { $ne: doc._id }, organizationId: org, slug: newSlug })
        .exec();
      if (existing) {
        throw new ConflictException(
          `Категория с ключом «${newSlug}» уже существует в этой области`,
        );
      }
    }
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.slug !== undefined) doc.slug = dto.slug;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.isDefault !== undefined) doc.isDefault = dto.isDefault;
    if (dto.sortOrder !== undefined) doc.sortOrder = dto.sortOrder;
    return doc.save();
  }

  /**
   * Safe removal. A category referenced by templates cannot be deleted:
   * the caller must reassign templates first, or keep the category.
   * System categories are protected too (seed-managed global scope).
   * `organizationId` is the caller's org scope — foreign-org categories
   * are refused with 403.
   */
  async remove(id: string, organizationId?: string | null): Promise<void> {
    const doc = await this.findById(id);
    this.assertCallerCanManage(doc, organizationId);
    if (doc.isSystem) {
      throw new ConflictException(
        `Системную категорию «${doc.name}» удалить нельзя`,
      );
    }
    const used = await this.templateModel.countDocuments({ categoryId: doc._id }).exec();
    if (used > 0) {
      throw new ConflictException(
        `Категорию «${doc.name}» используют ${used} шаблонов — удаление невозможно. Сначала переназначьте категории шаблонов.`,
      );
    }
    await this.model.deleteOne({ _id: doc._id }).exec();
  }

  /**
   * Server-side default category for NEW templates (TZ-DOC-307 §ШАГ 4):
   *   1. active org-scoped category marked `isDefault` in the template's org;
   *   2. active system «Общее» (slug `obshchee`).
   * Returns null when neither exists → the caller MUST fail with a
   * testable 4xx instead of creating a template without a category.
   */
  async resolveDefault(
    organizationId?: string | null,
  ): Promise<DocumentTemplateCategoryDocument | null> {
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      const orgDefault = await this.model
        .findOne({
          organizationId: new Types.ObjectId(organizationId),
          isActive: true,
          isDefault: true,
        })
        .sort({ sortOrder: 1 })
        .exec();
      if (orgDefault) return orgDefault;
    }
    return this.model
      .findOne({
        organizationId: { $exists: false },
        isActive: true,
        isDefault: true,
      })
      .sort({ sortOrder: 1 })
      .exec();
  }

  /**
   * Validates that a template may reference this category:
   * exists + active + same org scope (or system/global).
   * Throws NotFoundException (missing) or BadRequestException
   * (inactive / foreign org) — both are testable 4xx responses.
   */
  async assertAssignable(
    categoryId: string,
    templateOrganizationId: string | Types.ObjectId,
  ): Promise<DocumentTemplateCategoryDocument> {
    if (!Types.ObjectId.isValid(categoryId)) {
      throw new BadRequestException(`Invalid categoryId ${categoryId}`);
    }
    const doc = await this.model.findById(categoryId).exec();
    if (!doc) {
      throw new NotFoundException(`Категория шаблона ${categoryId} не найдена`);
    }
    if (!doc.isActive) {
      throw new BadRequestException(
        `Категория «${doc.name}» неактивна — выберите активную категорию`,
      );
    }
    const templateOrg = String(templateOrganizationId);
    if (doc.organizationId && String(doc.organizationId) !== templateOrg) {
      throw new BadRequestException(
        `Категория «${doc.name}» принадлежит другой организации`,
      );
    }
    return doc;
  }

  /** IDOR guard: only the owning org (or a system user) may manage a category. */
  private assertCallerCanManage(
    doc: DocumentTemplateCategoryDocument,
    organizationId?: string | null,
  ): void {
    if (!organizationId) return; // system user → full access
    if (doc.organizationId && String(doc.organizationId) !== organizationId) {
      throw new ForbiddenException(
        `Категория «${doc.name}» принадлежит другой организации`,
      );
    }
  }

  /** Slugify (mirrors TextBlockService): lowercase + Russian→Latin + kebab. */
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
    return cleaned || `category-${Date.now().toString(36)}`;
  }

  /** Escape user input for safe inclusion in a RegExp (mirrors CategoryService). */
  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private toOrgId(organizationId?: string | null): Types.ObjectId | undefined {
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) return undefined;
    return new Types.ObjectId(organizationId);
  }
}
