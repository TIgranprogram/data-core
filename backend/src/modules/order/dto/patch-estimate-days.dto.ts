import { Transform, Type } from 'class-transformer';
import { IsInt, IsMongoId, Min, ValidateIf } from 'class-validator';

/**
 * TZ-PRODUCTION-309 — PATCH /orders/:id/estimate-days
 * `days: null` clears the override (return to WorkType catalog days).
 */
export class PatchEstimateDaysDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderItemIndex!: number;

  @IsMongoId()
  moduleId!: string;

  @IsMongoId()
  workTypeId!: string;

  /** Positive days upsert; null removes override. Omitted → validation fail. */
  @Transform(({ value }: { value: unknown }) => {
    if (value === null) return null;
    if (value === undefined) return undefined;
    return Number(value);
  })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  days!: number | null;
}
