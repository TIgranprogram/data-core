import { IsDateString, IsOptional, IsString } from 'class-validator';

export class SignActDto {
  @IsDateString()
  signDate!: string;

  @IsOptional() @IsString() fileUrl?: string;
}
