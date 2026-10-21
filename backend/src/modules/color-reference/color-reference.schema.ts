import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ColorReferenceDocument = HydratedDocument<ColorReference>;

/** Slug of the seeded system default color («Не выбран»). */
export const SYSTEM_DEFAULT_COLOR_SLUG = 'ne_vybran';

/**
 * TZ-PRODUCTS-301 — Color reference dictionary (RAL).
 *
 * Deliberately a SEPARATE entity from the generic `Category`: colors are a
 * product-domain dictionary keyed by a stable `slug` (kebab-lowercase, the
 * value stored in `Product.ralCode` by the product form dialog — TZ-PRODUCTS-302),
 * with an optional `hex` swatch. The generic Category carries `skuPrefix` +
 * `type` semantics that do not apply here.
 *
 * Scope model (TZ-240 convention, mirrors TZ-DOC-307/315):
 *   - `organizationId` set        → organization-scoped color.
 *   - `organizationId` undefined  → SYSTEM scope (visible to every org).
 *     System colors are created only by seed (`isSystem: true`).
 *
 * Default behavior:
 *   - The seed creates one system default «Не выбран» (slug `ne_vybran`,
 *     `isDefault: true`). The product dialog offers it as the explicit
 *     "no color chosen" option; `resolveDefault()` resolves it server-side.
 *
 * Soft-delete: `remove()` sets `deletedAt` (worker/counterparty pattern);
 * `findAll`/`findById` exclude deleted rows.
 */
@Schema({ collection: 'color_references', timestamps: true })
export class ColorReference {
  @Prop({ required: true, index: true })
  name!: string;

  /** Stable key. Renaming the color does NOT change the slug reference used by products. */
  @Prop({ required: true })
  slug!: string;

  /** Optional #RRGGBB swatch (validated in DTO + service). */
  @Prop()
  hex?: string;

  @Prop()
  description?: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /** True only for seed-created system colors (global scope). */
  @Prop({ default: false, index: true })
  isSystem?: boolean;

  /** True for the color used as the server-side default for products without a color. */
  @Prop({ default: false, index: true })
  isDefault?: boolean;

  /** Soft-delete marker (TZ-PRODUCTS-301). */
  @Prop({ index: true })
  deletedAt?: Date;

  /** TZ-240 convention: undefined/null = system (global) record. */
  @Prop({ required: false, sparse: true, index: true })
  organizationId?: Types.ObjectId;
}

export const ColorReferenceSchema = SchemaFactory.createForClass(ColorReference);

// Uniqueness scoped to the ownership area. Missing organizationId indexes
// as null, so system colors share one slug namespace and each organization
// gets its own — exactly the ownership-scoped contract (TZ-DOC-307/315 mirror).
ColorReferenceSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
