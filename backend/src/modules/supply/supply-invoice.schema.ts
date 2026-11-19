import type { ClassificationMetadata } from '../../common/financial-classification';
import { INVOICE_CURRENCIES } from './invoice-financials';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplyInvoiceDocument = HydratedDocument<SupplyInvoice>;
export type SupplyInvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export type SupplyInvoicePaymentLine = {
  requestId: Types.ObjectId;
  lineAmount: number;
  qty: number;
  companyId?: Types.ObjectId;
  categoryId?: Types.ObjectId;
  supplierId?: Types.ObjectId;
  supplierName?: string;
  salesOrderId?: Types.ObjectId;
  costCenter?: string;
  title?: string;
  num?: number | string;
  invoiceNo?: string;
};

export type SupplyInvoicePaymentSnapshot = {
  amount: number;
  paidAt: Date;
  paidBy?: Types.ObjectId;
  lines: SupplyInvoicePaymentLine[];
};

export type SupplyInvoicePaymentAdjustment = {
  at: Date;
  by?: Types.ObjectId;
  reason: string;
  operation: 'line_edit' | 'lines_added' | 'line_removed' | 'payment_reversed';
  beforeAmount: number;
  afterAmount: number;
  delta: number;
  requestIds: Types.ObjectId[];
};

/**
 * Счёт поставщика (`supplyinvoices`) — только data-core, CRM коллекцию не знает.
 * Строки счёта — заявки с `invoiceId`; `invoiceNo/invoiceDate/paid/paidAt/companyId` в заявках — копия, её пишет сервер.
 */
@Schema({ collection: 'supplyinvoices', timestamps: true })
export class SupplyInvoice {
  /** Метаданные классификации старых фактов, без изменения paymentSnapshot. */
  @Prop({ type: Object }) legacyClassifications?: Record<string, ClassificationMetadata>;

  /** Новые реквизиты документа не меняют рублёвую семантику amount/priceHint. */
  @Prop({ enum: INVOICE_CURRENCIES }) currency?: string;
  @Prop({ maxlength: 100 }) currencyName?: string;
  @Prop({ min: 0 }) exchangeRate?: number;
  @Prop() exchangeRateDate?: string;
  @Prop({ maxlength: 300 }) exchangeRateSource?: string;
  @Prop({ min: 0, type: Number }) confirmedAmountRub?: number | null;
  @Prop({ maxlength: 1000 }) conversionNote?: string;
  @Prop({ enum: ['included', 'excluded', 'none', 'mixed'] }) vatMode?: string;
  @Prop({ type: Number }) vatRate?: number | null;
  @Prop({ type: Number }) declaredVatAmount?: number | null;
  @Prop({ type: Object }) financialLines?: Record<string, unknown>;
  @Prop({ type: Number, index: true }) paymentAccountingVersion?: number;
  @Prop({ min: 0 }) paidAmount?: number;
  @Prop({ min: 0 }) sourcePaidAmount?: number;

  @Prop({ trim: true })
  no?: string;

  @Prop({ type: Date })
  date?: Date;

  @Prop({ type: Date })
  deliveryDate?: Date;

  @Prop({ trim: true, maxlength: 1000 })
  note?: string;

  @Prop({ min: 0 })
  amount?: number;

  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true })
  supplierId?: Types.ObjectId;

  @Prop({ trim: true })
  supplierName?: string;

  /** Договор поставщика (suppliercontracts); тот же поставщик, что у счёта. */
  @Prop({ type: Types.ObjectId, ref: 'SupplierContract', index: true })
  contractId?: Types.ObjectId;

  /** Кто платит — наша компания. */
  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  payerCompanyId?: Types.ObjectId;

  /** Файл счёта (photos). */
  @Prop({ type: [Types.ObjectId], default: [] })
  fileIds!: Types.ObjectId[];

  @Prop({ enum: ['draft', 'issued', 'paid', 'cancelled'], default: 'draft', index: true })
  status!: SupplyInvoiceStatus;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  /** Счёт, в который этот склеен (дубль № у поставщика); сам удалён мягко. */
  @Prop({ type: Types.ObjectId })
  mergedInto?: Types.ObjectId;

  /** Осознанный дубль номера: у поставщика уже есть счёт, но этот создан отдельно — с причиной. */
  @Prop({ type: Types.ObjectId })
  duplicateOf?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 200 })
  duplicateReason?: string;

  /** Версия для оптимистичной блокировки финансовых правок. */
  @Prop({ default: 0 })
  version!: number;

  /** Монотонная граница первой приёмки; пишется в транзакции stock movement. */
  @Prop({ type: Date, default: null })
  receiptBoundaryAt?: Date | null;

  /** Фактическая сумма/строки на момент оплаты; не меняется при последующих правках заявки. */
  @Prop({ type: Object })
  paymentSnapshot?: SupplyInvoicePaymentSnapshot;

  /** Аудит изменений состава/суммы после оплаты до первой приёмки. */
  @Prop({ type: [Object], default: [] })
  paymentAdjustments!: SupplyInvoicePaymentAdjustment[];

  /** Журнал явных объединений: кто, когда, откуда, стратегия, сколько строк переехало. */
  @Prop({ type: [Object], default: [] })
  mergeLog!: Array<{ at: Date; by?: Types.ObjectId; fromId: Types.ObjectId; strategy: string; moved: number; skipped: number; replaced?: number }>;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const SupplyInvoiceSchema = SchemaFactory.createForClass(SupplyInvoice);

// C158: отбор текущих обязательств по компании/статусу/дате без полной истории.
SupplyInvoiceSchema.index({ payerCompanyId: 1, status: 1, date: 1, deletedAt: 1 });
SupplyInvoiceSchema.index({ status: 1, 'paymentSnapshot.paidAt': 1, payerCompanyId: 1 });
