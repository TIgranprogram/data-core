import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { BlockLayout, BlockSource } from './template-block-layout';
import { BlockStyle, BlockStyleSchema } from './block-style';

export type BlockType = 'header' | 'text' | 'table' | 'image' | 'signature' | 'spacer';

/** TZ-DOC-STUDIO-201a — polymorphic parent for template builder vs studio document. */
export type TemplateBlockParentType = 'template' | 'studio-document';

/**
 * TZ-86 Phase A.3 — DataBinding subdoc.
 *
 * Optional binding for live data resolution at render time. Source specifies
 * which entity to look up; field is the canonical attribute name on that
 * entity (e.g. 'name' / 'inn' / 'address' / 'legalAddress'); value only applies
 * when `source === 'static'` (literal text) — used for inline placeholders.
 *
 * `_id: false` because subdocs in Mongoose auto-generate _id by default —
 * we don't need it here since a TemplateBlock can hold at most one binding.
 */
export type DataBindingSource =
  | 'organization'
  | 'counterparty'
  | 'product'
  | 'material'
  | 'work-type'
  | 'order'
  | 'contract'
  | 'quotation'
  | 'invoice'
  | 'cost-calculation'
  | 'static';

export type DataBindingFormat = 'text' | 'date' | 'currency' | 'number';

@Schema({ softDelete: false,  _id: false })
export class DataBinding {
  @Prop({
    type: String,
    enum: [
      'organization',
      'counterparty',
      'product',
      'material',
      'work-type',
      'order',
      'contract',
      'quotation',
      'invoice',
      'cost-calculation',
      'static',
    ],
    required: true,
  })
  source!: DataBindingSource;

  /** Canonical attribute name on the source entity (e.g. 'name', 'inn'). */
  @Prop()
  field?: string;

  /** Literal value — only meaningful when source === 'static'. */
  @Prop()
  value?: string;

  /** Rendering hint for the frontend; null/max-length display logic. */
  @Prop({ type: String, enum: ['text', 'date', 'currency', 'number'] })
  format?: DataBindingFormat;
}

export const DataBindingSchema = SchemaFactory.createForClass(DataBinding);

/**
 * TZ-104.6 carry-over on TemplateBlock — multi-column TipTap cell.
 *
 * Mirrors the `TextBlockColumn` shape used by the text-block editor
 * (`/api/text-blocks`). One cell = one column in the grid view on the
 * builder canvas. `width` is a 0..1 normalized ratio (front-end scales
 * to whatever document layout is used); `id` is a stable UUID used by
 * Angular `track` and by the canvas-grid ordering when re-rendering.
 *
 * Stored as a top-level subdoc array on TemplateBlock so the canvas
 * renderer (`block-renderer.component.ts`) can render a true CSS-grid
 * preview without collapsing to a flat `content` string. The denormalized
 * `columns` lives in coordination with `settings.textBlockId` for
 * round-tripping back to the source text-block.
 *
 * `_id: false` — like `DataBinding`, we don't need a Mongoose subdoc _id.
 */
@Schema({ softDelete: false,  _id: false })
export class TemplateBlockColumn {
  /** UUID-shaped stable id (matches TextBlockColumn.id on the front-end). */
  @Prop({ required: true })
  id!: string;

  /** TipTap HTML string for the cell. Sanitized on render via [innerHTML]. */
  @Prop({ default: '' })
  content!: string;

  /**
   * 0..1 normalized width ratio. NOT required — the canvas preview uses
   * uniform 1fr cells; the DTO marks it optional; downstream generator
   * can fall back to linear interpolation when missing. Schema default `1`
   * is enforced only if the field is absent at the subdoc level, but
   * Mongoose subdoc defaults on nested arrays don't always apply when
   * the inner object is persisted verbatim, hence the optional+default
   * combination on `CreateTemplateBlockDto` is the source of truth.
   */
  @Prop({ type: Number, default: 1 })
  width?: number;

  @Prop({ type: Number, default: 14 })
  fontSize?: number;
}

export const TemplateBlockColumnSchema = SchemaFactory.createForClass(TemplateBlockColumn);

export type TemplateBlockDocument = HydratedDocument<TemplateBlock>;

@Schema({ softDelete: false,  collection: 'template_blocks', timestamps: true })
export class TemplateBlock {
  @Prop({ type: Types.ObjectId, ref: 'DocumentTemplate', required: true, index: true })
  templateId!: Types.ObjectId;

  /** TZ-DOC-STUDIO-201a — canonical parent kind; backfilled to `template` for legacy rows. */
  @Prop({ type: String, enum: ['template', 'studio-document'] })
  parentType?: TemplateBlockParentType;

  /** TZ-DOC-STUDIO-201a — ObjectId of DocumentTemplate or StudioDocument. */
  @Prop({ type: Types.ObjectId })
  parentId?: Types.ObjectId;

  @Prop({ enum: ['header', 'text', 'table', 'image', 'signature', 'spacer'], required: true })
  type!: BlockType;

  @Prop({ required: true, default: 0 })
  order!: number;

  @Prop()
  title?: string;

  @Prop()
  content?: string;

  @Prop({ type: BlockStyleSchema })
  style?: BlockStyle;

  /**
   * TZ-104.6 carry-over at TemplateBlock level. Mirrors
   * `TextBlock.columns[]`; the builder canvas renders this array as a
   * CSS grid when present and length > 1. Falls back to flat `content`
   * when empty. Persisted here to support true visual fidelity on the
   * canvas (not just collapsed text) without going through a lookup.
   */
  @Prop({ type: [TemplateBlockColumnSchema], default: undefined })
  columns?: TemplateBlockColumn[];

  @Prop()
  height?: number;

  @Prop({ default: false })
  showLine!: boolean;

  @Prop({ type: Object })
  settings?: Record<string, unknown>;

  /** Canonical normalized page geometry introduced by TZ-259.A. */
  @Prop({ type: Object })
  layout?: BlockLayout;

  /** Canonical source reference; legacy blocks may omit this field. */
  @Prop({ type: Object })
  source?: BlockSource;

  /**
   * Persistent editor group membership (flat groups). Same UUID on N blocks
   * means they select/move together until explicitly ungrouped.
   */
  @Prop({ type: String, default: null, index: true })
  groupId?: string | null;

  /**
   * Geometry lock — when true the block cannot be moved, resized, or deleted
   * on the builder canvas until unlocked in the inspector.
   */
  @Prop({ default: false })
  locked!: boolean;

  /**
   * TZ-86 Phase A.3 — Optional live-data binding. Absent for static-template
   * blocks (Phase D canvas treats null binding as «render literal content»).
   */
  @Prop({ type: DataBindingSchema })
  dataBinding?: DataBinding;

  @Prop({ default: true })
  isActive!: boolean;
}

export const TemplateBlockSchema = SchemaFactory.createForClass(TemplateBlock);
TemplateBlockSchema.index({ templateId: 1, order: 1 });
TemplateBlockSchema.index({ parentType: 1, parentId: 1, order: 1 });
