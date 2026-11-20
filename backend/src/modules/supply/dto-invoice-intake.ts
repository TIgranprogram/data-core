import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsMongoId, IsNumber,
  IsString, Length, Matches, Min, ValidateIf, ValidateNested,
} from 'class-validator';

const intakeUidPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const taxModes = ['included', 'excluded', 'none'] as const;
export type SupplyIntakeVatMode = (typeof taxModes)[number];

export class SupplyInvoiceIntakeParamDto {
  @ApiProperty({ pattern: intakeUidPattern.source })
  @Matches(intakeUidPattern, { message: 'Некорректный ключ загрузки счёта' })
  uid!: string;
}

export class SupplyInvoiceIntakeLineDto {
  @ApiProperty() @IsString() @Length(1, 100) rowKey!: string;
  @ApiProperty() @IsString() @Length(1, 500) title!: string;
  @ApiProperty() @IsNumber() @Min(0) qty!: number;
  @ApiProperty() @IsString() @Length(1, 50) unit!: string;
  @ApiProperty() @IsNumber() @Min(0) unitPrice!: number;
  @ApiProperty() @IsNumber() @Min(0) amount!: number;
}

export class SupplyInvoiceIntakeDto extends SupplyInvoiceIntakeParamDto {
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' }) @Matches(/^[a-f0-9]{64}$/) sourceSha256!: string;
  @ApiProperty() @IsMongoId() fileId!: string;
  @ApiProperty() @IsMongoId() supplierId!: string;
  @ApiProperty() @IsMongoId() payerCompanyId!: string;
  @ApiProperty() @IsString() @Length(1, 200) no!: string;
  @ApiProperty({ format: 'date' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiProperty({ enum: ['RUB'] }) @IsIn(['RUB']) currency!: 'RUB';
  @ApiProperty() @IsNumber() @Min(0) gross!: number;
  @ApiProperty({ enum: taxModes }) @IsIn(taxModes) vatMode!: SupplyIntakeVatMode;
  @ApiPropertyOptional() @ValidateIf((_dto, value) => value !== undefined) @IsIn([0, 5, 7, 10, 20, 22]) vatRate?: number;
  @ApiPropertyOptional() @ValidateIf((_dto, value) => value !== undefined) @IsNumber() @Min(0) vatAmount?: number;

  @ApiProperty({ type: [SupplyInvoiceIntakeLineDto], minItems: 1, maxItems: 500 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true })
  @Type(() => SupplyInvoiceIntakeLineDto)
  lines!: SupplyInvoiceIntakeLineDto[];
}

export class SupplyInvoiceIntakeReceiptDto {
  @ApiProperty() uid!: string;
  @ApiProperty() sourceSha256!: string;
  @ApiProperty() invoiceId!: string;
  @ApiProperty({ type: [String] }) requestIds!: string[];
  @ApiProperty() payloadHash!: string;
}
