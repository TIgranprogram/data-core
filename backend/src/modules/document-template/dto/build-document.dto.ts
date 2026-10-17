import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsInt,
  IsIn,
  Max,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Request-only visual overrides for one KP blank row (TZ-SALES-370). */
export class BuildRowPresentationDto {
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

export class BuildPreviewLineDto {
  @IsOptional()
  @IsIn(['catalog', 'custom', 'module', 'material'])
  lineKind?: 'catalog' | 'custom' | 'module' | 'material';

  @IsString()
  productName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  productSku?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => BuildRowPresentationDto)
  rowPresentation?: BuildRowPresentationDto;
}

export class BuildTermDto {
  @IsString()
  text!: string;

  @IsOptional() @IsNumber() @Min(0) sortOrder?: number;
}

export class BuildTableLayoutColumnDto {
  @IsString()
  key!: string;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(80)
  widthPercent?: number;
}

export class BuildTableChromeDto {
  @IsOptional()
  @IsIn(['thin', 'normal', 'thick'])
  borderWeight?: 'thin' | 'normal' | 'thick';

  @IsOptional()
  @IsIn(['normal', 'bold'])
  headerWeight?: 'normal' | 'bold';
}

/**
 * TZ-86 Phase A.4 — BuildDocumentDto.
 *
 * Input body for `POST /api/document-templates/:id/build`. A flat record of
 * optional ObjectId strings — one canonical key per `DataBindingSource` value.
 * Service resolves each in parallel via Mongoose findById and exposes them
 * to the template's blocks via dataBinding source-matching (`bag.source`).
 *
 * The build surface includes organization, counterparty, quotation, invoice,
 * contract and order sources. Catalog/work sources remain available for the
 * existing builder bindings; unsupported sources resolve to an empty render.
 *
 * Whitelist-strict (forbidNonWhitelisted) in main.ts ensures unknown fields
 * are stripped before reaching the service.
 */
export class BuildSheetLayoutDto {
  @IsOptional() @IsInt() @Min(0) @Max(200) rowsFirstPage?: number;
  @IsOptional() @IsInt() @Min(0) @Max(200) rowsNextPage?: number;
  @IsOptional() @IsInt() @Min(10) @Max(400) photoScalePercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) photoCropYPercent?: number;
  @IsOptional() @IsBoolean() showPhotoColumn?: boolean;
  @IsOptional() @IsInt() @Min(8) @Max(20) tableFontSize?: number;
  @IsOptional() @IsInt() @Min(8) @Max(20) tableHeaderFontSize?: number;
}

export class BuildDealTotalsDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  vatPercent!: number;

  @IsOptional() @IsIn(['none', 'percent', 'amount']) discountType?:
    'none' | 'percent' | 'amount';
  @IsOptional() @IsNumber() @Min(0) @Max(100) discountPercent?: number;
  @IsOptional() @IsNumber() @Min(0) discountAmount?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) prepaymentPercent?: number;
  @IsOptional() @IsNumber() @Min(0) productionDays?: number;
  @IsOptional() @IsNumber() @Min(0) deliveryDays?: number;
}

export class BuildDocumentDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildPreviewLineDto)
  previewLines?: BuildPreviewLineDto[];

  /** Request-only copy-on-write layout for the live КП line-items table. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildTableLayoutColumnDto)
  tableLayout?: BuildTableLayoutColumnDto[];

  /** Request-only border/header chrome for the live КП line-items table. */
  @IsOptional()
  @ValidateNested()
  @Type(() => BuildTableChromeDto)
  tableChrome?: BuildTableChromeDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildTermDto)
  terms?: BuildTermDto[];

  /** Request-only whole-deal totals; rendered only for the live line-items table. */
  @IsOptional()
  @ValidateNested()
  @Type(() => BuildSheetLayoutDto)
  sheetLayout?: BuildSheetLayoutDto;

  /** Request-only selected live table-template target for multi-table documents. */
  @IsOptional()
  @IsString()
  @IsObjectId()
  tableTargetId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BuildDealTotalsDto)
  dealTotals?: BuildDealTotalsDto;

  @IsOptional() @IsString() @IsObjectId() organizationId?: string;

  @IsOptional() @IsString() @IsObjectId() counterpartyId?: string;

  @IsOptional() @IsString() @IsObjectId() contactPersonId?: string;

  @IsOptional() @IsString() @IsObjectId() siteId?: string;

  @IsOptional() @IsString() @IsObjectId() productId?: string;

  @IsOptional() @IsString() @IsObjectId() materialId?: string;

  @IsOptional() @IsString() @IsObjectId() workTypeId?: string;

  @IsOptional() @IsString() @IsObjectId() orderId?: string;

  @IsOptional() @IsString() @IsObjectId() quotationId?: string;

  @IsOptional() @IsString() @IsObjectId() invoiceId?: string;

  @IsOptional() @IsString() @IsObjectId() contractId?: string;

  @IsOptional() @IsString() proposalNumber?: string;
  @IsOptional() @IsDateString() proposalDate?: string;
  @IsOptional() @IsDateString() validUntil?: string;
  @IsOptional() @IsNumber() @Min(0) totalPrice?: number;
}
