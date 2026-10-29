import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Коды готовых аватаров (планеты и др.). */
export const AVATAR_PRESETS = ['saturn', 'uranus', 'moon', 'sun', 'earth', 'mars', 'jupiter', 'neptune', 'comet', 'galaxy'] as const;

/**
 * PATCH /api/auth/me — свой профиль. Белый список: роль, логин, пароль сюда не попадают
 * (forbidNonWhitelisted → 400). Все поля необязательны.
 */
export class ProfileDto {
  @ApiPropertyOptional({ maxLength: 80, description: 'Имя для показа' })
  @IsOptional() @IsString() @MinLength(1, { message: 'Имя не может быть пустым' }) @MaxLength(80, { message: 'Имя — не длиннее 80 знаков' })
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 30, description: 'Телефон; пустая строка — очистить' })
  @IsOptional() @IsString() @MaxLength(30, { message: 'Телефон — не длиннее 30 знаков' })
  phone?: string;

  @ApiPropertyOptional({ example: 'preset:saturn', description: 'preset:<код> (saturn, uranus, moon, sun, earth, mars, jupiter, neptune, comet, galaxy) или photo:<photoId>; пустая строка — убрать' })
  @IsOptional() @IsString()
  @Matches(new RegExp(`^(|preset:(${AVATAR_PRESETS.join('|')})|photo:[0-9a-f]{24})$`), { message: 'Аватар: preset:<код из списка> или photo:<id фото>' })
  avatar?: string;
}
