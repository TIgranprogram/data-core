import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { IsINN } from '../../../common/validators/inn.validator';

export class CreateCounterpartyDto {
  @IsString()
  @Length(1, 256)
  name!: string;

  @IsOptional() @IsString() @Length(0, 128) shortName?: string;
  @IsOptional() @IsString() legalForm?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roles!: string[];

  @IsINN()
  inn!: string;

  @IsOptional() @IsString() @Length(0, 16) kpp?: string;
  @IsOptional() @IsString() @Length(0, 16) ogrn?: string;

  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() @Length(9, 9) bankBik?: string;
  @IsOptional() @IsString() @Length(0, 32) bankAccount?: string;
  @IsOptional() @IsString() @Length(0, 32) bankCorrAccount?: string;

  @IsOptional() @IsString() signerName?: string;
  @IsOptional() @IsString() signerPosition?: string;

  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional() @IsArray() @IsString({ each: true }) type?: string[];
  @IsOptional() @IsIn(['ooo', 'ip', 'pao', 'ao', 'other'])
  legalType?: 'ooo' | 'ip' | 'pao' | 'ao' | 'other';

  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() directorName?: string;
  @IsOptional() @IsString() @Length(0, 32) phone?: string;

  /** TZ-MIG-304: optional firm email; not unique across counterparties. */
  @IsOptional()
  @IsEmail()
  @Length(0, 256)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || undefined : value,
  )
  email?: string;

  @IsOptional() @Type(() => Date) @IsDate() registrationDate?: Date;
  @IsOptional() @IsArray() @IsString({ each: true }) partyTypes?: string[];

  @IsOptional() @IsMongoId() contactPersonId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) vatRate?: number;

  @IsOptional() @IsMongoId() organizationId?: string;

  @IsOptional() @IsBoolean() isSystem?: boolean;
}
