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
  Min, IsMongoId } from 'class-validator';
import { APP_SECTION_IDS } from '../../../common/app-sections';
import { BASE_ROLES } from '../../../common/roles-hierarchy';

export class CreateRoleDto {
  /**
   * Код роли. SK-8c: через POST /api/roles не передаётся — код своей роли
   * (`r-…`) задаёт сервер; менять код нельзя. Поле осталось для сидов и
   * /api/admin/roles (владелец).
   */
  @ApiPropertyOptional({ example: 'r-1a2b3c', description: 'Код роли: задаёт сервер при создании, менять нельзя' })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  @Matches(/^[a-z][a-z0-9_-]*$/, {
    message: 'name must be lowercase, start with a letter, and use only a-z, 0-9, _, -',
  })
  name?: string;

  @ApiProperty({ example: 'Менеджер', description: 'Отображаемое название роли' })
  @IsString({ message: 'Название роли — текст' })
  @Length(2, 128, { message: 'Название роли: от 2 до 128 символов' })
  label!: string;

  @ApiPropertyOptional({ description: 'Описание роли' })
  @IsOptional()
  @IsString()
  @Length(0, 512)
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Список разрешений (например orders.create); у своей роли права берутся от baseRole' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];

  /** SK-8c: «права как у» — встроенная роль, на которую опирается своя (не admin). */
  @ApiProperty({ enum: BASE_ROLES, description: 'Права как у: user | manager | accountant | director (обязателен при создании; в PATCH необязателен)' })
  @IsIn(BASE_ROLES as unknown as string[], { message: '«Права как у»: выберите наблюдателя, менеджера, бухгалтера или директора' })
  baseRole?: string; // тип необязателен (сиды встроенных ролей), но валидатор требует при создании

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

  /** СМ.4: категории склада роли; пусто — весь склад. */
  @ApiPropertyOptional({ type: [String], description: 'Категории склада, которые видит и меняет роль; пусто — весь склад' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50, { message: 'Категорий не больше 50' })
  @ArrayUnique({ message: 'Категория указана дважды' })
  @IsMongoId({ each: true, message: 'Некорректная категория' })
  stockCategoryIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Системная роль (нельзя удалить)' })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}
