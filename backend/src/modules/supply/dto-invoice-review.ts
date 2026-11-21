import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsInt, IsOptional, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { IsINN } from '../../common/validators/inn.validator';
import { SupplyInvoiceIntakeDto } from './dto-invoice-intake';

// Прокси ограничивает весь запрос 16 МиБ. Оставляем запас для multipart.
export const REVIEW_PDF_MAX_BYTES = 15 * 1024 * 1024;

export class ReviewInvoiceFacts extends OmitType(SupplyInvoiceIntakeDto, ['uid', 'fileId', 'sourceSha256'] as const) {
  @ApiProperty() @IsINN() supplierInn!: string;
  @ApiProperty() @IsINN() payerInn!: string;
}

export class InvoiceDraftId {
  @ApiProperty() @IsUUID() draftId!: string;
}

export class InvoiceReviewDto extends InvoiceDraftId {
  @ApiProperty() @IsUUID() requestId!: string;
  @ApiProperty() @IsUUID() batchId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() withdraw?: boolean;
  @ApiProperty() @IsInt() @Min(0) @Max(199) expectedRevision!: number;
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) sourceSha256!: string;
  @ApiProperty({ minimum: 5, maximum: REVIEW_PDF_MAX_BYTES })
  @IsInt() @Min(5) @Max(REVIEW_PDF_MAX_BYTES, { message: 'Размер PDF для отправки — до 15 МиБ' })
  sourceSize!: number;
  /** Хеш локального снимка полей и доказательств. Полный текст остаётся на ПК. */
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) evidenceSummary!: string;
  @ApiProperty({ type: ReviewInvoiceFacts }) @IsDefined() @ValidateNested() @Type(() => ReviewInvoiceFacts) facts!: ReviewInvoiceFacts;
}

export class InvoiceReviewVersion extends InvoiceDraftId {
  @ApiProperty() @IsInt() @Min(1) @Max(200) revision!: number;
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) payloadHash!: string;
}

export class InvoiceReviewResult extends InvoiceReviewVersion {
  @ApiProperty({ enum: ['validated','committing','committed','question'] }) state!: string;
  @ApiProperty({ required: false }) reason?: string;
}

export class InvoicePreparedResult extends InvoiceReviewVersion {
  @ApiProperty() ticket!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
}

export class InvoiceCommitQuery extends InvoiceDraftId {
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) ticket!: string;
}
