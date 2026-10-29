import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Min, ValidateIf, ValidateNested } from 'class-validator';

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
  @ApiProperty({ description: 'Вид работ (worktypes)' }) @IsMongoId() workTypeId!: string;
  @ApiPropertyOptional({ description: 'Часть состава изделия (composition[]._id)' }) @IsOptional() @IsMongoId() lineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
}

/** Маршрут изделия целиком: порядок элементов = порядок работ; пустой список — маршрут убран. */
export class RouteDto {
  @ApiProperty({ type: [RouteStepDto] }) @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RouteStepDto) steps!: RouteStepDto[];
}
