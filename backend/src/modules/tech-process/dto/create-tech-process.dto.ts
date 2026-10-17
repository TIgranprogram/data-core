import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

class TechProcessOperationDto {
  @IsNumber()
  @Min(1)
  sequence!: number;

  @IsObjectId()
  workTypeId!: string;

  @IsNumber()
  @Min(0)
  durationHours!: number;

  @IsObjectId()
  workCenterId!: string;
}

export class CreateTechProcessDto {
  @IsObjectId()
  productId!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TechProcessOperationDto)
  operations?: TechProcessOperationDto[];

  @IsOptional() @IsBoolean() isActive?: boolean;
}
