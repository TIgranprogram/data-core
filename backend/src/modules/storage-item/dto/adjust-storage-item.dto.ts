import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class AdjustStorageItemDto {
  @IsNumber()
  delta!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
