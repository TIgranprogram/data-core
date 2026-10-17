import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  ValidateIf,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

/** Whitelisted visual snapshot for one KP line (TZ-SALES-370). */
export class QuotationRowPresentationDto {
  @IsOptional()
  @IsIn(['auto', 'compact', 'large'])
  density?: 'auto' | 'compact' | 'large';

  @IsOptional()
  @IsIn(['normal', 'accent'])
  emphasis?: 'normal' | 'accent';

  @IsOptional()
  @IsBoolean()
  separatorBefore?: boolean;

  @IsOptional()
  @IsBoolean()
  pageBreakBefore?: boolean;

  @IsOptional()
  @IsBoolean()
  showDescription?: boolean;

  @IsOptional()
  @IsIn(['inherit', 'contain', 'cover'])
  photoFit?: 'inherit' | 'contain' | 'cover';
}

export class QuotationItemDto {
  @IsOptional()
  @IsIn(['catalog', 'custom', 'module', 'material'])
  lineKind?: 'catalog' | 'custom' | 'module' | 'material';

  @ValidateIf(
    (item) =>
      (item.lineKind ?? 'catalog') === 'catalog' ||
      (!item.lineKind && !item.refId),
  )
  @IsObjectId()
  productId?: string;

  @ValidateIf(
    (item) => item.lineKind === 'module' || item.lineKind === 'material',
  )
  @IsObjectId()
  refId?: string;

  @ValidateIf((item) => item.lineKind === 'custom')
  @IsString()
  productName?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() productSku?: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() sourceItemId?: string;
  @IsOptional()
  @IsArray()
  @IsIn(['productName', 'description', 'productSku', 'unit'], { each: true })
  catalogDirtyFields?: Array<'productName' | 'description' | 'productSku' | 'unit'>;
  @IsOptional() @IsIn(['pending', 'kp-only']) catalogDecision?: 'pending' | 'kp-only';
  @IsOptional() @IsNumber() @Min(0) catalogSourceVersion?: number;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional() @IsString() unit?: string;
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional() @IsNumber() @Min(0) markupPercent?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) discountPercent?: number;
  @IsOptional() @IsBoolean() isOptional?: boolean;
  @IsOptional()
  @ValidateNested()
  @Type(() => QuotationRowPresentationDto)
  rowPresentation?: QuotationRowPresentationDto;
  @IsOptional() @IsNumber() @Min(0) sortOrder?: number;
}

export class QuotationTermDto {
  @IsString()
  text!: string;

  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class QuotationSheetLayoutDto {
  @IsOptional() @IsInt() @Min(0) @Max(200) rowsFirstPage?: number;
  @IsOptional() @IsInt() @Min(0) @Max(200) rowsNextPage?: number;
  @IsOptional() @IsInt() @Min(10) @Max(400) photoScalePercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) photoCropYPercent?: number;
  @IsOptional() @IsBoolean() showPhotoColumn?: boolean;
  @IsOptional() @IsInt() @Min(8) @Max(20) tableFontSize?: number;
  @IsOptional() @IsInt() @Min(8) @Max(20) tableHeaderFontSize?: number;
}

export class CreateQuotationDto {
  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsString() title?: string;

  @IsObjectId()
  organizationId!: string;

  /** Drafts may be saved before the Client picker (TZ-SALES-333/334). */
  @IsOptional()
  @IsObjectId()
  counterpartyId?: string;

  @IsOptional() @IsObjectId() contactPersonId?: string | null;
  @IsOptional() @IsObjectId() siteId?: string | null;

  @IsOptional() @IsNumber() @Min(-100) @Max(1000) orgMarkupPercent?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(100) vatPercent?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) prepaymentPercent?: number;
  @IsOptional() @IsInt() @Min(0) productionDays?: number;
  @IsOptional() @IsInt() @Min(0) deliveryDays?: number;

  @IsOptional() @IsObjectId() tenderId?: string;

  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsDateString() validUntil?: string;

  @IsOptional()
  @IsIn(['draft', 'sent', 'accepted', 'rejected', 'converted', 'cancelled'])
  status?:
    'draft' | 'sent' | 'accepted' | 'rejected' | 'converted' | 'cancelled';

  @IsOptional()
  @IsIn(['none', 'percent', 'amount'])
  discountType?: 'none' | 'percent' | 'amount';

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discountPercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discountAmount?: number;

  @IsOptional() @IsString() notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationTermDto)
  terms?: QuotationTermDto[];

  @IsOptional() @IsObjectId() templateId?: string;
  @IsOptional() @IsObjectId() studioDocumentId?: string;
  @IsOptional() designSnapshot?: Record<string, unknown>;
  @IsOptional() templateSnapshot?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => QuotationSheetLayoutDto)
  sheetLayout?: QuotationSheetLayoutDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items?: QuotationItemDto[];
}
