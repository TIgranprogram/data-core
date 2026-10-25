import { IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
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
  @IsOptional() @IsArray() images?: Array<{ kind: (typeof PASSPORT_IMAGE_KINDS)[number]; photoId: string; order?: number; caption?: string; refCode?: string }>;
  /** [{ pos, code, name, qty, unit, note }] — по умолчанию «Изделие в сборе». */
  @IsOptional() @IsArray() bom?: Array<{ pos?: number; code?: string; name?: string; qty?: number; unit?: string; note?: string; size?: string; mass?: number; photoId?: string }>;
  // ───── Паспорт v2 (БЗ-6 §3.4) — всё необязательное ─────
  // 2026-10-25: код MAF заменён на BLG; старое значение (открытая старая версия приложения) принимаем как BLG
  @IsOptional() @Transform(({ value }) => (value === 'MAF' ? 'BLG' : value)) @IsIn(['DIO', 'DSP', 'TRN', 'WRK', 'BLG']) passportCategory?: string;
  @IsOptional() @IsArray() @IsObjectId({ each: true }) elements?: string[];
  @IsOptional() @IsArray() @IsObjectId({ each: true }) materialIds?: string[];
  /** МИ: таблица «Материалы изделия» — снимок изделия с правкой; null — убрать. Разбор — common/catalog/materials-table.ts. */
  @IsOptional() @IsObject() materialsSpec?: { rows?: Array<{ materialId?: string; sizes?: string[]; partIds?: string[] }>; coatingIds?: string[] } | null;
  @IsOptional() @IsObjectId() installationTypeId?: string;
  @IsOptional() @IsBoolean() isKit?: boolean;
  @IsOptional() @IsIn(['standard', 'own']) schemeSource?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(120) ageFrom?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(120) ageTo?: number;
  @IsOptional() @IsNumber() @Min(0) heightMin?: number;
  @IsOptional() @IsNumber() @Min(0) heightMax?: number;
  @IsOptional() @IsNumber() @Min(0) weightMax?: number;
  @IsOptional() @IsNumber() @Min(0) maxUsers?: number;
  @IsOptional() @IsNumber() @Min(0) fallHeight?: number;
  @IsOptional() @IsNumber() @Min(0) siteLength?: number;
  @IsOptional() @IsNumber() @Min(0) siteWidth?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) serviceLifeYears?: number;
  @IsOptional() @IsObject() certificate?: { number?: string; until?: string; hasEac?: boolean };
  @IsOptional() @IsObjectId() manufacturerOrgId?: string;
  /** Заметки — лист «Для заметок» в PDF (нет заметки — нет листа). */
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
  // ПП: заполняется после печати (можно от руки) — пусто допустимо
  @IsOptional() @IsDateString() saleDate?: string;
  @IsOptional() @IsString() @MaxLength(300) installedBy?: string;
  @IsOptional() @IsDateString() installedAt?: string;
  @IsOptional() @IsString() @IsIn(['app', 'sheet:Pasports', 'kppdf']) source?: string;

  /** Подтверждение смены выданных номера / талона / даты (иначе 409). */
  @IsOptional() @IsBoolean() confirmNumbers?: boolean;
  /** ТЭ: какие текстовые поля изменены вручную (purpose, installationMethod, description…). */
  @IsOptional() @IsArray() @IsString({ each: true }) manualText?: string[];
  /** ПВ: выбор текстов воронкой { id раздела: id конечного варианта } (ключи и значения — ObjectId, проверяет сервер); null — очистить. */
  @IsOptional() @IsObject() textChoices?: Record<string, string> | null;
}
