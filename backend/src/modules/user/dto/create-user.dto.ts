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

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && !value.trim() ? undefined : value;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateUserDto {
  @ApiProperty({ example: 'ivan_petrov', description: 'Логин (латиница, цифры, _ . -), уникальный' })
  @Transform(trimLower)
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
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    return value.trim().toLowerCase();
  })
  @IsEmail({}, { message: 'Некорректный email' })
  email?: string;

  @ApiPropertyOptional({
    example: 'Иван Петров',
    description: 'ФИО (необязательно; если пусто — подставится логин)',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'ФИО должно быть текстом' })
  @Length(1, 128, { message: 'ФИО: от 1 до 128 символов' })
  displayName?: string;

  @ApiProperty({ description: 'Пароль (минимум 8 символов)' })
  @IsString({ message: 'Пароль обязателен' })
  @Length(8, 128, { message: 'Пароль должен быть не короче 8 символов' })
  password!: string;

  @ApiProperty({ enum: ['user', 'manager', 'admin'], description: 'Роль пользователя' })
  @IsIn(['user', 'manager', 'admin'], { message: 'Недопустимая роль' })
  role!: string;

  @ApiPropertyOptional({ type: [String], description: 'Разрешения' })
  @IsOptional()
  @IsArray({ message: 'Разрешения должны быть списком' })
  @IsString({ each: true, message: 'Каждое разрешение должно быть текстом' })
  permissions?: string[];

  @ApiPropertyOptional({ description: 'Активен ли пользователь' })
  @IsOptional()
  @IsBoolean({ message: 'Поле «Активен» должно быть да/нет' })
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Телефон' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Полное имя' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ description: 'Organization ID (TZ-238)' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}
