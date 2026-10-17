import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DocumentTemplateCategoryDocument = HydratedDocument<DocumentTemplateCategory>;

/**
 * TZ-DOC-307 — Category for document templates.
 *
 * Deliberately a SEPARATE entity from the generic `Category`
 * (backend/src/modules/category/category.schema.ts):
 *
 *   - The generic Category requires a unique `skuPrefix` (material/product
 *     SKU auto-generation concern) and its unique index is GLOBAL
 *     `{ type: 1, slug: 1 }` — neither can express an org-scoped document
 *     category without risking material/product data.
 *   - This entity has NO skuPrefix, and slug uniqueness is scoped to the
 *     ownership area: the compound unique index `{ organizationId, slug }`
 *     allows the same slug in different organizations while enforcing
 *     uniqueness within one organization.
 *
 * Scope model:
 *   - `organizationId` set        → organization-scoped category.
 *   - `organizationId` undefined  → SYSTEM scope (visible to every org).
 *     System categories are created only by seed/admin (`isSystem: true`).
 *
 * Default behavior:
 *   - The seed creates one system default «Общее» (slug `obshchee`,
 *     `isDefault: true`). New templates without an explicit categoryId get
 *     the org-scoped `isDefault` category if one exists, otherwise the
 *     system «Общее» — resolved SERVER-SIDE (see
 *     DocumentTemplateCategoryService.resolveDefault / assertAssignable).
 */
@Schema({ collection: 'document_template_categories', timestamps: true })
export class DocumentTemplateCategory {
  @Prop({ required: true, index: true })
  name!: string;

  /** Stable key. Renaming the category does NOT change the id/slug reference used by templates. */
  @Prop({ required: true })
  slug!: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /** True only for seed-created system categories (global scope). */
  @Prop({ default: false, index: true })
  isSystem?: boolean;

  /** True for the category used as the server-side default for new templates. */
  @Prop({ default: false, index: true })
  isDefault?: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop()
  description?: string;

  /** TZ-240 convention: undefined/null = system (global) record. */
  @Prop({ required: false, sparse: true, index: true })
  organizationId?: Types.ObjectId;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const DocumentTemplateCategorySchema =
  SchemaFactory.createForClass(DocumentTemplateCategory);

// Uniqueness scoped to the ownership area. Missing organizationId indexes
// as null, so system categories share one slug namespace and each
// organization gets its own — exactly the ownership-scoped contract.
DocumentTemplateCategorySchema.index(
  { organizationId: 1, slug: 1 },
  { unique: true },
);
