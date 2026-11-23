import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsIn, IsMongoId, IsNotEmpty, IsNumber, IsObject, IsString, Min, ValidateIf, ValidateNested } from 'class-validator';

export const IMPORT_KINDS = ['overview', 'dimensions', 'foundation'] as const;
export class PassportImportImageDto {
  @ApiProperty({ enum: IMPORT_KINDS, description: 'Третий лист передаётся как foundation; сервер выбирает foundation или mounting по способу установки.' })
  @IsIn(IMPORT_KINDS) kind!: string;
  @ApiProperty({ type: String, description: 'ID живого локального PNG в photos.' })
  @IsMongoId() photoId!: string;
}
export class PassportImportDimensionsDto {
  @ApiProperty({ type: Number, minimum: 0.001 })
  @IsNumber() @Min(0.001) length!: number;
  @ApiProperty({ type: Number, minimum: 0.001 })
  @IsNumber() @Min(0.001) width!: number;
  @ApiProperty({ type: Number, minimum: 0.001 })
  @IsNumber() @Min(0.001) height!: number;
  @ApiProperty({ enum: ['мм'] })
  @Equals('мм') unit!: 'мм';
}
export class PassportImportConfirmedDto {
  @ApiPropertyOptional({ type: String, description: 'Явно выбранный живой способ установки из context.installations; отсутствие сохраняет прежний выбор изделия.' })
  @ValidateIf((_o, v) => v !== undefined) @IsMongoId() installationTypeId?: string;
  @ApiPropertyOptional({ type: PassportImportDimensionsDto, description: 'Только одобренные габариты. Отсутствие поля сохраняет прежние значения.' })
  @ValidateIf((_o, v) => v !== undefined) @IsObject() @ValidateNested() @Type(() => PassportImportDimensionsDto) dimensions?: PassportImportDimensionsDto;
  @ApiPropertyOptional({ type: Number, minimum: 0.001, description: 'Одобренная масса, кг.' })
  @ValidateIf((_o, v) => v !== undefined) @IsNumber() @Min(0.001) weightKg?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'Одобренная глубина основания, мм.' })
  @ValidateIf((_o, v) => v !== undefined) @IsNumber() @Min(0) foundationDepth?: number;
}
export class PassportImportDto {
  @ApiProperty({ type: String, minLength: 1, description: 'Контекст до загрузки PNG из GET passport-import-context.' })
  @IsString() @IsNotEmpty() contextToken!: string;
  @ApiProperty({ type: [PassportImportImageDto], minItems: 3, maxItems: 3, description: 'Ровно три уникальных kind: overview, dimensions, foundation.' })
  @IsArray() @ArrayMinSize(3) @ArrayMaxSize(3) @ArrayUnique((i: PassportImportImageDto) => i.kind)
  @ValidateNested({ each: true }) @Type(() => PassportImportImageDto) images!: PassportImportImageDto[];
  @ApiProperty({ type: PassportImportConfirmedDto, description: 'Без одобренных чисел передать {}. null не очищает поля и запрещён.' })
  @IsObject() @ValidateNested() @Type(() => PassportImportConfirmedDto) confirmed!: PassportImportConfirmedDto;
}

export class PassportImportInstallationResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ enum: ['foundation', 'mounting'] }) thirdImportKind!: 'foundation' | 'mounting';
  @ApiProperty({ type: Boolean }) depthApplicable!: boolean;
}
export class PassportImportContextResponseDto {
  @ApiProperty({ type: String }) contextToken!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Текущий effective ID изделия: legacy поле перед defaults; неизвестный ID не выбирает первый вариант.' }) installationTypeId!: string | null;
  @ApiProperty({ type: [PassportImportInstallationResponseDto], description: 'Живые поддержанные способы установки, применимые к типу паспорта изделия.' }) installations!: PassportImportInstallationResponseDto[];
}
export class PassportImportIssuedResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: Number }) fromRevision!: number;
  @ApiProperty({ type: Number }) toRevision!: number;
}
export class PassportImportSkippedResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String, enum: ['annulled', 'printFile', 'line_missing', 'order_mismatch', 'order_missing', 'order_closed', 'source_attachment', 'installation_mismatch', 'installation_unknown'] }) reason!: string;
}
export class PassportImportResponseDto {
  @ApiProperty({ enum: ['applied', 'unchanged'] }) status!: 'applied' | 'unchanged';
  @ApiProperty({ type: [String], description: 'Обновлённые canonical kind; у анкеров содержит mounting, возможна очистка legacy foundation.' }) updatedKinds!: string[];
  @ApiProperty({ type: [String], description: 'Одобренные поля изделия: dimensions, weightKg, passportDefaults.foundationDepth, passportDefaults.installationTypeId.' }) confirmedFields!: string[];
  @ApiProperty({ type: [PassportImportIssuedResponseDto] }) issued!: PassportImportIssuedResponseDto[];
  @ApiProperty({ type: [String] }) drafts!: string[];
  @ApiProperty({ type: [PassportImportSkippedResponseDto] }) skipped!: PassportImportSkippedResponseDto[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}
