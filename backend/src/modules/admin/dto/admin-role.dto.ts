import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * TZ-257.B — admin-whitelisted role DTOs.
 *
 * These are the ONLY shapes accepted by `/api/admin/roles` mutations.
 * They deliberately exclude `isSystem`, `sortOrder`, `sectionIds` and
 * `isActive` — internal fields the admin surface must never accept from
 * the client. Combined with the global `ValidationPipe({ whitelist: true,
 * forbidNonWhitelisted: true })`, any attempt to smuggle `isSystem: true`
 * (or any other non-whitelisted key) in a body is rejected with 400
 * BEFORE it reaches the controller/guard layer (defence in depth on top
 * of SystemRoleGuard's `SYSTEM_ROLE_ESCALATION`).
 *
 * Admin UI contract (role-form-dialog): create sends
 * `{ name, label, description?, permissions, pages? }`; edit sends
 * `{ label, description?, permissions, pages? }` — the dialog locks `name` on
 * edit, so renames are intentionally not offered on the admin surface
 * (the legacy `/api/roles` PATCH retains rename support for API users).
 * TZ-ADMIN-301: `pages` is the nav pageKey ACL (Клиенты / Снабжение / …).
 */
export class AdminCreateRoleDto {
  @ApiProperty({ example: 'manager', description: 'Системное имя роли (строчные, a-z, 0-9, _, -)' })
  @IsString()
  @Length(2, 64)
  @Matches(/^[a-z][a-z0-9_-]*$/, {
    message: 'name must be lowercase, start with a letter, and use only a-z, 0-9, _, -',
  })
  name!: string;

  @ApiProperty({ example: 'Менеджер', description: 'Отображаемое название роли' })
  @IsString()
  @Length(2, 128)
  label!: string;

  @ApiPropertyOptional({ description: 'Описание роли' })
  @IsOptional()
  @IsString()
  @Length(0, 512)
  description?: string;

  @ApiProperty({ type: [String], description: 'Список разрешений (например orders.create)' })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Page ACL — visible nav pageKeys (counterparties, supply, …)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  pages?: string[];
}

export class AdminUpdateRoleDto {
  @ApiPropertyOptional({ description: 'Отображаемое название роли' })
  @IsOptional()
  @IsString()
  @Length(2, 128)
  label?: string;

  @ApiPropertyOptional({ description: 'Описание роли' })
  @IsOptional()
  @IsString()
  @Length(0, 512)
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Список разрешений (например orders.create)' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Page ACL — visible nav pageKeys (counterparties, supply, …)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  pages?: string[];
}
