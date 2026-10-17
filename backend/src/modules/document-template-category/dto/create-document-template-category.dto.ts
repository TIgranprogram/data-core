import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

/**
 * TZ-DOC-307 — Create DTO for document-template categories.
 *
 * Whitelist-only: the global ValidationPipe strips unknown fields, so any
 * future payload must be added here explicitly. `organizationId` is NOT
 * accepted from the client — it is derived from the authenticated user
 * (controller) so a user can never create a category in a foreign scope.
 *
 * `slug` is OPTIONAL: when omitted the server generates it from `name`
 * (Russian→Latin transliteration, kebab-case) — see
 * `DocumentTemplateCategoryService.slugify`. Clients that want a custom
 * stable key may still send one (validated `[a-z0-9-]+`).
 */
export class CreateDocumentTemplateCategoryDto {
  @ApiProperty({ example: 'Коммерческие предложения', description: 'Название категории' })
  @IsString()
  @Length(1, 128)
  name!: string;

  @ApiPropertyOptional({ example: 'commercial-proposals', description: 'Slug (строчные, a-z, 0-9, -). Необязателен — сервер сгенерирует из name' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase, a-z, 0-9, -' })
  slug?: string;

  @ApiPropertyOptional({ description: 'Описание категории' })
  @IsOptional()
  @IsString()
  @Length(0, 512)
  description?: string;

  @ApiPropertyOptional({ description: 'Активна ли категория' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Категория по умолчанию для новых шаблонов' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Порядок сортировки' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
