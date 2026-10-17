import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsHexColor, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * TZ-PRODUCTS-301 — Create DTO for color references.
 *
 * Whitelist-only: the global ValidationPipe strips unknown fields, so any
 * future payload must be added here explicitly. `organizationId` is NOT
 * accepted from the client — it is derived from the authenticated user
 * (controller) so a user can never create a color in a foreign scope.
 *
 * `slug` is OPTIONAL: when omitted the server generates it from `name`
 * (Russian→Latin transliteration, kebab-case) — see
 * `ColorReferenceService.slugify`. Clients that want a custom stable key
 * may still send one (validated `[a-z0-9-]+`).
 *
 * `hex` is OPTIONAL and validated as `#RRGGBB` via class-validator
 * `@IsHexColor()` (TZ-PRODUCTS-301 — 400 on invalid hex).
 */
export class CreateColorReferenceDto {
  @ApiProperty({ example: 'RAL 9003 — Сигнальный белый', description: 'Название цвета' })
  @IsString()
  @Length(1, 128)
  name!: string;

  @ApiPropertyOptional({
    example: 'ral-9003-signalny-belyy',
    description: 'Slug (строчные, a-z, 0-9, -). Необязателен — сервер сгенерирует из name',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase, a-z, 0-9, -' })
  slug?: string;

  @ApiPropertyOptional({ example: '#F4F4F4', description: 'Swatch #RRGGBB (необязательно)' })
  @IsOptional()
  @IsHexColor({ message: 'hex must be a valid #RRGGBB color' })
  hex?: string;

  @ApiPropertyOptional({ description: 'Описание цвета' })
  @IsOptional()
  @IsString()
  @Length(0, 512)
  description?: string;

  @ApiPropertyOptional({ description: 'Активен ли цвет' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Цвет по умолчанию («Не выбран»)' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
