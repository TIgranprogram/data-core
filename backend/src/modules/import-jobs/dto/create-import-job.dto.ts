import { IsIn, IsOptional, IsString } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateImportJobDto {
  @IsIn(['csv', 'excel', 'api'])
  sourceType!: 'csv' | 'excel' | 'api';

  @IsIn(['materials', 'products', 'counterparties', 'orders'])
  entityType!: 'materials' | 'products' | 'counterparties' | 'orders';

  @IsOptional() @IsString() sourceFile?: string;
  @IsOptional() @IsString() sourceUrl?: string;
  @IsOptional() sourceOptions?: Record<string, unknown>;
  @IsOptional() @IsObjectId() createdByUserId?: string;
}
