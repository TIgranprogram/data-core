import { PartialType } from '@nestjs/mapped-types';
import { CreateCostCalculationDto } from './create-cost-calculation.dto';

export class UpdateCostCalculationDto extends PartialType(CreateCostCalculationDto) {}
