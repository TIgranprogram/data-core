import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplyInvoiceDocument = HydratedDocument<SupplyInvoice>;
export type SupplyInvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

/**
 * Счёт поставщика (`supplyinvoices`) — только data-core, CRM коллекцию не знает.
 * Строки счёта — заявки с `invoiceId`; `invoiceNo/invoiceDate/paid/paidAt/companyId` в заявках — копия, её пишет сервер.
 */
@Schema({ collection: 'supplyinvoices', timestamps: true })
export class SupplyInvoice {
  @Prop({ trim: true })
  no?: string;

  @Prop({ type: Date })
  date?: Date;

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

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const SupplyInvoiceSchema = SchemaFactory.createForClass(SupplyInvoice);
