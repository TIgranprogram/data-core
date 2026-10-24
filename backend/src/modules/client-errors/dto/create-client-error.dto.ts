import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { CLIENT_ERROR_KINDS, type ClientErrorKind } from '../client-error.schema';

/** Строку — обрезать до max (не отказывать: отчёт об ошибке важнее точной длины); не строку — оставить валидатору. */
const cut = (max: number) =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.slice(0, max) : value));

/** Путь без query/hash, затем обрезка. */
const cutPath = (max: number) =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(/[?#]/)[0].slice(0, max) : value,
  );

/**
 * ОШ2.1 — тело `POST /api/client-errors`. Данных форм нет и не принимается:
 * лишние поля → 400 (общий ValidationPipe с forbidNonWhitelisted).
 */
export class CreateClientErrorDto {
  @ApiProperty({ maxLength: 500, description: 'Текст ошибки (длиннее — обрезается)' })
  @cut(500)
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({ maxLength: 100, example: 'TypeError' })
  @IsOptional()
  @cut(100)
  @IsString()
  name?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @cut(4000)
  @IsString()
  stack?: string;

  @ApiPropertyOptional({ maxLength: 60, example: '#passports', description: 'Раздел приложения' })
  @IsOptional()
  @cut(60)
  @IsString()
  section?: string;

  @ApiPropertyOptional({ maxLength: 120, example: 'Сохранить паспорт', description: 'Что делал человек' })
  @IsOptional()
  @cut(120)
  @IsString()
  action?: string;

  @ApiProperty({ enum: CLIENT_ERROR_KINDS, description: 'action — действие человека, background — фоновая загрузка, unhandled — необработанная' })
  @IsIn(CLIENT_ERROR_KINDS as unknown as string[])
  kind!: ClientErrorKind;

  @ApiPropertyOptional({ example: 500, description: 'HTTP-код, если ошибка запроса' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  status?: number;

  @ApiPropertyOptional({ maxLength: 200, example: '/api/passports', description: 'Путь API (query отрезается)' })
  @IsOptional()
  @cutPath(200)
  @IsString()
  url?: string;

  @ApiPropertyOptional({ maxLength: 40, description: 'Версия приложения' })
  @IsOptional()
  @cut(40)
  @IsString()
  version?: string;

  @ApiPropertyOptional({ maxLength: 300, description: 'User-Agent' })
  @IsOptional()
  @cut(300)
  @IsString()
  ua?: string;
}
