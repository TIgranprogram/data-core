import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, IsMongoId, Min } from 'class-validator';

/**
 * TZ-NX-GANTT-G14 — PATCH /orders/:id/estimate-worker
 * `workerIds: []` clears the override (Gantt falls back to «Не назначен», not skills).
 */
export class PatchEstimateWorkerDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderItemIndex!: number;

  @IsMongoId()
  moduleId!: string;

  @IsMongoId()
  workTypeId!: string;

  /** Empty array clears the override. Omitted → validation fail (explicit empty array to clear). */
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  workerIds!: string[];
}
