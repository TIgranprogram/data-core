import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { APP_SECTION_IDS } from '../../../common/app-sections';

export class CreateRoleDto {
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

  @ApiPropertyOptional({ description: 'Порядок сортировки' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [String], description: 'ID разделов' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sectionIds?: string[];

  @ApiPropertyOptional({ description: 'Активна ли роль' })
  /** TZ-ACCESS-301: page ACL — visible nav pages for this role. */
  @ApiPropertyOptional({ type: [String], description: "Страницы, доступные роли (page ACL)" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pages?: string[];

  /** SK-8a: разделы «Рабочего места», видимые роли; пусто — как раньше (по иерархии). */
  @ApiPropertyOptional({ type: [String], enum: APP_SECTION_IDS, description: 'Разделы «Рабочего места», которые видит роль; пусто — по иерархии роли' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30, { message: 'Разделов не больше 30' })
  @ArrayUnique({ message: 'Раздел указан дважды' })
  @IsIn(APP_SECTION_IDS, { each: true, message: `Неизвестный раздел. Допустимо: ${APP_SECTION_IDS.join(', ')}` })
  appSections?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Системная роль (нельзя удалить)' })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}
