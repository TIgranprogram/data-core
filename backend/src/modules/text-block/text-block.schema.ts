import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * TZ-86 Phase A.1 — TextBlock (extended for visual constructor).
 *
 * Reusable text chunks composable into document templates. Now supports
 * both:
 *   - **Simple** (legacy): `content` as HTML string
 *   - **Multi-column** (new): `columns[]` array, each with its own HTML content
 *
 * `slug` is auto-generated from name if omitted. `tags`, `sortOrder` are
 * optional (the simplified UI no longer exposes them).
 *
 * TZ-DOC-315 added the FK `categoryId?: Types.ObjectId` so text blocks
 * can be grouped under a user-defined TextBlockCategory.
 *
 * TZ-DOC-323 — the legacy enum `category: 'legal'|'intro'|'outro'|'custom'`
 * is REMOVED end-to-end. Callers that previously set `dto.category` either
 * (a) have already migrated to `categoryId` (frontend per TZ-DOC-316), or
 * (b) receive an explicit 400 from the global `ValidationPipe` whose
 * `forbidNonWhitelisted: true` rejects unknown properties in incoming
 * payloads. The companion migration
 * `backend/src/database/migrations/2026-08-02-TZ-DOC-323-remove-legacy-text-block-category.ts`
 * `$unset`s the legacy field on existing documents.
 */

export interface TextBlockColumn {
  id: string;
  content: string;
  width: number;
  fontSize?: number;
}

export type TextBlockDocument = HydratedDocument<TextBlock>;

@Schema({ collection: 'text_blocks', timestamps: true })
export class TextBlock {
  @Prop({ required: true, maxlength: 200 })
  name!: string;

  /** Unique slug — auto-generated from name (kebab-case + transliteration) if caller omits. */
  @Prop({ required: true, unique: true, index: true, maxlength: 100 })
  slug!: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  /** Content for simple blocks (HTML, previously CommonMark markdown). */
  @Prop({ maxlength: 50000 })
  content?: string;

  /** Multi-column layout (when set, content is rendered as columns). */
  @Prop({
    type: [{
      id: { type: String, required: true },
      content: { type: String, default: '' },
      width: { type: Number, default: 1 },
      fontSize: { type: Number, default: 14 },
    }],
    default: [],
    _id: false,
  })
  columns?: TextBlockColumn[];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /**
   * TZ-DOC-315 — FK → TextBlockCategory. Optional on persisted model for
   * READ compatibility with legacy blocks; new blocks always receive a
   * category SERVER-SIDE via TextBlockCategoryService (assertAssignable
   * for caller-provided ids, else resolveDefault to org/system default).
   *
   * Required at the service layer for new blocks — the model itself keeps
   * the field optional to preserve read compatibility with pre-existing
   * documents whose `categoryId` was back-filled by the TZ-DOC-307-style
   * migration. The service contract (TZ-DOC-322) raises a deterministic
   * 400 when the system default is missing.
   */
  @Prop({ type: Types.ObjectId, ref: 'TextBlockCategory', index: true, sparse: true })
  categoryId?: Types.ObjectId;

  /** Manual reordering in picker (low → high). */
  @Prop({ default: 0 })
  sortOrder!: number;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const TextBlockSchema = SchemaFactory.createForClass(TextBlock);

/**
 * Indexes (TZ-DOC-323: dropped the older {category, ...} pair).
 *  - `{ categoryId: 1, isActive: 1 }` — primary picker listing query
 *    (used by GET /api/text-blocks and the builder dropdown, TZ-DOC-317).
 *  - slug uniqueness is enforced via the Prop-level `unique: true` index.
 */
TextBlockSchema.index({ categoryId: 1, isActive: 1 });
