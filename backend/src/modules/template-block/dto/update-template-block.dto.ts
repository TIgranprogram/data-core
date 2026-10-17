import { PartialType } from '@nestjs/mapped-types';
import { CreateTemplateBlockDto } from './create-template-block.dto';

export class UpdateTemplateBlockDto extends PartialType(CreateTemplateBlockDto) {}
