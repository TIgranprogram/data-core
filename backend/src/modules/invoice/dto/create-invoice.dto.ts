import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateInvoiceDto {
  @IsString() @IsNotEmpty() number!: string;
  @IsOptional() @IsIn(['incoming', 'outgoing']) type?: 'incoming' | 'outgoing';
  @IsObjectId() supplierId!: string;
  @IsOptional() @IsObjectId() purchaseOrderId?: string;
  @IsNumber() @Min(0) totalAmount!: number;
  @IsDateString() invoiceDate!: string;
  @IsDateString() dueDate!: string;
  @IsOptional()
  @IsIn(['draft', 'received', 'paid', 'overdue', 'cancelled'])
  status?: 'draft' | 'received' | 'paid' | 'overdue' | 'cancelled';
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsString() notes?: string;
}
