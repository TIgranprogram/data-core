import { PartialType } from '@nestjs/mapped-types';
import { CreateStorageItemDto } from './create-storage-item.dto';

export class UpdateStorageItemDto extends PartialType(CreateStorageItemDto) {}
