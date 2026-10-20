import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CreatePersonDto {
  /** TZ-PARTY-305: фамилия необязательна. */
  @IsOptional()
  @IsString()
  @Length(0, 64)
  lastName?: string;

  @IsString()
  @Length(1, 64)
  firstName!: string;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  patronymic?: string;

  @IsOptional()
  @IsString()
  @Length(0, 32)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  position?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;
}
