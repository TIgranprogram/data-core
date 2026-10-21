import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

export class CreateOrganizationDto {
  @ApiProperty({ example: 'ООО "Ромашка"', description: 'Полное название организации' })
  @IsString()
  @Length(1, 256)
  name!: string;

  @ApiPropertyOptional({ example: 'Ромашка', description: 'Краткое название' })
  @IsOptional()
  @IsString()
  @Length(0, 128)
  shortName?: string;

  @ApiPropertyOptional({ description: 'Организационно-правовая форма' })
  @IsOptional()
  @IsString()
  legalForm?: string;

  @ApiProperty({ example: '7701234567', description: 'ИНН (10 или 12 цифр)' })
  @IsINN()
  inn!: string;

  @ApiPropertyOptional({ example: '770101001', description: 'КПП' })
  @IsOptional()
  @IsString()
  @Length(0, 16)
  kpp?: string;

  @ApiPropertyOptional({ example: '1027700012345', description: 'ОГРН' })
  @IsOptional()
  @IsString()
  @Length(0, 16)
  ogrn?: string;

  @ApiPropertyOptional({ description: 'ОГРНИП' })
  @IsOptional()
  @IsString()
  @Length(0, 16)
  ogrnip?: string;

  @ApiPropertyOptional({ description: 'Название банка' })
  @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional({ example: '044525225', description: 'БИК банка' })
  @IsOptional() @IsString() @Length(9, 9) bankBik?: string;
  @ApiPropertyOptional({ description: 'Расчётный счёт' })
  @IsOptional() @IsString() @Length(0, 32) bankAccount?: string;
  @ApiPropertyOptional({ description: 'Корреспондентский счёт' })
  @IsOptional() @IsString() @Length(0, 32) bankCorrAccount?: string;

  @ApiPropertyOptional({ description: 'ФИО подписанта' })
  @IsOptional() @IsString() signerName?: string;
  @ApiPropertyOptional({ description: 'Должность подписанта' })
  @IsOptional() @IsString() signerPosition?: string;

  @ApiPropertyOptional({ description: 'Срок оплаты (дней)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermDays?: number;
  @ApiPropertyOptional({ description: 'Ставка НДС (%)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) vatRate?: number;
  @ApiPropertyOptional({ description: 'Активна ли организация' })
  @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Типы организации' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  type?: string[];

  @ApiPropertyOptional({
    enum: ['ooo', 'ip', 'pao', 'ao', 'other'],
    description: 'Юридический тип',
  })
  @IsOptional()
  @IsIn(['ooo', 'ip', 'pao', 'ao', 'other'])
  legalType?: 'ooo' | 'ip' | 'pao' | 'ao' | 'other';

  @ApiPropertyOptional({ description: 'Веб-сайт' })
  @IsOptional() @IsString() website?: string;

  @ApiPropertyOptional({ example: 'zakaz@example.ru', description: 'Общая почта организации' })
  @IsOptional() @IsEmail() email?: string;

  @ApiPropertyOptional({ description: 'ФИО директора' })
  @IsOptional() @IsString() directorName?: string;

  @ApiPropertyOptional({ description: 'Дата регистрации' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  registrationDate?: Date;

  @ApiPropertyOptional({ type: [String], description: 'Типы контрагента' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  partyTypes?: string[];

  @ApiPropertyOptional({ description: 'ID контактного лица' })
  @IsOptional() @IsMongoId() contactPersonId?: string;

  @ApiPropertyOptional({ description: 'Серия паспорта' })
  @IsOptional() @IsString() passportSeries?: string;
  @ApiPropertyOptional({ description: 'Номер паспорта' })
  @IsOptional() @IsString() passportNumber?: string;
  @ApiPropertyOptional({ description: 'Кем выдан паспорт' })
  @IsOptional() @IsString() passportIssuedBy?: string;
  @ApiPropertyOptional({ description: 'Дата выдачи паспорта' })
  @IsOptional() @Type(() => Date) @IsDate() passportIssuedAt?: Date;
  @ApiPropertyOptional({ description: 'Код подразделения' })
  @IsOptional() @IsString() passportDivisionCode?: string;

  @ApiPropertyOptional({ description: 'TZ-PARTY-301 — «наша фирма» для документов' })
  @IsOptional() @IsBoolean() isOurCompany?: boolean;

  @ApiPropertyOptional({ description: 'TZ-ORG-ASSETS-301 — юридический адрес для шапки документов' })
  @IsOptional() @IsString() @Length(0, 512) legalAddress?: string;
}
