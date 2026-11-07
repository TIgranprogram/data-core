import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

/** Часть в плане. `id` — прежний id части или временный ключ новой (на него ссылаются шаги). */
export class PlanPartDto {
  @ApiPropertyOptional({ description: 'id части в плане; у новой — временный ключ' }) @IsOptional() @IsString() @Length(1, 40) id?: string;
  @ApiPropertyOptional({ description: 'Запись справочника productParts' }) @IsOptional() @IsMongoId() partId?: string;
  @ApiPropertyOptional({ description: 'Название; новое имя без partId сервер заводит в справочник' }) @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional({ description: 'Сколько таких частей в изделии (по умолчанию 1)' }) @IsOptional() @IsNumber() @Min(0.001) @Max(100000) qty?: number;
  @ApiPropertyOptional({ description: 'Зелёная галочка «Проверено»' }) @IsOptional() @IsBoolean() checked?: boolean;
}

export class PlanStepPlanDto {
  @ApiProperty() @IsDateString() start!: string;
  @ApiProperty() @IsDateString() end!: string;
}

/** Шаг плана: вид работ × часть. Задел Э2: `assigneeId`, `plan`. */
export class PlanStepDto {
  @ApiPropertyOptional({ description: 'id шага; у нового можно не указывать' }) @IsOptional() @IsString() @Length(1, 40) id?: string;
  @ApiProperty({ description: 'Вид работ (worktypes)' }) @IsMongoId() workTypeId!: string;
  @ApiPropertyOptional({ description: 'id части плана (или временный ключ новой); нет — «Изделие целиком»' }) @IsOptional() @IsString() @Length(1, 40) partRowId?: string;
  @ApiPropertyOptional({ description: 'Норма часов на 1 шт.' }) @IsOptional() @IsNumber() @Min(0) @Max(1000) hours?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() checked?: boolean;
  @ApiPropertyOptional({ description: 'Исполнитель шага (Э2)' }) @IsOptional() @IsMongoId() assigneeId?: string;
  @ApiPropertyOptional({ type: PlanStepPlanDto, description: 'Ручной план для Ганта (Э2)' }) @IsOptional() @ValidateNested() @Type(() => PlanStepPlanDto) plan?: PlanStepPlanDto;
}

/** Записать план целиком. `rev` — версия, которую человек видел. */
export class SavePlanDto {
  @ApiProperty() @IsInt() @Min(1) rev!: number;
  @ApiProperty({ type: [PlanPartDto] }) @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PlanPartDto) parts!: PlanPartDto[];
  @ApiProperty({ type: [PlanStepDto] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PlanStepDto) steps!: PlanStepDto[];
}

/** Быстрая правка шага в Ганте: исполнитель и/или даты (C041 Э2). `assigneeId: null` — снять исполнителя. */
export class StepPatchDto {
  @ApiPropertyOptional({ description: 'Версия плана, которую видел экран; старая — 409' }) @IsOptional() @IsInt() @Min(1) rev?: number;
  @ApiPropertyOptional({ nullable: true, description: 'Исполнитель (persons); null — снять' }) @IsOptional() @ValidateIf((o: StepPatchDto) => o.assigneeId !== null) @IsMongoId() assigneeId?: string | null;
  @ApiPropertyOptional({ description: 'Норма часов на 1 шт.' }) @IsOptional() @IsNumber() @Min(0) @Max(1000) hours?: number;
  @ApiPropertyOptional({ description: 'Начало (ISO); без end длительность сохраняется' }) @IsOptional() @IsDateString() start?: string;
  @ApiPropertyOptional({ description: 'Конец (ISO), включительно' }) @IsOptional() @IsDateString() end?: string;
}

export class StepMarkDto {
  @ApiProperty({ enum: ['start', 'finish'] }) @IsIn(['start', 'finish']) what!: 'start' | 'finish';
}

export class CheckDto {
  @ApiProperty({ enum: ['part', 'step'] }) @IsIn(['part', 'step']) kind!: 'part' | 'step';
  @ApiProperty() @IsMongoId() rowId!: string;
  @ApiProperty() @IsBoolean() checked!: boolean;
}

/** Перенос плана в изделие. `productUpdatedAt` — из ответа плана; изделие менялось после — 409. */
export class ApplyToProductDto {
  @ApiPropertyOptional({ description: 'productUpdatedAt из ответа плана (ISO); у изделия без даты — не указывать' }) @IsOptional() @IsDateString() productUpdatedAt?: string | null;
}
