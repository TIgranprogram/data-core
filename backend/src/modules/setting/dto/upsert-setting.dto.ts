import { IsOptional, IsString } from 'class-validator';

export class UpsertSettingDto {
  value!: unknown;

  @IsOptional()
  @IsString()
  group?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
