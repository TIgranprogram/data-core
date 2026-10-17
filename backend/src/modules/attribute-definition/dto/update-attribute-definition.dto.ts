import { PartialType } from '@nestjs/mapped-types';
import { CreateAttributeDefinitionDto } from './create-attribute-definition.dto';

export class UpdateAttributeDefinitionDto extends PartialType(CreateAttributeDefinitionDto) {}
