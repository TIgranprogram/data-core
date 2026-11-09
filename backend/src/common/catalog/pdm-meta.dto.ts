import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

/** C057: откуда запись и какая версия файла в PDM (детали, модули, изделия). Все поля необязательные. */
export interface PdmMeta {
  fileId?: number;
  version?: number;
  state?: string;
  path?: string;
  configuration?: string;
  syncedAt?: Date | string;
}

export class PdmMetaDto implements PdmMeta {
  @ApiPropertyOptional({ description: 'Номер файла в PDM' }) @IsOptional() @IsInt() @Min(0) fileId?: number;
  @ApiPropertyOptional({ description: 'Версия файла в PDM' }) @IsOptional() @IsInt() @Min(0) version?: number;
  @ApiPropertyOptional({ description: 'Состояние в PDM («Утверждено»…)' }) @IsOptional() @IsString() @Length(0, 128) state?: string;
  @ApiPropertyOptional({ description: 'Путь файла в хранилище PDM' }) @IsOptional() @IsString() @Length(0, 1024) path?: string;
  @ApiPropertyOptional({ description: 'Конфигурация, которую использует родитель' }) @IsOptional() @IsString() @Length(0, 256) configuration?: string;
  @ApiPropertyOptional({ description: 'Когда последний раз загружено из PDM' }) @IsOptional() @IsDateString() syncedAt?: string;
}
