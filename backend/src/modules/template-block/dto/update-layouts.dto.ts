import { ArrayNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsObjectId as IsObjectIdCustom } from '../../../common/decorators/is-object-id.decorator';
import { BlockLayoutDto } from './create-template-block.dto';

export class TemplateBlockLayoutUpdateDto {
  @IsObjectIdCustom()
  blockId!: string;

  @ValidateNested()
  @Type(() => BlockLayoutDto)
  layout!: BlockLayoutDto;
}

export class UpdateTemplateBlockLayoutsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TemplateBlockLayoutUpdateDto)
  updates!: TemplateBlockLayoutUpdateDto[];
}
