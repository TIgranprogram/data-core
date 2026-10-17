import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkCenterDto } from './create-work-center.dto';

export class UpdateWorkCenterDto extends PartialType(CreateWorkCenterDto) {}
