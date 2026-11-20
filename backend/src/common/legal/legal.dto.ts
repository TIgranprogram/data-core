import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDefined, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
export const REVIEW_FIELDS = ['objectAddress', 'productionOrder', 'counterparty', 'signature', 'payment', 'deliveryTerms', 'deadlineTerms', 'drawing', 'catalogMatch', 'signedDate', 'paymentVerification', 'paymentPlan', 'productionAssignment', 'productMatching', 'other'] as const;
export class PartySnapshotDto {
 @ApiProperty() @IsString() @Length(1,500) name!: string;
 @ApiPropertyOptional() @IsOptional() @Matches(/^(\d{10}|\d{12})$/) inn?: string;
 @ApiPropertyOptional() @IsOptional() @Matches(/^\d{9}$/) kpp?: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,1000) address?: string;
}
export class LegalDocumentDto {
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) at?: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) by?: string;

 @ApiProperty() @IsString() @Length(1,100) uid!: string;
 @ApiProperty() @IsIn(['contract','customer_invoice','offer','specification','addendum','payment_evidence','acceptance']) kind!: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) number?: string;
 @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
 @ApiProperty() @IsString() @Length(1,50) revision!: string;
 @ApiProperty() @IsMongoId() fileId!: string;
 @ApiProperty() @Matches(/^[a-f0-9]{64}$/) sourceSha256!: string;
 @ApiPropertyOptional() @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) gross?: number;
 @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) vatRate?: number;
 @ApiPropertyOptional() @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) vatAmount?: number;
 @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,100) supersedesUid?: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,1000) reason?: string;
 @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(300) @IsString({each:true}) lineRefs?: string[];
}
export class ReviewIssueDto {
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) resolvedAt?: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) resolvedBy?: string;

 @ApiProperty() @IsString() @Length(1,100) uid!: string;
 @ApiProperty() @IsIn(REVIEW_FIELDS) field!: string;
 @ApiProperty() @IsString() @Length(1,200) label!: string;
 @ApiProperty() @IsString() @Length(1,1000) reason!: string;
 @ApiProperty() @IsIn(['unknown','conflict','not_applicable','resolved']) state!: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,100) documentUid?: string;
 @ApiPropertyOptional() @IsOptional() @IsMongoId() responsibleId?: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,1000) resolution?: string;
}
export class PaymentStageDto {
 @ApiProperty() @IsString() @Length(1,100) uid!: string;
 @ApiProperty() @IsString() @Length(1,200) label!: string;
 @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) percent?: number;
 @ApiPropertyOptional() @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) amount?: number;
 @ApiProperty() @Matches(/^[A-Z]{3}$/) currency!: string;
 @ApiProperty() @IsIn(['signed','advance_received','installation_completed','acceptance','fixed']) event!: string;
 @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) offsetDays?: number;
 @ApiPropertyOptional() @IsOptional() @IsIn(['calendar','business']) dayType?: string;
 @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string|null;
 @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) eventDate?: string|null;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,100) evidenceDocumentUid?: string;
}
export class SignatureDto {
 @ApiProperty() @IsIn(['unknown','seller_only','both','not_applicable']) state!: string;
 @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) signedDate?: string|null;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,100) evidenceDocumentUid?: string;
}
export class LegalOriginDto {
 @ApiProperty() @IsIn(['source_import','manual']) kind!: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,100) sourceBatchUid?: string;
}
export class LegalBundleDto {
 @ApiProperty() @IsIn(['draft','verified']) state!: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) sourceNumber?: string;
 @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) sourceDate?: string;
 @ApiProperty() @Matches(/^[A-Z]{3}$/) currency!: string;
 @ApiPropertyOptional() @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) gross?: number;
 @ApiPropertyOptional() @IsOptional() @IsIn(['included','excluded','none']) vatMode?: string;
 @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) vatRate?: number;
 @ApiPropertyOptional() @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) vatAmount?: number;
 @ApiPropertyOptional({type:PartySnapshotDto}) @IsOptional() @ValidateNested() @Type(()=>PartySnapshotDto) companySnapshot?: PartySnapshotDto;
 @ApiPropertyOptional({type:PartySnapshotDto}) @IsOptional() @ValidateNested() @Type(()=>PartySnapshotDto) counterpartySnapshot?: PartySnapshotDto;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,1000) objectAddress?: string|null;
 @ApiProperty({type:SignatureDto}) @IsDefined() @ValidateNested() @Type(()=>SignatureDto) signature!: SignatureDto;
 @ApiProperty() @IsIn(['unknown','confirmed']) paymentVerification!: string;
 @ApiProperty({type:[LegalDocumentDto]}) @IsArray() @ArrayMaxSize(30) @ValidateNested({each:true}) @Type(()=>LegalDocumentDto) documents!: LegalDocumentDto[];
 @ApiProperty({type:[ReviewIssueDto]}) @IsArray() @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>ReviewIssueDto) issues!: ReviewIssueDto[];
 @ApiProperty({type:[PaymentStageDto]}) @IsArray() @ArrayMaxSize(20) @ValidateNested({each:true}) @Type(()=>PaymentStageDto) paymentPlan!: PaymentStageDto[];
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,4000) deliveryTerms?: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,4000) deadlineTerms?: string;
 @ApiPropertyOptional({type:LegalOriginDto}) @IsOptional() @ValidateNested() @Type(()=>LegalOriginDto) origin?: LegalOriginDto;
}
export class LegalPatchDto {
 @ApiProperty() @IsInt() @Min(0) version!: number;
 @ApiProperty() @IsString() @Length(1,100) clientUid!: string;
 @ApiProperty() @IsString() @Length(3,1000) reason!: string;
 @ApiProperty({type:LegalBundleDto}) @IsDefined() @ValidateNested() @Type(()=>LegalBundleDto) legal!: LegalBundleDto;
}
export class SourceLineDto {
 @ApiProperty() @IsString() @Length(1,100) documentUid!: string;
 @ApiProperty() @IsString() @Length(1,100) rowKey!: string;
 @ApiProperty() @IsString() @Length(1,1000) title!: string;
 @ApiProperty() @IsNumber() @Min(0.000001) qty!: number;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) unit?: string;
 @ApiPropertyOptional() @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) unitPrice?: number;
 @ApiPropertyOptional() @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) lineAmount?: number;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,4000) description?: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,1000) dimensions?: string;
 @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) sku?: string;
}
