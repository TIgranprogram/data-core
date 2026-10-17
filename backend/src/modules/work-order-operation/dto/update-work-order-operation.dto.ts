import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkOrderOperationDto } from './create-work-order-operation.dto';

export class UpdateWorkOrderOperationDto extends PartialType(CreateWorkOrderOperationDto) {}
