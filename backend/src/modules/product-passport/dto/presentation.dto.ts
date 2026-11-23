import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsIn, IsMongoId, IsObject, IsOptional, ValidateIf } from 'class-validator';
import { PASSPORT_VARIANTS, type PassportVariant } from '../passport-variants';

export class PassportTemplateQueryDto {
  @ApiPropertyOptional({ enum: PASSPORT_VARIANTS, default: 'short' })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(PASSPORT_VARIANTS)
  variant?: PassportVariant;
}

export class PassportPresentationDto extends PassportTemplateQueryDto {
  @ApiPropertyOptional({ enum: [1] })
  @ValidateIf((_, v) => v !== undefined)
  @Equals(1)
  presentationVersion?: 1;
}

export class PassportOrderQueryDto extends PassportPresentationDto {
  @Type(() => Number)
  declare presentationVersion?: 1;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  supplierOrgId?: string;
}

const EXERCISE_SCHEMA = { type: 'object' as const, nullable: true, additionalProperties: false, required: ['initialPosition', 'movement', 'muscles'], properties: { initialPosition: { type: 'string' as const }, movement: { type: 'string' as const }, muscles: { type: 'string' as const } }, description: 'Необязательный блок упражнения: три непустые plain-text части, суммарно ≤4000 после CRLF→LF и trim; null удаляет только блок.' };

export class PatchPassportTemplateDto {
  @ApiProperty({
    type: 'object', additionalProperties: true, properties: { exerciseInstructions: EXERCISE_SCHEMA },
    description: 'Собственные поля для записи. simpleDescription: {mode:"parts",partIds:[...]} для сборки из частей, {text,partIds} или {mode:"manual",text,partIds} для своего текста, null для сброса.',
    example: { simpleDescription: { mode: 'parts', partIds: ['6537c21dd0f2c297559c4394'] } },
  })
  @IsObject()
  changes!: Record<string, unknown>;

  @ApiProperty({
    type: 'object', additionalProperties: true, properties: { exerciseInstructions: EXERCISE_SCHEMA },
    description: 'Прежние собственные значения с теми же ключами. exerciseInstructions передаётся целиком без изменения строк baseline или null при отсутствии; CAS сравнивает весь блок, stale409. simpleDescription передаётся целиком из defaults или как null, если поле отсутствует.',
    example: { simpleDescription: null },
  })
  @IsObject()
  expected!: Record<string, unknown>;
}
