import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsDateString, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

/** Запуск в работу: все позиции заказа или выбранные. Нужен хотя бы один из двух. */
export class LaunchDto {
  @ApiPropertyOptional({ description: 'Заказ (salesorders): запускаются все его позиции' }) @IsOptional() @IsMongoId() orderId?: string;
  @ApiPropertyOptional({ type: [String], description: 'Только эти позиции (incomes); с orderId — должны быть из этого заказа' }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsMongoId({ each: true }) lineIds?: string[];
}

/** Перевод карточки: на номер шага маршрута (с 0) либо `to`. Один из двух. */
export class MoveDto {
  @ApiPropertyOptional({ description: 'Номер шага маршрута с 0; перевод назад тоже допустим' }) @IsOptional() @IsInt() @Min(0) stepIndex?: number;
  @ApiPropertyOptional({ enum: ['next', 'waiting'], description: 'next — следующий шаг (с последнего — «Готово»); waiting — вернуть в «Ждёт запуска»' }) @IsOptional() @IsIn(['next', 'waiting']) to?: 'next' | 'waiting';
}

export class CancelDto {
  @ApiProperty({ description: 'Причина отмены' }) @IsString() @Length(1, 500) reason!: string;
}

/** Правка карточки: исполнитель и примечание. */
export class WorkTaskPatchDto {
  @ApiPropertyOptional({ description: 'Исполнитель — сотрудник (persons); null — снять' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsMongoId() assigneeId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 5000) note?: string;
}

export class RouteStepDto {
  // 2026-11-10: экран шлёт шаги с id (сервер отдаёт id каждому объекту) — без поля 400 «steps.0.id: лишнее поле»
  @ApiPropertyOptional({ description: 'id шага; у нового можно не указывать' }) @IsOptional() @IsString() @Length(1, 40) id?: string;
  @ApiProperty({ description: 'Вид работ (worktypes)' }) @IsMongoId() workTypeId!: string;
  @ApiPropertyOptional({ description: 'Часть состава изделия (composition[]._id)' }) @IsOptional() @IsMongoId() lineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
  @ApiPropertyOptional({ description: 'id части изделия (parts[].id или временный ключ новой); null/нет — «Изделие целиком»' }) @IsOptional() @IsString() @Length(1, 40) partRowId?: string | null;
  @ApiPropertyOptional({ description: 'Норма часов на 1 шт.' }) @IsOptional() @IsNumber() @Min(0) @Max(1000) hours?: number;
  @ApiPropertyOptional({ description: 'Зелёная галочка «Проверено»' }) @IsOptional() @IsBoolean() checked?: boolean;
}

/** Часть изделия в маршруте. `id` — прежний id части или ключ новой (24 hex допустим). */
export class RoutePartDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) id?: string;
  @ApiPropertyOptional({ description: 'Запись справочника productParts' }) @IsOptional() @IsMongoId() partId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.001) @Max(100000) qty?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() checked?: boolean;
}

/** Маршрут изделия целиком: порядок элементов = порядок работ; пустой список — маршрут убран. */
export class RouteDto {
  @ApiProperty({ type: [RouteStepDto] }) @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RouteStepDto) steps!: RouteStepDto[];
  @ApiPropertyOptional({ type: [RoutePartDto], description: 'Части изделия целиком; не указаны — части не меняются' }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RoutePartDto) parts?: RoutePartDto[];
}

/** Ручной план шага (Гант): начало и/или длительность в днях. */
export class PlanDto {
  @ApiProperty({ description: 'Номер шага маршрута с 0' }) @IsInt() @Min(0) stepIndex!: number;
  @ApiPropertyOptional({ description: 'Начало шага (ISO-дата)' }) @IsOptional() @IsDateString() start?: string;
  @ApiPropertyOptional({ description: 'Длительность, дней (1..365)' }) @IsOptional() @IsInt() @Min(1) @Max(365) days?: number;
}
