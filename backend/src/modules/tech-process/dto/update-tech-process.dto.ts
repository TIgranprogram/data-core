import { PartialType } from '@nestjs/mapped-types';
import { CreateTechProcessDto } from './create-tech-process.dto';

export class UpdateTechProcessDto extends PartialType(CreateTechProcessDto) {}
