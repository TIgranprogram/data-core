import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class StockItemDto {
  @ApiPropertyOptional({ description: 'Наименование (обязательно при создании)' }) @IsOptional() @IsString() @Length(1, 300) name?: string;
  @ApiPropertyOptional({ description: 'Единица измерения (по умолчанию «шт»)' }) @IsOptional() @IsString() @Length(1, 30) unit?: string;
  @ApiPropertyOptional({ description: 'Артикул; пусто — автокод СКЛ-<год>-<номер>' }) @IsOptional() @IsString() @Length(0, 100) article?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() categoryId?: string;
  @ApiPropertyOptional({ description: 'Категория по названию (создаётся, если нет)' }) @IsOptional() @IsString() @Length(0, 100) categoryName?: string;
  @ApiPropertyOptional({ description: 'Минимальный остаток' }) @IsOptional() @IsNumber() @Min(0) minQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) weightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class StockMoveDto {
  @ApiProperty({ enum: ['in', 'out', 'adjust', 'reserve', 'unreserve'], description: 'приход / списание / корректировка (±) / бронь / снять бронь' })
  @IsIn(['in', 'out', 'adjust', 'reserve', 'unreserve']) type!: 'in' | 'out' | 'adjust' | 'reserve' | 'unreserve';
  @ApiProperty({ description: 'Количество > 0; для adjust — изменение со знаком' }) @IsNumber() qty!: number;
  @ApiPropertyOptional({ description: 'Примечание / основание / для кого бронь' }) @IsOptional() @IsString() @Length(0, 500) note?: string;
  @ApiPropertyOptional({ description: 'Ключ операции клиента — повтор с тем же ключом ничего не меняет' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

export class StockPhotoDto {
  @ApiProperty({ description: 'id фото из POST /api/photos/upload' }) @IsMongoId() photoId!: string;
}
