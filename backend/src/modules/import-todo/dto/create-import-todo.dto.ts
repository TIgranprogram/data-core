import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { IMPORT_TODO_STATUSES } from '../import-todo.schema';

export class CreateImportTodoDto {
  @ApiProperty({ example: 'Проверить сомнительные строки (импорт t.xlsx)' })
  @IsString()
  @Length(1, 256)
  title!: string;

  @ApiPropertyOptional({ example: '3 строки с decision=doubt' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  body?: string;

  @ApiPropertyOptional({ example: '/doc-constructor/templates/507f...' })
  @IsOptional()
  @IsString()
  @Length(0, 1024)
  href?: string;

  @ApiPropertyOptional({ description: 'Связанный ImportTask' })
  @IsOptional()
  @IsMongoId()
  importTaskId?: string;

  @ApiPropertyOptional({ description: 'Черновик шаблона (TZD-28)' })
  @IsOptional()
  @IsMongoId()
  templateId?: string;
}

export class PatchImportTodoDto {
  @ApiProperty({ enum: IMPORT_TODO_STATUSES })
  @IsIn(IMPORT_TODO_STATUSES as unknown as string[])
  status!: (typeof IMPORT_TODO_STATUSES)[number];
}
