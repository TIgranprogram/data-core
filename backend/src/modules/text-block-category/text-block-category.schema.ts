import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TextBlockCategoryDocument = HydratedDocument<TextBlockCategory>;

/** Slug of the seeded system default category (TZ-DOC-315). */
export const SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG = 'obshchee';

/**
 * TZ-DOC-315 — Category for text blocks.
 *
 * Mirrors the DocumentTemplateCategory pattern (TZ-DOC-307) but for the
 * `text-block` domain. Deliberately a SEPARATE entity:
 *
 *   - The generic `Category` (backend/src/modules/category/*) requires a
 *     unique `skuPrefix` (material/product SKU auto-generation concern)
 *     and its unique index is GLOBAL `{ type, slug }` — incompatible with
 *     org-scoped text-block categories.
 *   - `DocumentTemplateCategory` is a DOCUMENT-template concern; reusing
 *     it for text-blocks would mix two domains with different RBAC and
 *     different default-resolution rules.
 *
 * Scope model (TZ-240 convention):
 *   - `organizationId` set        → organization-scoped category.
 *   - `organizationId` undefined  → SYSTEM scope (visible to every org).
 *     System categories are created only by seed/admin (`isSystem: true`).
 *
 * Default behavior:
 *   - The seed creates one system default «Общее» (slug
 *     `SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG`, `isDefault: true`).
 *     New text blocks without an explicit `categoryId` get the org-scoped
 *     `isDefault` category if one exists, otherwise the system «Общее» —
 *     resolved SERVER-SIDE (see `TextBlockCategoryService.resolveDefault`).
 */
@Schema({ collection: 'text_block_categories', timestamps: true })
export class TextBlockCategory {
  @Prop({ required: true, index: true })
  name!: string;

  /** Stable key. Renaming the category does NOT change the id reference used by TextBlock. */
  @Prop({ required: true })
  slug!: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /** True only for seed-created system categories (global scope). */
  @Prop({ default: false, index: true })
  isSystem?: boolean;

  /** True for the category used as the server-side default for new text blocks. */
  @Prop({ default: false, index: true })
  isDefault?: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop()
  description?: string;

  /** TZ-240 convention: undefined/null = system (global) record. */
  @Prop({ required: false, sparse: true, index: true })
  organizationId?: Types.ObjectId;

  /**
   * TZ-NX-TEXT-CAT-PARENT — undefined/null = root (top-level) category.
   * Set = this category is a SUBCATEGORY whose parent is `parentId`.
   * Depth is capped at 1: the referenced parent must itself be a root
   * (its own `parentId` must be null) — enforced in
   * `TextBlockCategoryService.assertValidParent`, not at the schema level.
   * `TextBlock.categoryId` must reference a LEAF (subcategory) —
   * enforced in `TextBlockCategoryService.assertAssignable`.
   */
  @Prop({ type: Types.ObjectId, ref: 'TextBlockCategory', index: true })
  parentId?: Types.ObjectId;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const TextBlockCategorySchema =
  SchemaFactory.createForClass(TextBlockCategory);

// Uniqueness scoped to the ownership area. Missing organizationId indexes
// as null, so system categories share one slug namespace and each
// organization gets its own — exactly the ownership-scoped contract.
TextBlockCategorySchema.index(
  { organizationId: 1, slug: 1 },
  { unique: true },
);
