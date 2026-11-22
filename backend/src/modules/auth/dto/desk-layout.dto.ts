import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DESK_CARD_TYPES, DESK_LANES, type DeskCard, type DeskLayout } from '../../user/desk-layout';

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_REF = /^[^\u0000-\u001f\u007f\\]+$/u;
const normalizeId = (value: unknown) =>
  typeof value === 'string' && (OBJECT_ID.test(value) || UUID_V4.test(value)) ? value.toLowerCase() : value;
const submitted = (_: unknown, value: unknown) => value !== undefined;

class DeskTaskDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }) => normalizeId(value))
  @IsUUID('4')
  id!: string;

  @ApiProperty({ minLength: 1, maxLength: 180 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 180)
  title!: string;

  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf(submitted)
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  due?: string;

  @ApiProperty()
  @IsBoolean()
  done!: boolean;
}

class DeskCardDto {
  @ApiProperty({ enum: DESK_CARD_TYPES })
  @IsIn(DESK_CARD_TYPES)
  of!: (typeof DESK_CARD_TYPES)[number];

  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Transform(({ value }) => normalizeId(value))
  @IsString()
  @Length(1, 160)
  @Matches(LOCAL_REF)
  id!: string;

  @ApiProperty({ enum: DESK_LANES })
  @IsIn(DESK_LANES)
  lane!: (typeof DESK_LANES)[number];

  @ApiPropertyOptional({ minLength: 1, maxLength: 180, description: 'Название личной задачи (of: personal)' })
  @ValidateIf(submitted)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 180)
  title?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Срок личной задачи (of: personal)' })
  @ValidateIf(submitted)
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  due?: string;

  @ApiPropertyOptional({ description: 'Готовность личной задачи (of: personal)' })
  @ValidateIf(submitted)
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({ type: [DeskTaskDto], maxItems: 12 })
  @ValidateIf(submitted)
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique((task: DeskTaskDto | null) => task?.id)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => DeskTaskDto)
  tasks?: DeskTaskDto[];
}

export class DeskLayoutDto {
  @ApiProperty({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  version!: number;

  @ApiProperty({ type: [DeskCardDto], maxItems: 60 })
  @IsArray()
  @ArrayMaxSize(60)
  @ArrayUnique((card: DeskCardDto | null) =>
    typeof card?.of === 'string' && typeof card.id === 'string' ? card.of + ':' + card.id : card)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => DeskCardDto)
  items!: DeskCardDto[];
}

function deskCard(dto: DeskCardDto): DeskCard {
  const { of, id, lane, tasks, title, due, done } = dto;
  const base = { id, lane, ...(tasks?.length ? { tasks: tasks.map((task) => ({ ...task })) } : {}) };
  if (of === 'personal') {
    if (!UUID_V4.test(id) || !title || typeof done !== 'boolean') {
      throw new BadRequestException('У личной задачи должны быть свой идентификатор, название и отметка готовности');
    }
    return { ...base, of, title, ...(due ? { due } : {}), done };
  }
  if (title !== undefined || due !== undefined || done !== undefined) {
    throw new BadRequestException('Название, срок и готовность записи задаются в её исходной карточке');
  }
  const group = of === 'salesorders' && id.length <= 50 && id.trim() === id && id !== '.' && id !== '..' && !id.includes('://');
  const customer = of === 'partners' && id.startsWith('c:') && id.length > 2 && id.trim() === id;
  if (!OBJECT_ID.test(id) && !group && !customer) throw new BadRequestException('Недопустимый идентификатор карточки');
  return { ...base, of };
}

/** Проверить поля, зависящие от типа карточки, и сохранить только канонические свойства. */
export function toDeskLayout(dto: DeskLayoutDto): DeskLayout {
  return { version: dto.version, items: dto.items.map(deskCard) };
}
