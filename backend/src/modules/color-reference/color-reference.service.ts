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
import { CreateColorReferenceDto } from './dto/create-color-reference.dto';
import { UpdateColorReferenceDto } from './dto/update-color-reference.dto';
import {
  ColorReference,
  ColorReferenceDocument,
} from './color-reference.schema';

export interface ColorReferenceListQuery {
  /** Only active colors (for the product form RAL dropdown — TZ-PRODUCTS-302). */
  activeOnly?: boolean;
  /** Organization scope of the requesting user; system colors always included. */
  organizationId?: string | null;
  search?: string;
}

/** Canonical `#RRGGBB` check (mirrors DTO @IsHexColor). */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * TZ-PRODUCTS-301 — Color reference dictionary service.
 *
 * Ownership-scoped CRUD + the server-side default resolution that the
 * product form dialog will delegate to (TZ-PRODUCTS-302):
 *
 *   - `resolveDefault(organizationId)` — active `isDefault` color in the
 *     org scope, falling back to the active system «Не выбран» (slug
 *     `ne_vybran`). Never returns an inactive/system color.
 *   - `assertDefaultId(colorId, organizationId)` — throws a testable 4xx
 *     unless the colorId exists, is active, is `isDefault`, and belongs to
 *     the same org scope (or is a system/global color). Callers resolving
 *     the default for a product use this when the client sent an explicit id.
 *   - `assertAssignable(colorId, organizationId)` — mirrors TZ-DOC-307/315:
 *     exists + active + same org scope (or system).
 *   - `update`/`remove` take the CALLER's `organizationId` and refuse to
 *     touch colors owned by another organization (403 Forbidden) — closing
 *     the IDOR gap (TZ-DOC-315 pattern).
 *   - `remove(id)` — soft-deletes (`deletedAt`). Refuses (409) system
 *     colors and the `isDefault` color («Не выбран» is the product default;
 *     deleting it would break the resolveDefault contract).
 *
 * Uniqueness: scoped by the compound unique index {organizationId, slug}
 * (schema). Duplicate-key errors surface as 409 Conflict.
 */
@Injectable()
export class ColorReferenceService {
  private readonly logger = new Logger(ColorReferenceService.name);

  constructor(
    @InjectModel(ColorReference.name)
    private readonly model: Model<ColorReferenceDocument>,
  ) {}

  async create(
    dto: CreateColorReferenceDto,
    organizationId?: string | null,
  ): Promise<ColorReferenceDocument> {
    const org = this.toOrgId(organizationId);
    const slug = dto.slug ?? this.slugify(dto.name);
    this.assertValidHex(dto.hex);
    const existing = await this.model
      .findOne({ organizationId: org, slug })
      .exec();
    if (existing) {
      throw new ConflictException(
        `Цвет с ключом «${slug}» уже существует в этой области`,
      );
    }
    const doc = await this.model.create({
      name: dto.name,
      slug,
      hex: dto.hex,
      description: dto.description,
      isActive: dto.isActive ?? true,
      isDefault: dto.isDefault ?? false,
      organizationId: org,
      isSystem: false,
    });
    this.logger.log(`Created color reference ${slug}`);
    return doc;
  }

  /**
   * List colors visible to the requesting org: the org's own colors plus
   * every system/global color. Never leaks another org's colors.
   *
   * `activeOnly` filters to active colors (RAL dropdown catalog). The
   * optional `search` (by name OR slug) and the org-scope `$or` are MERGED
   * via `$and` — the search term must never silently drop when an org scope
   * filter is also applied (TZ-DOC-315 regression guard). The search term
   * is regex-escaped so metacharacters behave as a literal filter.
   * Soft-deleted rows are excluded.
   */
  async findAll(
    query: ColorReferenceListQuery = {},
  ): Promise<ColorReferenceDocument[]> {
    const filter: Record<string, unknown> = {
      deletedAt: { $exists: false },
    };
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
      const nameOrSlug = {
        $or: [{ name: new RegExp(safeTerm, 'i') }, { slug: new RegExp(safeTerm, 'i') }],
      };
      if (scope.length > 0) {
        // Search AND (own org OR system) — combined, not overwritten.
        filter.$and = [nameOrSlug, { $or: scope }];
      } else {
        filter.$and = [nameOrSlug];
      }
    } else if (scope.length > 0) {
      filter.$or = scope;
    }

    return this.model.find(filter).sort({ name: 1 }).exec();
  }

  async findById(id: string): Promise<ColorReferenceDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ColorReference ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc || doc.deletedAt) {
      throw new NotFoundException(`ColorReference ${id} not found`);
    }
    return doc;
  }

  /**
   * Update / rename. `organizationId` is the CALLER's org scope from the
   * authenticated request — a color owned by a different organization is
   * refused with 403 (IDOR guard). System (seed-managed) colors cannot be
   * modified via the API. Renaming keeps `_id` (and therefore every product
   * `ralCode` reference) stable.
   */
  async update(
    id: string,
    dto: UpdateColorReferenceDto,
    organizationId?: string | null,
  ): Promise<ColorReferenceDocument> {
    const doc = await this.findById(id);
    this.assertCallerCanManage(doc, organizationId);
    if (doc.isSystem) {
      throw new ConflictException(
        `Системный цвет «${doc.name}» изменять нельзя — он управляется сервером`,
      );
    }
    this.assertValidHex(dto.hex);
    const newSlug = dto.slug ?? doc.slug;
    if (dto.slug !== undefined && dto.slug !== doc.slug) {
      const org = doc.organizationId ?? undefined;
      const existing = await this.model
        .findOne({ _id: { $ne: doc._id }, organizationId: org, slug: newSlug })
        .exec();
      if (existing) {
        throw new ConflictException(
          `Цвет с ключом «${newSlug}» уже существует в этой области`,
        );
      }
    }
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.slug !== undefined) doc.slug = dto.slug;
    if (dto.hex !== undefined) doc.hex = dto.hex;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.isDefault !== undefined) doc.isDefault = dto.isDefault;
    return doc.save();
  }

  /**
   * Safe soft-removal. System colors cannot be deleted, and the `isDefault`
   * color («Не выбран») cannot be deleted — the product default contract
   * depends on it (409). Foreign-org colors are refused with 403.
   */
  async remove(id: string, organizationId?: string | null): Promise<void> {
    const doc = await this.findById(id);
    this.assertCallerCanManage(doc, organizationId);
    if (doc.isSystem) {
      throw new ConflictException(
        `Системный цвет «${doc.name}» удалить нельзя`,
      );
    }
    if (doc.isDefault) {
      throw new ConflictException(
        `Цвет «${doc.name}» используется как цвет по умолчанию — удаление невозможно. Сначала снимите отметку «по умолчанию».`,
      );
    }
    doc.deletedAt = new Date();
    await doc.save();
  }

  /**
   * Server-side default color for products without an explicit color
   * (TZ-PRODUCTS-301/302):
   *   1. active org-scoped color marked `isDefault` in the product's org;
   *   2. active system «Не выбран» (slug `ne_vybran`).
   * Returns null when neither exists → the caller MUST fail with a
   * testable 4xx instead of creating a product without a color.
   */
  async resolveDefault(
    organizationId?: string | null,
  ): Promise<ColorReferenceDocument | null> {
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      const orgDefault = await this.model
        .findOne({
          organizationId: new Types.ObjectId(organizationId),
          isActive: true,
          isDefault: true,
          deletedAt: { $exists: false },
        })
        .exec();
      if (orgDefault) return orgDefault;
    }
    return this.model
      .findOne({
        organizationId: { $exists: false },
        isActive: true,
        isDefault: true,
        deletedAt: { $exists: false },
      })
      .exec();
  }

  /**
   * Validates that a client-supplied colorId may be used as the server-side
   * default: exists + active + isDefault + same org scope (or system).
   * Throws NotFoundException (missing) or BadRequestException
   * (inactive / not-a-default / foreign org) — testable 4xx responses.
   */
  async assertDefaultId(
    colorId: string,
    organizationId: string | Types.ObjectId,
  ): Promise<ColorReferenceDocument> {
    if (!Types.ObjectId.isValid(colorId)) {
      throw new BadRequestException(`Invalid colorId ${colorId}`);
    }
    const doc = await this.model.findById(colorId).exec();
    if (!doc || doc.deletedAt) {
      throw new NotFoundException(`Цвет ${colorId} не найден`);
    }
    if (!doc.isActive) {
      throw new BadRequestException(
        `Цвет «${doc.name}» неактивен — выберите активный цвет`,
      );
    }
    if (!doc.isDefault) {
      throw new BadRequestException(
        `Цвет «${doc.name}» не отмечен как цвет по умолчанию`,
      );
    }
    const org = String(organizationId);
    if (doc.organizationId && String(doc.organizationId) !== org) {
      throw new BadRequestException(
        `Цвет «${doc.name}» принадлежит другой организации`,
      );
    }
    return doc;
  }

  /**
   * Validates that a product may reference this color (TZ-DOC-307/315 mirror):
   * exists + active + same org scope (or system). Throws NotFoundException
   * (missing) or BadRequestException (inactive / foreign org).
   */
  async assertAssignable(
    colorId: string,
    organizationId: string | Types.ObjectId,
  ): Promise<ColorReferenceDocument> {
    if (!Types.ObjectId.isValid(colorId)) {
      throw new BadRequestException(`Invalid colorId ${colorId}`);
    }
    const doc = await this.model.findById(colorId).exec();
    if (!doc || doc.deletedAt) {
      throw new NotFoundException(`Цвет ${colorId} не найден`);
    }
    if (!doc.isActive) {
      throw new BadRequestException(
        `Цвет «${doc.name}» неактивен — выберите активный цвет`,
      );
    }
    const org = String(organizationId);
    if (doc.organizationId && String(doc.organizationId) !== org) {
      throw new BadRequestException(
        `Цвет «${doc.name}» принадлежит другой организации`,
      );
    }
    return doc;
  }

  /** IDOR guard: only the owning org (or a system caller) may manage a color. */
  private assertCallerCanManage(
    doc: ColorReferenceDocument,
    organizationId?: string | null,
  ): void {
    if (!organizationId) return; // system user → full access
    if (doc.organizationId && String(doc.organizationId) !== organizationId) {
      throw new ForbiddenException(
        `Цвет «${doc.name}» принадлежит другой организации`,
      );
    }
  }

  /** Rejects malformed #RRGGBB values (service-level backstop to the DTO). */
  private assertValidHex(hex?: string): void {
    if (hex !== undefined && !HEX_RE.test(hex)) {
      throw new BadRequestException(
        'hex должен быть в формате #RRGGBB (например, #F4F4F4)',
      );
    }
  }

  /** Slugify (mirrors DocumentTemplateCategoryService): lowercase + Russian→Latin + kebab. */
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
    return cleaned || `color-${Date.now().toString(36)}`;
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
