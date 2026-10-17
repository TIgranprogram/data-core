import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class UpsertFormProfileDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  visibleFieldKeys!: string[];
}
