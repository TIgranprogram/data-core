import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplierContractDocument = HydratedDocument<SupplierContract>;
export type SupplierContractStatus = 'active' | 'closed';

/**
 * Договор поставщика (`suppliercontracts`) — только data-core, CRM коллекцию не знает.
 * Не путать с `salesorders.contractNo` (договоры покупателей, текстом). Счёт ссылается через `supplyinvoices.contractId`.
 */
@Schema({ collection: 'suppliercontracts', timestamps: true })
export class SupplierContract {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  supplierId!: Types.ObjectId;

  /** Снимок названия поставщика на момент создания. */
  @Prop({ trim: true })
  supplierName?: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  no!: string;

  @Prop({ type: Date, required: true })
  date!: Date;

  @Prop({ trim: true, maxlength: 300 })
  subject?: string;

  @Prop({ type: Date })
  validTo?: Date;

  /** Справочно; остаток не контролируется. */
  @Prop({ min: 0 })
  amount?: number;

  /** Файлы договора (photos). */
  @Prop({ type: [Types.ObjectId], default: [] })
  fileIds!: Types.ObjectId[];

  @Prop({ enum: ['active', 'closed'], default: 'active', index: true })
  status!: SupplierContractStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const SupplierContractSchema = SchemaFactory.createForClass(SupplierContract);
SupplierContractSchema.index({ supplierId: 1, deletedAt: 1 });
SupplierContractSchema.index({ supplierId: 1, no: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
