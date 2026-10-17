import { IsIn } from 'class-validator';

export class UpdateStudioQuotationStatusDto {
  @IsIn(['draft', 'sent', 'accepted', 'rejected', 'converted', 'cancelled'])
  status!: 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted' | 'cancelled';
}
