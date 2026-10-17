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
import { CreateTextBlockCategoryDto } from './dto/create-text-block-category.dto';
import { UpdateTextBlockCategoryDto } from './dto/update-text-block-category.dto';
import {
  TextBlockCategory,
  TextBlockCategoryDocument,
} from './text-block-category.schema';
import {
  TextBlock,
  TextBlockDocument,
} from '../text-block/text-block.schema';

export interface TextBlockCategoryListQuery {
  /** Only active categories (for the text-block picker). */
  activeOnly?: boolean;
  /** Organization scope of the requesting user; system categories always included. */
  organizationId?: string | null;
  search?: string;
  /** Children of this specific category (subcategories under a root). */
  parentId?: string;
  /** Root (top-level) categories only — mutually exclusive with `parentId`. */
  rootsOnly?: boolean;
}

/**
 * TZ-DOC-315 — Category service for text blocks.
 *
 * Ownership-scoped CRUD + the server-side default resolution that the
 * TextBlockService delegates to:
 *
 *   - `resolveDefault(organizationId)` — active `isDefault` category in the
 *     org scope, falling back to the active system «Общее» (slug
 *     `SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG`). Returns null when
 *     neither exists; caller MUST fail with a 4xx instead of creating
 *     a text block without a category.
 *   - `assertAssignable(categoryId, organizationId)` — throws unless the
 *     category exists, is active, and belongs to the same org scope (or
 *     is a system/global category). Both NotFoundException (missing)
 *     and BadRequestException (inactive / foreign org) are testable 4xx
 *     responses.
 *   - `update`/`remove` take the CALLER's `organizationId` and refuse to
 *     touch categories owned by another organization (403 Forbidden) — IDOR guard.
 *   - `remove(id)` — refuses (409) when the category is referenced by any
 *     TextBlock. System categories cannot be removed OR renamed via the API.
 *
 * Uniqueness: scoped by compound unique index `{ organizationId, slug }`.
 * Duplicate-key errors surface as 409.
 */
@Injectable()
export class TextBlockCategoryService {
  private readonly logger = new Logger(TextBlockCategoryService.name);

  constructor(
    @InjectModel(TextBlockCategory.name)
    private readonly model: Model<TextBlockCategoryDocument>,
    @InjectModel(TextBlock.name)
    private readonly blockModel: Model<TextBlockDocument>,
  ) {}

  async create(
    dto: CreateTextBlockCategoryDto,
    organizationId?: string | null,
  ): Promise<TextBlockCategoryDocument> {
    const org = this.toOrgId(organizationId);
    if (dto.parentId) {
      await this.assertValidParent(dto.parentId, organizationId);
    }
    this.assertDefaultNotOnSubcategory(Boolean(dto.parentId), dto.isDefault);
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
      parentId: dto.parentId ? new Types.ObjectId(dto.parentId) : undefined,
    });
    this.logger.log(`Created text-block category ${slug}`);
    return doc;
  }

  /**
   * List categories visible to the requesting org: the org's own
   * categories plus every system/global category. Never leaks another
   * org's categories.
   *
   * The optional `search` (by name) and the org-scope `$or` are MERGED
   * via `$and` — search must never silently drop when org-scope also
   * applies. The search term is regex-escaped so metacharacters behave
   * as a literal filter.
   */
  async findAll(
    query: TextBlockCategoryListQuery = {},
  ): Promise<TextBlockCategoryDocument[]> {
    // Every constraint below is an independent clause combined via $and,
    // so parentId/rootsOnly compose cleanly with search + org-scope
    // instead of fighting over a single $or/$and slot.
    const clauses: Record<string, unknown>[] = [];
    if (query.activeOnly === true) clauses.push({ isActive: true });

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
      clauses.push(scope.length > 0 ? { $and: [nameRe, { $or: scope }] } : nameRe);
    } else if (scope.length > 0) {
      clauses.push({ $or: scope });
    }

    if (query.parentId) {
      if (!Types.ObjectId.isValid(query.parentId)) {
        throw new BadRequestException(`Invalid parentId ${query.parentId}`);
      }
      clauses.push({ parentId: new Types.ObjectId(query.parentId) });
    } else if (query.rootsOnly) {
      clauses.push({ $or: [{ parentId: { $exists: false } }, { parentId: null }] });
    }

    const filter: Record<string, unknown> =
      clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { $and: clauses };

    return this.model
      .find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

  async findById(id: string): Promise<TextBlockCategoryDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`TextBlockCategory ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`TextBlockCategory ${id} not found`);
    return doc;
  }

  /**
   * Update / rename. `organizationId` is the CALLER's org scope from the
   * authenticated request — a category owned by a different organization
   * is refused with 403 (IDOR guard). System (seed-managed) categories
   * cannot be modified via the API. Renaming keeps `_id` stable so every
   * TextBlock reference remains valid.
   */
  async update(
    id: string,
    dto: UpdateTextBlockCategoryDto,
    organizationId?: string | null,
  ): Promise<TextBlockCategoryDocument> {
    const doc = await this.findById(id);
    this.assertCallerCanManage(doc, organizationId);
    if (doc.isSystem) {
      throw new ConflictException(
        `Системную категорию «${doc.name}» изменять нельзя — она управляется сервером`,
      );
    }
    const nextHasParent = dto.parentId !== undefined ? Boolean(dto.parentId) : Boolean(doc.parentId);
    const nextIsDefault = dto.isDefault !== undefined ? dto.isDefault : doc.isDefault;
    this.assertDefaultNotOnSubcategory(nextHasParent, nextIsDefault);
    if (dto.parentId !== undefined) {
      await this.assertValidParent(dto.parentId, organizationId);
      doc.parentId = new Types.ObjectId(dto.parentId);
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
   * Safe removal. A category referenced by text blocks cannot be deleted:
   * the caller must reassign blocks first. System categories are
   * protected too. Foreign-org categories are refused with 403.
   */
  async remove(id: string, organizationId?: string | null): Promise<void> {
    const doc = await this.findById(id);
    this.assertCallerCanManage(doc, organizationId);
    if (doc.isSystem) {
      throw new ConflictException(
        `Системную категорию «${doc.name}» удалить нельзя`,
      );
    }
    const childCount = await this.model.countDocuments({ parentId: doc._id }).exec();
    if (childCount > 0) {
      throw new ConflictException(
        `У категории «${doc.name}» есть подкатегории (${childCount}) — сначала удалите или перенесите их`,
      );
    }
    const used = await this.blockModel
      .countDocuments({ categoryId: doc._id })
      .exec();
    if (used > 0) {
      throw new ConflictException(
        `Категорию «${doc.name}» используют ${used} блоков — удаление невозможно. Сначала переназначьте категории блоков.`,
      );
    }
    await this.model.deleteOne({ _id: doc._id }).exec();
  }

  /**
   * Server-side default category for NEW text blocks (TZ-DOC-315):
   *   1. active org-scoped category marked `isDefault`;
   *   2. active system «Общее» (slug `SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG`).
   * Returns null when neither exists — caller MUST fail with 4xx.
   */
  async resolveDefault(
    organizationId?: string | null,
  ): Promise<TextBlockCategoryDocument | null> {
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
        $or: [
          { organizationId: { $exists: false } },
          { organizationId: null },
        ],
        isActive: true,
        isDefault: true,
      })
      .sort({ sortOrder: 1 })
      .exec();
  }

  /**
   * Validates that a text block may reference this category.
   * Throws NotFoundException (missing) or BadRequestException
   * (inactive / foreign org) — both are testable 4xx.
   */
  async assertAssignable(
    categoryId: string,
    textBlockOrganizationId: string | Types.ObjectId,
  ): Promise<TextBlockCategoryDocument> {
    if (!Types.ObjectId.isValid(categoryId)) {
      throw new BadRequestException(`Invalid categoryId ${categoryId}`);
    }
    const doc = await this.model.findById(categoryId).exec();
    if (!doc) {
      throw new NotFoundException(`Категория текстового блока ${categoryId} не найдена`);
    }
    if (!doc.isActive) {
      throw new BadRequestException(
        `Категория «${doc.name}» неактивна — выберите активную категорию`,
      );
    }
    const blockOrg = String(textBlockOrganizationId ?? '');
    if (doc.organizationId && String(doc.organizationId) !== blockOrg) {
      throw new BadRequestException(
        `Категория «${doc.name}» принадлежит другой организации`,
      );
    }
    if (!doc.parentId) {
      throw new BadRequestException(
        `Категория «${doc.name}» — корневая; выберите подкатегорию`,
      );
    }
    return doc;
  }

  /**
   * TZ-NX-TEXT-CAT-PARENT — validates a would-be `parentId`: it must exist
   * and be a ROOT category (depth capped at 1) in a scope the caller may
   * nest under (their own org, or a system/global root).
   */
  private async assertValidParent(
    parentId: string,
    organizationId?: string | null,
  ): Promise<TextBlockCategoryDocument> {
    if (!Types.ObjectId.isValid(parentId)) {
      throw new BadRequestException(`Invalid parentId ${parentId}`);
    }
    const parent = await this.model.findById(parentId).exec();
    if (!parent) {
      throw new NotFoundException(`Родительская категория ${parentId} не найдена`);
    }
    if (parent.parentId) {
      throw new BadRequestException(
        `«${parent.name}» уже подкатегория — глубина категорий ограничена одним уровнем`,
      );
    }
    const org = this.toOrgId(organizationId);
    if (parent.organizationId && String(parent.organizationId) !== String(org ?? '')) {
      throw new BadRequestException(
        `Родительская категория «${parent.name}» принадлежит другой организации`,
      );
    }
    return parent;
  }

  /** `isDefault` is a root-only concept — the system/org default stays a top-level category. */
  private assertDefaultNotOnSubcategory(hasParent: boolean, isDefault?: boolean): void {
    if (hasParent && isDefault) {
      throw new BadRequestException(
        'У подкатегории нельзя включить «по умолчанию» — по умолчанию поддерживается только для корневых категорий',
      );
    }
  }

  /** IDOR guard: only the owning org (or a system caller) may manage a category. */
  private assertCallerCanManage(
    doc: TextBlockCategoryDocument,
    organizationId?: string | null,
  ): void {
    if (!organizationId) return;
    if (doc.organizationId && String(doc.organizationId) !== organizationId) {
      throw new ForbiddenException(
        `Категория «${doc.name}» принадлежит другой организации`,
      );
    }
  }

  /** Slugify: lowercase + Russian→Latin transliteration + kebab. */
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

  /** Escape user input for safe inclusion in a RegExp. */
  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private toOrgId(organizationId?: string | null): Types.ObjectId | undefined {
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) return undefined;
    return new Types.ObjectId(organizationId);
  }
}
