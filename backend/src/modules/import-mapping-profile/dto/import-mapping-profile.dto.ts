import { Type } from 'class-transformer';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { IMPORT_MAPPING_TARGETS } from '../import-mapping-profile.schema';

export class ImportMappingTableDto {
  @ApiProperty({ enum: IMPORT_MAPPING_TARGETS })
  @IsIn(IMPORT_MAPPING_TARGETS as unknown as string[])
  targetEntity!: (typeof IMPORT_MAPPING_TARGETS)[number];

  @ApiProperty({ example: { Артикул: 'article', Наименование: 'name' } })
  @IsObject()
  columnMap!: Record<string, string | null>;
}

export class CreateImportMappingProfileDto {
  @ApiProperty({ example: 'Спецификация из SolidWorks' })
  @IsString()
  @Length(1, 120)
  name!: string;

  /** Мульти-табличный профиль (основной путь). */
  @ApiPropertyOptional({
    type: [ImportMappingTableDto],
    description: 'Таблицы профиля: каждая — целевая сущность + карта колонок.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportMappingTableDto)
  tables?: ImportMappingTableDto[];

  /** Легаси: одиночная таблица (старые клиенты). */
  @ApiPropertyOptional({ example: { Артикул: 'article', Наименование: 'name' } })
  @IsOptional()
  @IsObject()
  columnMap?: Record<string, string | null>;

  @ApiPropertyOptional({ enum: IMPORT_MAPPING_TARGETS, default: 'material' })
  @IsOptional()
  @IsIn(IMPORT_MAPPING_TARGETS as unknown as string[])
  targetEntity?: (typeof IMPORT_MAPPING_TARGETS)[number];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateImportMappingProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ type: [ImportMappingTableDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportMappingTableDto)
  tables?: ImportMappingTableDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  columnMap?: Record<string, string | null>;

  @ApiPropertyOptional({ enum: IMPORT_MAPPING_TARGETS })
  @IsOptional()
  @IsIn(IMPORT_MAPPING_TARGETS as unknown as string[])
  targetEntity?: (typeof IMPORT_MAPPING_TARGETS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
