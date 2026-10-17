import { PartialType } from '@nestjs/mapped-types';
import { CreateOrderTaskDto } from './create-order-task.dto';

export class UpdateOrderTaskDto extends PartialType(CreateOrderTaskDto) {}
