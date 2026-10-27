import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsObject, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { ORDER_PRIORITIES, type OrderPriority } from '../../../common/text/order-key';
import { DESIGN_STATUSES, type DesignStatus } from '../design-task.schema';

/** Поля создания и правки задачи. null / '' в правке — очистить (срок и приоритет → снова из заказа). */
export class DesignTaskDto {
  @ApiPropertyOptional({ enum: DESIGN_STATUSES, description: 'queue | work | done | paused' }) @IsOptional() @IsIn(DESIGN_STATUSES as unknown as string[]) status?: DesignStatus;
  @ApiPropertyOptional({ description: 'Исполнитель — сотрудник (persons); null — снять' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsMongoId() assigneeId?: string | null;
  @ApiPropertyOptional({ description: 'Позиция заказа (incomes): заказ и изделие берутся из неё. В правке — только привязка свободной задачи (без позиции); сменить позицию нельзя' }) @IsOptional() @IsMongoId() incomeId?: string;
  @ApiPropertyOptional({ description: 'Изделие (products); null — снять' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsMongoId() productId?: string | null;
  @ApiPropertyOptional({ description: 'Название; свободной задаче обязательно' }) @IsOptional() @IsString() @Length(0, 300) title?: string;
  @ApiPropertyOptional({ description: 'Свой срок ГГГГ-ММ-ДД / ДД.ММ.ГГГГ; ""/null — снова из заказа' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(0, 30) deadline?: string | null;
  @ApiPropertyOptional({ enum: ORDER_PRIORITIES, description: 'Свой приоритет; ""/null — снова из заказа' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsIn([...ORDER_PRIORITIES, '']) priority?: OrderPriority | '' | null;
  @ApiPropertyOptional({ description: 'Причина паузы (обязательна для paused)' }) @IsOptional() @IsString() @Length(0, 500) pauseReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 5000) note?: string;
}

export class FromOrderDto {
  @ApiProperty({ description: 'Заказ (salesorders)' }) @IsMongoId() orderId!: string;
  @ApiPropertyOptional({ type: [String], description: 'Только эти позиции; пусто — все позиции заказа' }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsMongoId({ each: true }) lineIds?: string[];
}

export class AddDesignOrderDto {
  @ApiProperty({ description: 'Заказ (salesorders), который берём на доску проектирования' }) @IsMongoId() orderId!: string;
  @ApiPropertyOptional({ description: 'true — сразу создать задачи «Распределение» на все позиции без открытой задачи' }) @IsOptional() @IsBoolean() distribute?: boolean;
}

export class PhotoDto {
  @ApiProperty({ description: 'Фото из POST /api/photos/upload' }) @IsMongoId() photoId!: string;
}

export class StickerValuesDto {
  @ApiProperty({ description: '{ <id стикера>: число | id состояния }; null или "" — очистить значение', type: 'object', additionalProperties: true })
  @IsObject() values!: Record<string, unknown>;
}

export class StickerStateDto {
  @ApiPropertyOptional({ description: 'Устойчивый id состояния; пусто — создаётся сервером' }) @IsOptional() @IsString() @Length(1, 40) id?: string;
  @ApiProperty() @IsString() @Length(1, 60) label!: string;
  @ApiPropertyOptional({ description: 'Цвет #RRGGBB' }) @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Цвет — в виде #RRGGBB' }) color?: string;
}

/** Создание и правка стикера доски. Системным можно менять только visible и order. */
export class DesignStickerDto {
  @ApiPropertyOptional({ enum: ['number', 'state'], description: 'Вид (только при создании)' }) @IsOptional() @IsIn(['number', 'state']) kind?: 'number' | 'state';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60) label?: string;
  @ApiPropertyOptional({ description: 'Единица числа («ч», «шт»)' }) @IsOptional() @IsString() @Length(0, 20) unit?: string;
  @ApiPropertyOptional({ type: [StickerStateDto], description: 'Состояния (для kind=state, 1–20)' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => StickerStateDto) states?: StickerStateDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() visible?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) order?: number;
}
