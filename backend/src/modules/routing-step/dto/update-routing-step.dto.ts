import { PartialType } from '@nestjs/mapped-types';
import { CreateRoutingStepDto } from './create-routing-step.dto';

export class UpdateRoutingStepDto extends PartialType(CreateRoutingStepDto) {}
