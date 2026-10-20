import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';
import { ToObjectId } from '../../../common/decorators/to-object-id.decorator';

export class CreateWorkTypeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional() @IsString() section?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) defaultDurationHours?: number;
  /** TZ-COST-301 — обязательная расценка ₽/час (≥ 0; 0 = явно бесплатно). */
  @Type(() => Number)
  @IsNumber() @Min(0) hourlyRate!: number;

  /**
   * TZ-PRODUCTION-302 — Calendar days for Gantt estimation.
   * >0 required when present; null/absent allowed (stuck path).
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) days?: number | null;
  /** Gantt accent hue 0–359; null clears to auto. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(359) accentHue?: number | null;
  @IsOptional() @IsObjectId() @ToObjectId() workCenterId?: string;
}
