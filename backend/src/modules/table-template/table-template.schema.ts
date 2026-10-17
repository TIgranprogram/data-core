import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * TZ-86 Phase A.2 — TableTemplate extension.
 *
 * Existing (kppdf-7.0 schema) gets ADDITIVE fields without breaking existing
 * data. Migration-safe: new `type` ColumnType has `default: 'text'` so old
 * rows without field still read back; sampleRows/category/sortOrder are
 * optional. Soft-delete via project plugin (autofilter `deletedAt: null`).
 *
 * Cross-ref to `DocumentTableType` (meta-classifier) NOT FK-linked here:
 * the two entities serve different roles — DocumentTableType = branch-level
 * shape taxonomy (dataSource/productKind), TableTemplate = user-saved
 * column presets. Future TZ-87 might add `extends[]` references.
 *
 * Distinct from `TemplateBlock` (atomic canvas block) — TemplateBlock stores
 * an INSTANCE in the document; TableTemplate is the REUSABLE PRESET the user
 * pulls into a TemplateBlock's settings.
 */

/** TZ-86 A.2 — Cell render hint. Backend preview uses for Intl.NumberFormat. */
export type ColumnType = 'text' | 'number' | 'date' | 'currency' | 'bool';

export const COLUMN_TYPES: ColumnType[] = [
  'text',
  'number',
  'date',
  'currency',
  'bool',
];

/** TZ-86 A.2 — Picker grouping. Legacy data без category → undefined (default). */
export type TableTemplateCategory =
  | 'product-spec'
  | 'cost-calc'
  | 'order-summary'
  | 'price-list'
  | 'custom'
  | 'kp';

export const TABLE_TEMPLATE_CATEGORIES: TableTemplateCategory[] = [
  'product-spec',
  'cost-calc',
  'order-summary',
  'price-list',
  'custom',
  'kp',
];

/** Canonical KP line-item preset shared by the table seed and Create КП bind. */
export const KP_LINE_ITEM_COLUMNS: ReadonlyArray<{
  key: string;
  label: string;
  type: ColumnType;
  width: number;
  align: 'left' | 'center' | 'right';
}> = [
  { key: 'index', label: '№', type: 'number', width: 56, align: 'center' },
  { key: 'productName', label: 'Наименование', type: 'text', width: 260, align: 'left' },
  { key: 'quantity', label: 'Кол-во', type: 'number', width: 88, align: 'right' },
  { key: 'unit', label: 'Ед.', type: 'text', width: 72, align: 'center' },
  { key: 'unitPrice', label: 'Цена', type: 'currency', width: 120, align: 'right' },
  { key: 'sum', label: 'Сумма', type: 'currency', width: 128, align: 'right' },
];

export const KP_LINE_ITEM_PRESET_NAME = 'КП — позиции';

@Schema({ _id: false })
export class TableColumn {
  @Prop({ required: true })
  key!: string;

  @Prop({ required: true })
  label!: string;

  /**
   * TZ-86 A.2 — render hint. Default 'text' makes the additive migration
   * safe: existing rows (kppdf-7.0) without this field read back as 'text'.
   */
  @Prop({ type: String, enum: COLUMN_TYPES, default: 'text' })
  type!: ColumnType;

  @Prop({ default: 100 })
  width!: number;

  @Prop({ enum: ['left', 'center', 'right'], default: 'left' })
  align!: 'left' | 'center' | 'right';

  /** Optional formatter override (e.g. '#,##0.00' for numbers). Backend applies on preview. */
  @Prop()
  format?: string;
}

const TableColumnSchema = SchemaFactory.createForClass(TableColumn);

export type TableTemplateDocument = HydratedDocument<TableTemplate>;

@Schema({ collection: 'table_templates', timestamps: true })
export class TableTemplate {
  @Prop({ required: true, index: true })
  name!: string;

  @Prop()
  description?: string;

  /**
   * TZ-86 A.2 — picker grouping. Picker UI shows «Спецификации товаров» /
   * «Калькуляции» / «Заказы» / «Прайс-листы» / «Прочее». Optional to keep
   * migration safe (legacy rows without category remain visible under «Прочее»).
   */
  @Prop({
    type: String,
    enum: TABLE_TEMPLATE_CATEGORIES,
    index: true,
  })
  category?: TableTemplateCategory;

  /** TZ-86 A.2 — picker listing order (low → high). */
  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop({ type: [TableColumnSchema], default: [] })
  columns!: TableColumn[];

  /**
   * TZ-86 A.2 — sample rows used by GET /api/table-templates/:id/preview
   * for live HTML render. Ordered-array matches column order. Optional —
   * preview gracefully shows empty-state message when absent.
   *
   * Stored as `unknown[][]` (typed-soft) because cells are heterogeneous
   * (number / Date / string / boolean) and Mongoose cannot strongly-type
   * mixed cells. Frontend ColumnDef-driven type narrowing in Phase C.2.
   */
  @Prop({ type: [[Object]], default: undefined })
  sampleRows?: unknown[][];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /**
   * TZ-86 A.5 — frontend picker pins to a registry-resolved dataSource.
   * Not FK: free-form label that drives how TemplateBlock.dataBinding resolves.
   * Phase A.5 RegistryController exposes these labels as the picker options.
   */
  @Prop({ index: true })
  dataSource?: string;
}

export const TableTemplateSchema = SchemaFactory.createForClass(TableTemplate);

/**
 * Compound indexes matching picker listing queries:
 *  - (category, sortOrder) → primary picker query (TZ-86C.2 / TZ-86D.3 tab 3).
 *  - (category, isActive) → fast active-only filter.
 *  - (dataSource, isActive) → registry-driven lookup (TZ-86D.3 tab "Данные").
 */
TableTemplateSchema.index({ category: 1, sortOrder: 1 });
TableTemplateSchema.index({ category: 1, isActive: 1 });
TableTemplateSchema.index({ dataSource: 1, isActive: 1 });
