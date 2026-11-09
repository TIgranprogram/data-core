import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Matches, Min, ValidateNested } from 'class-validator';

/** Лимиты из DECISIONS п. 14. */
export const PDM_MAX_ITEMS = 5000;
export const PDM_MAX_BOM = 20000;
export const PDM_KINDS = ['product', 'module', 'part', 'fastener', 'purchased'] as const;
export type PdmKind = (typeof PDM_KINDS)[number];
export const PDM_DOC_TYPES = ['pdf', 'dxf', 'assembly', 'install'] as const;
export type PdmDocType = (typeof PDM_DOC_TYPES)[number];
export const PDM_ACTIONS = ['create', 'link', 'update-all', 'keep-site'] as const;
export type PdmAction = (typeof PDM_ACTIONS)[number];
const SAFE = /^[A-Za-zА-Яа-яЁё0-9._-]+$/;
const SAFE_MSG = 'Обозначение может содержать только буквы, цифры, точку, дефис и подчёркивание';
const SHA = /^[A-Fa-f0-9]{64}$/;
const SHA_MSG = 'sha256: 64 шестнадцатеричных символа';

export class PdmReaderDto {
  @IsOptional() @IsString() @Length(0, 200) app?: string;
  @IsOptional() @IsString() @Length(0, 64) version?: string;
  @IsOptional() @IsString() @Length(0, 200) computer?: string;
  @IsOptional() @IsString() @Length(0, 200) user?: string;
}

export class PdmFileRefDto {
  @IsOptional() @IsInt() @Min(0) id?: number;
  @IsOptional() @IsString() @Length(0, 1024) path?: string;
  @IsOptional() @IsInt() @Min(0) version?: number;
  @IsOptional() @IsString() @Length(0, 128) state?: string;
  @IsOptional() @IsString() @Length(0, 64) modified?: string;
}

/** Размеры, мм. `null` — нет. */
export class PdmSizeDto {
  @IsOptional() @IsNumber() @Min(0) length?: number | null;
  @IsOptional() @IsNumber() @Min(0) width?: number | null;
  @IsOptional() @IsNumber() @Min(0) thickness?: number | null;
}

export class PdmBlankDto extends PdmSizeDto {
  @IsOptional() @IsIn(['dxf', 'pdm']) source?: 'dxf' | 'pdm' | null;
}

export class PdmDocDto {
  @ApiProperty({ enum: PDM_DOC_TYPES }) @IsIn(PDM_DOC_TYPES as unknown as string[]) type!: PdmDocType;
  @IsString() @Length(1, 128) @Matches(SAFE, { message: 'Недопустимое имя файла' }) name!: string;
  @IsOptional() @IsInt() @Min(0) pdmFileId?: number;
  @IsInt() @Min(0) version!: number;
  @IsOptional() @IsString() @Length(0, 128) state?: string;
  @IsOptional() @IsString() @Length(0, 64) modified?: string;
  @IsString() @Matches(SHA, { message: SHA_MSG }) sha256!: string;
  @IsOptional() @IsInt() @Min(0) size?: number;
  @IsOptional() @IsString() @Length(0, 1024) file?: string;
}

export class PdmItemDto {
  @ApiProperty() @IsString() @Length(1, 128) @Matches(SAFE, { message: SAFE_MSG }) designation!: string;
  @ApiProperty({ enum: PDM_KINDS }) @IsIn(PDM_KINDS as unknown as string[]) kind!: PdmKind;
  @IsOptional() @IsString() @Length(0, 200) pdmKind?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(1, 128, { each: true }) aliases?: string[];
  @IsOptional() @IsString() @Length(0, 256) config?: string;
  @IsOptional() @ValidateNested() @Type(() => PdmFileRefDto) file?: PdmFileRefDto;
  /** Переменные карточки PDM как есть («Сортамент», «Материал»…). */
  @IsOptional() @IsObject() vars?: Record<string, unknown>;
  @IsOptional() @ValidateNested() @Type(() => PdmSizeDto) size?: PdmSizeDto;
  @IsOptional() @ValidateNested() @Type(() => PdmBlankDto) blank?: PdmBlankDto;
  @IsOptional() @IsNumber() @Min(0) massKg?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) ral?: string[];
  @IsOptional() @IsString() @Length(0, 256) folder?: string;
  @IsOptional() @IsString() @Length(0, 1024) preview?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PdmDocDto) docs?: PdmDocDto[];
}

export class PdmBomDto {
  @IsString() @Length(1, 128) parent!: string;
  @IsString() @Length(1, 128) child!: string;
  @IsNumber() @Min(0.000001) qty!: number;
}

export class PdmWarningDto {
  @IsOptional() @IsString() @Length(0, 128) designation?: string;
  @IsString() @Length(0, 64) code!: string;
  @IsOptional() @IsString() @Length(0, 1000) text?: string;
}

/** Дерево изделия, формат `pdm-tree/1` (docs/crew/C057-pdm-import/CONTRACT.md §2). */
export class PdmTreeDto {
  @ApiProperty({ example: 'pdm-tree/1' }) @IsIn(['pdm-tree/1'], { message: 'Неизвестный формат дерева (нужен pdm-tree/1)' }) schema!: 'pdm-tree/1';
  @IsOptional() @IsString() @Length(0, 128) vault?: string;
  @IsOptional() @IsDateString() readAt?: string;
  @IsOptional() @ValidateNested() @Type(() => PdmReaderDto) reader?: PdmReaderDto;
  @ApiProperty() @IsString() @Length(1, 128) @Matches(SAFE, { message: SAFE_MSG }) root!: string;
  @ApiProperty({ type: [PdmItemDto] }) @IsArray() @ArrayMinSize(1, { message: 'В дереве нет позиций' }) @ArrayMaxSize(PDM_MAX_ITEMS, { message: `В дереве больше ${PDM_MAX_ITEMS} позиций` })
  @ValidateNested({ each: true }) @Type(() => PdmItemDto) items!: PdmItemDto[];
  @IsArray() @ArrayMaxSize(PDM_MAX_BOM) @ValidateNested({ each: true }) @Type(() => PdmBomDto) bom!: PdmBomDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(PDM_MAX_ITEMS) @ValidateNested({ each: true }) @Type(() => PdmWarningDto) warnings?: PdmWarningDto[];
}

/** Решение человека по одному обозначению (проверяется в сервисе: тело — словарь). */
export interface PdmDecision {
  action: PdmAction;
  targetId?: string;
  /** Для расхождений: поле → `site` (оставить) | `pdm` (взять из PDM). */
  fields?: Record<string, 'site' | 'pdm'>;
}

export class PdmApplyDto {
  @ApiPropertyOptional({ description: 'Номер плана из предпросмотра' }) @IsOptional() @IsString() planId?: string;
  @ApiPropertyOptional({ description: 'Или то же дерево, что в предпросмотре (план найдётся по хэшу)' }) @IsOptional() @ValidateNested() @Type(() => PdmTreeDto) tree?: PdmTreeDto;
  @ApiPropertyOptional({ description: 'Обозначение → { action: create|link|update-all|keep-site, targetId?, fields?: { поле: site|pdm } }' }) @IsOptional() @IsObject() decisions?: Record<string, PdmDecision>;
}

/** Поля формы загрузки файла (multipart приходит строками). */
export class PdmFileFormDto {
  @IsString() importId!: string;
  @IsString() @Length(1, 128) designation!: string;
  @IsIn(PDM_DOC_TYPES as unknown as string[]) type!: PdmDocType;
  @IsString() @Length(1, 128) name!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) pdmFileId?: number;
  @Type(() => Number) @IsInt() @Min(0) version!: number;
  @IsOptional() @IsString() @Length(0, 128) state?: string;
  @IsOptional() @IsString() @Length(0, 64) modified?: string;
  @IsString() @Matches(SHA, { message: SHA_MSG }) sha256!: string;
}
