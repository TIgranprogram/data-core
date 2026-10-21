import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'ivan_petrov', description: 'Логин (уникальный)' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: 'Логин обязателен' })
  @Length(3, 64, { message: 'Логин должен быть от 3 до 64 символов' })
  @Matches(/^[a-z0-9_.-]+$/, {
    message: 'Логин: только латиница, цифры и символы _ . -',
  })
  username!: string;

  @ApiPropertyOptional({
    example: 'ivan@example.com',
    description: 'Email (необязательно)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && !value.trim() ? undefined : value,
  )
  @IsEmail({}, { message: 'Некорректный email' })
  email?: string;

  @ApiPropertyOptional({
    example: 'Иван Петров',
    description: 'ФИО (необязательно; если пусто — подставится логин)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && !value.trim() ? undefined : value,
  )
  @IsString({ message: 'ФИО должно быть текстом' })
  @Length(1, 128, { message: 'ФИО: от 1 до 128 символов' })
  displayName?: string;

  @ApiProperty({ description: 'Пароль (минимум 8 символов)' })
  @IsString({ message: 'Пароль обязателен' })
  @Length(8, 128, { message: 'Пароль должен быть не короче 8 символов' })
  password!: string;

  /**
   * Role whitelist: only 'user' or 'manager' allowed via public POST /auth/register.
   * 'admin' role is NEVER accepted from public API (created only via DB seed in
   * `backend/src/common/seed/admin.seed.ts` or future TZ-91-extension invite-flow).
   *
   * TZ-91 §2 Decision 1 + §4 Phase A.1. DTO-level constraint is defense-in-depth:
   * even if controller-level guard is missing, no admin account can be created via /register.
   *
   * TZ-95 §4: @Transform applies the schema-boundary default ('user') BEFORE
   * class-validator runs. This makes the default explicit at the validation
   * layer (not magic in service-side `?? 'user'`). If the caller doesn't pass
   * `role`, the DTO fills in 'user' and IsIn(['user','manager']) passes.
   * If the caller passes a non-whitelisted role, IsIn rejects with 400.
   */
  @ApiPropertyOptional({ enum: ['user', 'manager'], default: 'user', description: 'Роль пользователя' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): string => (value == null ? 'user' : (value as string)))
  @IsIn(['user', 'manager'])
  role?: string;

  @ApiPropertyOptional({ type: [String], description: 'Разрешения' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional({ description: 'Активен ли пользователь' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Телефон' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Полное имя' })
  @IsOptional()
  @IsString()
  fullName?: string;
}
