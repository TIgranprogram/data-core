import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BLANK_A4_SENTINEL_TAG } from './blank-a4-template.constants';

export type DocumentTemplateDocument = HydratedDocument<DocumentTemplate>;

@Schema({ collection: 'document_templates', timestamps: true })
export class DocumentTemplate {
  @Prop({ required: true, index: true })
  name!: string;

  @Prop()
  description?: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'DocType', required: true, index: true })
  docTypeId!: Types.ObjectId;

  /**
   * TZ-DOC-307 — document-template category (FK → DocumentTemplateCategory).
   *
   * Optional on the persisted model for READ compatibility with legacy
   * templates created before categories existed. New templates always
   * receive a category SERVER-SIDE: either the caller-provided
   * `categoryId` (validated active + same org scope) or the active default
   * category resolved by DocumentTemplateCategoryService. Dangling / cross-org
   * references are rejected, and a referenced category cannot be deleted.
   */
  @Prop({ type: Types.ObjectId, ref: 'DocumentTemplateCategory', index: true })
  categoryId?: Types.ObjectId;

  @Prop({ default: false, index: true })
  isDefault!: boolean;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ enum: ['A3', 'A4', 'A5'], default: 'A4' })
  pageSize!: string;

  @Prop({ type: [String], default: [] })
  backgroundImage!: string[];

  @Prop({ default: -1 })
  defaultBackgroundIndex!: number;

  @Prop({ default: 0.3 })
  backgroundOpacity!: number;

  @Prop({ enum: ['portrait', 'landscape'], default: 'portrait' })
  orientation!: 'portrait' | 'landscape';

  @Prop({ default: false })
  pageNumbering?: boolean;

  @Prop({ default: false })
  tableOfContents?: boolean;

  @Prop({ default: '' })
  headerText?: string;

  @Prop({ default: '' })
  footerText?: string;

  @Prop({ default: 1 })
  version!: number;

  @Prop({
    type: {
      rowsFirstPage: { type: Number, default: 0, min: 0, max: 200 },
      rowsNextPage: { type: Number, default: 0, min: 0, max: 200 },
    },
    default: { rowsFirstPage: 0, rowsNextPage: 0 },
  })
  defaultSheetLayout?: {
    rowsFirstPage?: number;
    rowsNextPage?: number;
  };

  @Prop()
  notes?: string;

  /**
   * TZ-KP-WS-406 — optional reference to the source file (path/URL token)
   * that produced this template via the Desktop MCP bridge. Stored for
   * traceability; file content is NOT auto-converted to blocks (known
   * limitation — human finishes the draft in the builder).
   */
  @Prop()
  sourceFileRef?: string;

  /**
   * TZ-KP-WS-406 — origin of the draft: 'mcp' (Desktop agent), 'import'
   * (non-MCP upload), 'manual' (regular builder/workspace creation).
   * Defaults to null for backward compatibility with legacy rows.
   */
  @Prop({ type: String, enum: ['mcp', 'manual', 'import'], default: null })
  draftSource?: 'mcp' | 'manual' | 'import';

  /**
   * TZ-251 §ШАГ 1 — Object-level ownership (IDOR).
   *
   * Optional ObjectId of the user who created the template. New templates
   * (created via `POST /api/document-templates`) populate this from
   * `req.user.id`. Existing legacy templates without `createdBy` fall back
   * to RBAC-only authorization (the `OwnershipGuard` ladder treats
   * undefined owner as "defer to roles" — see `OwnershipGuard` Step 7).
   *
   * Index added on `createdBy` because future guards (TZ-255
   * server-side permissions) will need it for `find({ createdBy: userId })`
   * filters.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  createdBy?: Types.ObjectId;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const DocumentTemplateSchema = SchemaFactory.createForClass(DocumentTemplate);
DocumentTemplateSchema.index({ organizationId: 1, docTypeId: 1, isDefault: 1 });

/**
 * TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM — at most one live (non-deleted)
 * `system-sentinel-blank-a4` template per org going forward. Only enforced
 * where Mongoose `autoIndex` runs (dev; disabled in prod per
 * `database.module.ts`) — the real defense against duplicates is
 * `DocumentTemplateService.ensureBlankA4Sentinel`'s own find-and-dedupe
 * logic, which self-heals regardless of index enforcement. If a live DB
 * already has duplicate sentinels from before this TZ, run the migration
 * `database/migrations/2026-09-12-*-dedup-sentinels.ts` first so this index
 * builds cleanly.
 */
DocumentTemplateSchema.index(
  { organizationId: 1, tags: 1 },
  {
    unique: true,
    partialFilterExpression: { tags: BLANK_A4_SENTINEL_TAG, deletedAt: null },
    name: 'blank_a4_sentinel_unique',
  },
);
