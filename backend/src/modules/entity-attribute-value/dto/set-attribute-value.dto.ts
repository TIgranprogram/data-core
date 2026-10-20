import { IsNotEmpty } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class SetAttributeValueDto {
  @IsNotEmpty()
  @IsObjectId()
  attributeId!: string;

  /** Free-form: validated by EavService per type. */
  value!: unknown;
}
