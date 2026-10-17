import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Per-line visual snapshot for KP blank (TZ-SALES-370). Not a shared TableTemplate. */
@Schema({ _id: false })
export class QuotationRowPresentation {
  @Prop({ enum: ['auto', 'compact', 'large'], default: 'auto' })
  density?: 'auto' | 'compact' | 'large';

  @Prop({ enum: ['normal', 'accent'], default: 'normal' })
  emphasis?: 'normal' | 'accent';

  @Prop({ default: false })
  separatorBefore?: boolean;

  @Prop({ default: false })
  pageBreakBefore?: boolean;

  /** When false, description stays stored but is hidden on the blank. Default true. */
  @Prop({ default: true })
  showDescription?: boolean;

  @Prop({ enum: ['inherit', 'contain', 'cover'], default: 'inherit' })
  photoFit?: 'inherit' | 'contain' | 'cover';
}

const QuotationRowPresentationSchema = SchemaFactory.createForClass(
  QuotationRowPresentation,
);

@Schema({ _id: false })
export class QuotationItem {
  /** catalog=Product FK; custom=no FK; module/material=refId → ProductModule/Material. */
  @Prop({
    enum: ['catalog', 'custom', 'module', 'material'],
    default: 'catalog',
  })
  lineKind!: 'catalog' | 'custom' | 'module' | 'material';

  /** Legacy + catalog lines: Product ObjectId. Absent for custom/module/material. */
  @Prop({ type: Types.ObjectId, ref: 'Product' })
  productId!: Types.ObjectId;

  /**
   * Typed catalog ref for module/material lines (SALES-348).
   * Populated in QuotationService by lineKind (ProductModule | Material).
   */
  @Prop({ type: Types.ObjectId })
  refId?: Types.ObjectId;

  @Prop()
  productName?: string;

  @Prop()
  description?: string;

  @Prop()
  productSku?: string;

  @Prop()
  photoUrl?: string;

  @Prop()
  sourceItemId?: string;

  /** Snapshot-first catalog edit intent; commercial fields never enter this metadata. */
  @Prop({ type: [String], enum: ['productName', 'description', 'productSku', 'unit'] })
  catalogDirtyFields?: Array<'productName' | 'description' | 'productSku' | 'unit'>;

  @Prop({ enum: ['pending', 'kp-only'] })
  catalogDecision?: 'pending' | 'kp-only';

  @Prop({ min: 0 })
  catalogSourceVersion?: number;

  @Prop({ required: true, default: 0 })
  quantity!: number;

  @Prop()
  unit?: string;

  @Prop({ required: true, default: 0 })
  unitPrice!: number;

  @Prop({ default: 0 })
  markupPercent!: number;

  @Prop({ default: 0, min: 0, max: 100 })
  discountPercent!: number;

  @Prop({ default: false })
  isOptional!: boolean;

  /** Visual-only row settings for live table / print / PDF. */
  @Prop({ type: QuotationRowPresentationSchema })
  rowPresentation?: QuotationRowPresentation;

  @Prop({ required: true, default: 0 })
  total!: number;

  @Prop({ default: 0 })
  sortOrder!: number;
}

const QuotationItemSchema = SchemaFactory.createForClass(QuotationItem);

@Schema({ _id: false })
export class QuotationSheetLayout {
  @Prop({ default: 0, min: 0, max: 200 })
  rowsFirstPage!: number;

  @Prop({ default: 0, min: 0, max: 200 })
  rowsNextPage!: number;

  @Prop({ default: 100, min: 10, max: 400 })
  photoScalePercent!: number;

  @Prop({ default: 0, min: 0, max: 100 })
  photoCropYPercent!: number;

  @Prop({ default: true })
  showPhotoColumn!: boolean;

  /** KP table body font size in px (TZ-SALES-373). Default 12; clamp 8–20. */
  @Prop({ default: 12, min: 8, max: 20 })
  tableFontSize!: number;

  /** KP table header font size in px (TZ-SALES-374). Default 12; clamp 8–20. */
  @Prop({ default: 12, min: 8, max: 20 })
  tableHeaderFontSize!: number;
}

const QuotationSheetLayoutSchema =
  SchemaFactory.createForClass(QuotationSheetLayout);

@Schema({ _id: false })
export class QuotationTerm {
  @Prop({ required: true, default: '' })
  text!: string;

  @Prop({ required: true, default: 0 })
  sortOrder!: number;
}

const QuotationTermSchema = SchemaFactory.createForClass(QuotationTerm);

/** Immutable payload captured when a quotation is frozen/sent (SALES-302). */
@Schema({ _id: false })
export class QuotationVersion {
  @Prop({ required: true })
  version!: number;

  @Prop({ required: true })
  frozenAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  frozenBy?: Types.ObjectId;

  @Prop({ type: Object, required: true })
  payload!: Record<string, unknown>;
}

const QuotationVersionSchema = SchemaFactory.createForClass(QuotationVersion);

export type QuotationStatus =
  'draft' | 'sent' | 'accepted' | 'rejected' | 'converted' | 'cancelled';
export type DiscountType = 'none' | 'percent' | 'amount';
/** D21 / SALES-303: solo = standalone; master = family root; variant = org clone. */
export type QuotationFamilyRole = 'solo' | 'master' | 'variant';
export type QuotationDocument = HydratedDocument<Quotation>;

@Schema({ collection: 'quotations', timestamps: true })
export class Quotation {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  /** Family role (default solo — existing docs stay valid without migration). */
  @Prop({
    enum: ['solo', 'master', 'variant'],
    default: 'solo',
    index: true,
  })
  familyRole!: QuotationFamilyRole;

  /** Set only on variant — points at the master quotation. */
  @Prop({ type: Types.ObjectId, ref: 'Quotation', index: true })
  masterId?: Types.ObjectId;

  /** Bumped on master when sync-from-master copies lines to variants. */
  @Prop({ required: true, default: 1 })
  familyVersion!: number;

  /** Per-KP org markup override (%). Default applied later from Organization. */
  @Prop({ default: undefined })
  orgMarkupPercent?: number;

  @Prop({ default: 20, min: 0, max: 100 })
  vatPercent!: number;

  @Prop({ default: 0, min: 0, max: 100 })
  prepaymentPercent!: number;

  @Prop({ default: 0, min: 0 })
  productionDays!: number;

  @Prop({ default: 0, min: 0 })
  deliveryDays!: number;

  /** Drafts may exist before the Create КП client picker is completed. */
  @Prop({ type: Types.ObjectId, ref: 'Counterparty', index: true })
  counterpartyId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Person', index: true })
  contactPersonId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Site', index: true })
  siteId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Tender', index: true })
  tenderId?: Types.ObjectId;

  @Prop()
  title?: string;

  @Prop({ required: true, default: () => new Date() })
  date!: Date;

  @Prop()
  validUntil?: Date;

  @Prop({ type: Types.ObjectId, ref: 'EntityStatus' })
  statusId?: Types.ObjectId;

  @Prop({
    enum: ['draft', 'sent', 'accepted', 'rejected', 'converted', 'cancelled'],
    default: 'draft',
    index: true,
  })
  status!: QuotationStatus;

  @Prop({ required: true, default: 0 })
  total!: number;

  @Prop({ enum: ['none', 'percent', 'amount'], default: 'none' })
  discountType!: DiscountType;

  @Prop({ default: 0 })
  discountPercent!: number;

  @Prop({ default: 0 })
  discountAmount!: number;

  @Prop()
  notes?: string;

  @Prop({ type: [QuotationTermSchema], default: [] })
  terms!: QuotationTerm[];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ index: true })
  deletedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'DocumentTemplate' })
  templateId?: Types.ObjectId;

  @Prop({ type: Object })
  designSnapshot?: Record<string, unknown>;

  @Prop({ type: Object })
  templateSnapshot?: Record<string, unknown>;

  @Prop({ type: QuotationSheetLayoutSchema, default: () => ({}) })
  sheetLayout!: QuotationSheetLayout;

  @Prop({ type: [QuotationItemSchema], default: [] })
  items!: QuotationItem[];

  /** Last immutable snapshot number; legacy quotations start at zero. */
  @Prop({ required: true, default: 0 })
  currentVersion!: number;

  /** Embedded snapshots are never edited by ordinary quotation PATCH calls. */
  @Prop({ type: [QuotationVersionSchema], default: [] })
  versions!: QuotationVersion[];

  @Prop()
  convertedContractId?: string;

  @Prop()
  convertedOrderId?: string;

  /**
   * TZ-ORDERS-306: КП-заглушка, созданная из прямого заказа (без цен менеджера).
   * Флаг нужен, чтобы такой черновик не выглядел в списке как настоящее КП,
   * которое кто-то посчитал и отправил клиенту.
   */
  @Prop({ default: false, index: true })
  isStub!: boolean;

  /** Заказ, из которого выросла заглушка (обратная связь к `Order.quotationId`). */
  @Prop({ type: Types.ObjectId, ref: 'Order', index: true, sparse: true })
  sourceOrderId?: Types.ObjectId;

  /** Linked studio document for KP lifecycle (TZ-NX-DOCSTUDIO-S20). */
  @Prop({ type: Types.ObjectId, ref: 'StudioDocument', index: true, sparse: true })
  studioDocumentId?: Types.ObjectId;
}

export const QuotationSchema = SchemaFactory.createForClass(Quotation);
QuotationSchema.index({ counterpartyId: 1, date: -1 });
QuotationSchema.index({ status: 1, date: -1 });
/** One variant per org inside a family (sparse: solo/master have no masterId). */
QuotationSchema.index(
  { masterId: 1, organizationId: 1 },
  { unique: true, sparse: true },
);
