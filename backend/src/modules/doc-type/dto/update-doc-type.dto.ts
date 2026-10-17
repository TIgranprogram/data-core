import { PartialType } from '@nestjs/mapped-types';
import { CreateDocTypeDto } from './create-doc-type.dto';

export class UpdateDocTypeDto extends PartialType(CreateDocTypeDto) {}
