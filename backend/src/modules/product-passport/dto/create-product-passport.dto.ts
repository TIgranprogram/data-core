import { IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';
import { PASSPORT_IMAGE_KINDS } from '../product-passport.schema';

/**
 * Паспорт изделия (ПС.1). Номера (`passportNumber`, `productCode`, `warrantyCode`) не передавать —
 * их выдаёт сервер; явные значения — только перенос/исправление (уникальность проверяется, конфликт — 409).
 */
export class CreateProductPassportDto {
  @IsOptional() @IsObjectId() productId?: string;
  @IsOptional() @IsString() passportNumber?: string;
  @IsOptional() @IsString() productCode?: string;
  @IsOptional() @IsString() warrantyCode?: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() article?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() installationSite?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() photo?: string;
  @IsOptional() @IsNumber() @Min(0) height?: number;
  @IsOptional() @IsNumber() @Min(0) length?: number;
  @IsOptional() @IsNumber() @Min(0) width?: number;
  @IsOptional() @IsNumber() @Min(0) weight?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional() @IsString() materials?: string;
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsString() installationMethod?: string;
  @IsOptional() @IsString() objectName?: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsObjectId() customerOrgId?: string;
  @IsOptional() @IsString() orderNo?: string;
  @IsOptional() @IsObjectId() salesOrderId?: string;
  @IsOptional() @IsObjectId() supplierOrgId?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(240) warrantyMonths?: number;
  /** [{ kind: overview|dimensions|safety|mounting, photoId, order?, caption? }] */
  @IsOptional() @IsArray() images?: Array<{ kind: (typeof PASSPORT_IMAGE_KINDS)[number]; photoId: string; order?: number; caption?: string }>;
  /** [{ pos, code, name, qty, unit, note }] — по умолчанию «Изделие в сборе». */
  @IsOptional() @IsArray() bom?: Array<{ pos?: number; code?: string; name?: string; qty?: number; unit?: string; note?: string }>;
  /** Заметки — лист «Для заметок» в PDF (нет заметки — нет листа). */
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
  @IsOptional() @IsString() @IsIn(['app', 'sheet:Pasports', 'kppdf']) source?: string;

  /** Подтверждение смены выданных номера / талона / даты (иначе 409). */
  @IsOptional() @IsBoolean() confirmNumbers?: boolean;
}
