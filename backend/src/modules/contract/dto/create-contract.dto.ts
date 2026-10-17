import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

interface ContractAttachmentReferenceDto {
  attachmentFileId?: string;
  attachmentUrl?: string;
}

@ValidatorConstraint({ name: 'contractAttachmentReference', async: false })
class ContractAttachmentReferenceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value !== 'file_attached') return true;
    const dto = args.object as ContractAttachmentReferenceDto;
    return Boolean(dto.attachmentFileId?.trim() || dto.attachmentUrl?.trim());
  }

  defaultMessage(): string {
    return 'contractStatus=file_attached requires attachmentFileId or attachmentUrl';
  }
}

export class ContractItemDto {
  @ApiProperty({ description: 'ID продукта' })
  @IsObjectId()
  productId!: string;

  @ApiPropertyOptional({ description: 'Название продукта' })
  @IsOptional() @IsString() productName?: string;

  @ApiProperty({ description: 'Количество' })
  @IsNumber() @Min(0)
  quantity!: number;

  @ApiPropertyOptional({ description: 'Единица измерения' })
  @IsOptional() @IsString() unit?: string;

  @ApiProperty({ description: 'Цена за единицу' })
  @IsNumber() @Min(0)
  unitPrice!: number;
}

export class CreateContractDto {
  @ApiPropertyOptional({ description: 'Номер контракта' })
  @IsOptional() @IsString() number?: string;
  @ApiPropertyOptional({ description: 'Название контракта' })
  @IsOptional() @IsString() title?: string;

  @ApiPropertyOptional({ description: 'ID предложения' })
  @IsOptional() @IsObjectId() proposalId?: string;

  @ApiProperty({ description: 'ID организации' })
  @IsObjectId()
  organizationId!: string;

  @ApiProperty({ description: 'ID заказчика' })
  @IsObjectId()
  customerId!: string;

  @ApiPropertyOptional({
    enum: ['draft', 'sent', 'signed', 'active', 'completed', 'cancelled', 'expired'],
    description: 'Статус контракта',
  })
  @IsOptional()
  @IsIn(['draft', 'sent', 'signed', 'active', 'completed', 'cancelled', 'expired'])
  status?: 'draft' | 'sent' | 'signed' | 'active' | 'completed' | 'cancelled' | 'expired';

  @ApiPropertyOptional({
    enum: ['none', 'file_attached', 'generated'],
    description: 'Состояние файла договора; отдельно от lifecycle status',
    default: 'none',
  })
  @IsOptional()
  @IsIn(['none', 'file_attached', 'generated'])
  @Validate(ContractAttachmentReferenceConstraint)
  contractStatus?: 'none' | 'file_attached' | 'generated';

  @ApiPropertyOptional({ description: 'Идентификатор файла вложения' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  attachmentFileId?: string;

  @ApiPropertyOptional({ description: 'URL файла вложения' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  attachmentUrl?: string;

  @ApiPropertyOptional({ description: 'Заметки' })
  @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ description: 'Дата истечения (ISO)' })
  @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional({ description: 'Тег пакета' })
  @IsOptional() @IsString() packageTag?: string;

  @ApiProperty({ type: [ContractItemDto], description: 'Позиции контракта' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractItemDto)
  items!: ContractItemDto[];
}
