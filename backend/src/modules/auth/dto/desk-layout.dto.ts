import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
import { DESK_CARD_TYPES, type DeskCard, type DeskLayout, type DeskRef } from '../../user/desk-layout';

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANE = /^(?:focus|next|waiting|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const REF_TYPES = DESK_CARD_TYPES.filter((value) => value !== 'personal');
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

class DeskLaneDto {
  @ApiProperty({ description: "Ключ стопки: встроенный или UUID" })
  @Matches(LANE)
  key!: string;

  @ApiProperty({ minLength: 1, maxLength: 80 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 80)
  title!: string;
}

class DeskRefDto implements DeskRef {
  @ApiProperty({ enum: REF_TYPES })
  @IsIn(REF_TYPES)
  of!: DeskRef['of'];

  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Transform(({ value }) => normalizeId(value))
  @IsString()
  @Length(1, 160)
  @Matches(LOCAL_REF)
  id!: string;
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

  @ApiProperty({ description: "Ключ стопки" })
  @Matches(LANE)
  lane!: string;

  @ApiPropertyOptional({ type: [DeskRefDto], maxItems: 30 })
  @ValidateIf(submitted)
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique((ref: DeskRefDto | null) => ref?.of + ':' + ref?.id)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => DeskRefDto)
  refs?: DeskRefDto[];

  @ApiPropertyOptional({ format: "date-time", description: "Личная задача в корзине" })
  @ValidateIf(submitted)
  @IsDateString({ strict: true, strictSeparator: true })
  deletedAt?: string;

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

  @ApiPropertyOptional({ description: 'Личная отметка завершения карточки на рабочем столе' })
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

  @ApiPropertyOptional({ type: [DeskLaneDto], minItems: 1, maxItems: 9 })
  @ValidateIf(submitted)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @ArrayUnique((lane: DeskLaneDto | null) => lane?.key)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => DeskLaneDto)
  lanes?: DeskLaneDto[];

  @ApiProperty({ type: [DeskCardDto], maxItems: 660 })
  @IsArray()
  @ArrayMaxSize(660)
  @ArrayUnique((card: DeskCardDto | null) =>
    typeof card?.of === 'string' && typeof card.id === 'string' ? card.of + ':' + card.id : card)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => DeskCardDto)
  items!: DeskCardDto[];
}

function deskRef(of: DeskRef["of"], id: string): DeskRef {
  const group = of === 'salesorders' && id.length <= 50 && id.trim() === id && id !== '.' && id !== '..' && !id.includes('://');
  const customer = of === 'partners' && id.startsWith('c:') && id.length > 2 && id.trim() === id;
  if (!OBJECT_ID.test(id) && !group && !customer) throw new BadRequestException('Недопустимый идентификатор карточки');
  return { of, id };
}

function deskCard(dto: DeskCardDto): DeskCard {
  const { of, id, lane, tasks, title, due, done, refs, deletedAt } = dto;
  const base = { id, lane, ...(tasks?.length ? { tasks: tasks.map((task) => ({ ...task })) } : {}) };
  if (of === 'personal') {
    if (!UUID_V4.test(id) || !title || typeof done !== 'boolean') {
      throw new BadRequestException('У личной задачи должны быть свой идентификатор, название и отметка готовности');
    }
    return { ...base, of, title, ...(due ? { due } : {}), done,
      ...(refs?.length ? { refs: refs.map((ref) => deskRef(ref.of, ref.id)) } : {}),
      ...(deletedAt ? { deletedAt } : {}),
    };
  }
  if (refs !== undefined || deletedAt !== undefined) {
    throw new BadRequestException('Вложения и корзина доступны для личной задачи');
  }
  if (title !== undefined || due !== undefined) {
    throw new BadRequestException('Название и срок записи задаются в её исходной карточке');
  }
  deskRef(of, id);
  return { ...base, of, ...(done === undefined ? {} : { done }) };
}

/** Проверить поля, зависящие от типа карточки, и сохранить только канонические свойства. */
export function toDeskLayout(dto: DeskLayoutDto): DeskLayout {
  const lanes = dto.lanes?.map(({ key, title }) => ({ key, title }));
  if (lanes && new Set(lanes.map(({ title }) => title.toLocaleLowerCase("ru"))).size !== lanes.length) {
    throw new BadRequestException('Названия стопок должны различаться');
  }
  const keys = new Set(lanes?.map(({ key }) => key));
  const items = dto.items.map(deskCard);
  const deleted = items.filter((item) => item.of === 'personal' && item.deletedAt).length;
  if (deleted > 600 || items.length - deleted > 60) throw new BadRequestException('Превышен лимит карточек рабочего стола');
  if (lanes && items.some(({ lane }) => !keys.has(lane))) {
    throw new BadRequestException('Не найдена стопка карточки');
  }
  return { version: dto.version, items, ...(lanes ? { lanes } : {}) };
}
