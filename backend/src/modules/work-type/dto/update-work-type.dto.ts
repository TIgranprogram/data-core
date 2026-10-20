import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsNumber, Min } from 'class-validator';
import { CreateWorkTypeDto } from './create-work-type.dto';

/**
 * TZ-COST-301 — `hourlyRate` остаётся обязательным и на PATCH
 * (в т.ч. toggle isActive шлёт текущую ставку).
 */
export class UpdateWorkTypeDto extends PartialType(
  OmitType(CreateWorkTypeDto, ['hourlyRate'] as const),
) {
  @IsNumber()
  @Min(0)
  hourlyRate!: number;
}
