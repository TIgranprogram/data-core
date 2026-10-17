import { PartialType } from '@nestjs/mapped-types';
import { CreateDocumentTableTypeDto } from './create-document-table-type.dto';

export class UpdateDocumentTableTypeDto extends PartialType(CreateDocumentTableTypeDto) {}
