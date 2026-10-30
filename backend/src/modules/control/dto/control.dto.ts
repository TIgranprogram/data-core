import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** Хвост вывода шага — не больше 4 КБ: длиннее обрезается с начала (важен конец). */
export const STEP_TAIL_MAX = 4096;
export const RUN_STEPS_MAX = 30;

const tailOnly = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.slice(-STEP_TAIL_MAX) : value));

/** Шаг прогона — как его пишет tools/night.mjs (`makeStep`). */
export class RunStepDto {
  @ApiProperty({ example: 'unit' }) @IsString() @IsNotEmpty() @MaxLength(40)
  step!: string;

  @ApiProperty() @IsInt() @Min(-1) @Max(1000)
  code!: number;

  @ApiProperty({ description: 'Длительность шага, мс' }) @IsInt() @Min(0) @Max(86_400_000)
  ms!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  commit?: string;

  @ApiProperty() @IsBoolean()
  ok!: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  timedOut?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Сигнатура провала «шаг:хеш»; у зелёного шага null' })
  @IsOptional() @IsString() @MaxLength(200)
  signature?: string | null;

  @ApiPropertyOptional({ maxLength: STEP_TAIL_MAX, description: 'Хвост вывода (последние 4 КБ)' })
  @IsOptional() @tailOnly @IsString()
  tail?: string;
}

/** Тело `POST /api/control/runs` — это summary.json ночного прогона целиком (+ необязательное `node`). */
export class CreateRunDto {
  @ApiProperty({ example: '2026-10-31T01:00:00.000Z', description: 'Когда начался прогон (ISO)' })
  @IsString() @MaxLength(40)
  date!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  commit?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  quick?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(172_800_000)
  durationMs?: number;

  @ApiProperty() @IsInt() @Min(0) @Max(1000) total!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1000) green!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1000) red!: number;

  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(RUN_STEPS_MAX) @IsString({ each: true }) @MaxLength(40, { each: true })
  failed!: string[];

  @ApiProperty({ type: [RunStepDto] }) @IsArray() @ArrayMaxSize(RUN_STEPS_MAX) @ValidateNested({ each: true }) @Type(() => RunStepDto)
  steps!: RunStepDto[];

  @ApiPropertyOptional({ example: 'home-pc', description: 'Какой компьютер гонял (по умолчанию «pc»)' })
  @IsOptional() @IsString() @MaxLength(60)
  node?: string;
}

/** Параметры списков: `?from&to` (ГГГГ-ММ-ДД для /daily, ГГГГ-ММ для /monthly), `page`, `limit`. */
export class ControlRangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10)
  from?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10)
  to?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number;
}
