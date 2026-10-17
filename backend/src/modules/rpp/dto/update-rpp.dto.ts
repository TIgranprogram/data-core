import { PartialType } from '@nestjs/mapped-types';
import { CreateRppDto } from './create-rpp.dto';

export class UpdateRppDto extends PartialType(CreateRppDto) {}
