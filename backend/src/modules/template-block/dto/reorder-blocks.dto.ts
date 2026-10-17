import { ArrayNotEmpty, IsArray } from 'class-validator';
import { IsObjectId as IsObjectIdCustom } from '../../../common/decorators/is-object-id.decorator';

export class ReorderBlocksDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsObjectIdCustom({ each: true })
  blockIds!: string[];
}
