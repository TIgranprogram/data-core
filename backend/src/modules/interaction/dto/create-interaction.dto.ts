import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDate,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateInteractionDto {
  @IsMongoId()
  counterpartyId!: string;

  @IsIn(['call', 'email', 'meeting', 'chat', 'task', 'note'])
  type!: 'call' | 'email' | 'meeting' | 'chat' | 'task' | 'note';

  @IsString()
  @Length(1, 4000)
  description!: string;

  @IsOptional()
  @IsIn(['inbound', 'outbound'])
  direction?: 'inbound' | 'outbound';

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;

  @IsOptional() @IsMongoId() relatedToId?: string;
  @IsOptional() @IsString() relatedToType?: string;

  @IsOptional() @IsString() @Length(0, 1000) outcome?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  tags?: string[];
}
