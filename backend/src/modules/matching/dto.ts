import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsMongoId, IsOptional, ValidateIf, ValidateNested } from 'class-validator';

export class ConfirmMatchDto {
  @ApiProperty({ description: 'Позиция договора (incomes)' }) @IsMongoId() lineId!: string;
  @ApiProperty({ description: 'Изделие (products)' }) @IsMongoId() productId!: string;
}

export class NoneMatchDto {
  @ApiProperty({ description: 'Позиция договора, которая не является изделием' }) @IsMongoId() lineId!: string;
}

export class BulkMatchItemDto {
  @ApiProperty() @IsMongoId() lineId!: string;
  @ApiPropertyOptional({ description: 'Изделие; null — «не изделие»', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsMongoId() productId?: string | null;
}

export class BulkMatchDto {
  @ApiProperty({ type: [BulkMatchItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => BulkMatchItemDto) items!: BulkMatchItemDto[];
}
