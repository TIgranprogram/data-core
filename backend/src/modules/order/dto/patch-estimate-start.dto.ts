import { Transform, Type } from 'class-transformer';
import { IsInt, IsMongoId, Min, ValidateIf } from 'class-validator';

/**
 * TZ-PRODUCTION-316 — PATCH /orders/:id/estimate-start
 * `offsetDays: null` clears the override (bar returns to sequential pack).
 */
export class PatchEstimateStartDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderItemIndex!: number;

  @IsMongoId()
  moduleId!: string;

  @IsMongoId()
  workTypeId!: string;

  /** Days ≥ 0 from visualAnchor; null removes override. */
  @Transform(({ value }: { value: unknown }) => {
    if (value === null) return null;
    if (value === undefined) return undefined;
    return Number(value);
  })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  offsetDays!: number | null;
}
