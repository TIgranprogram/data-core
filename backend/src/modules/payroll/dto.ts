import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Min, ValidateIf } from 'class-validator';
import { PAY_KINDS } from './payroll-calc';

/** Табель: часы / дни сотрудника за месяц (запись по ключу «сотрудник + месяц»). */
export class TimesheetDto {
  @ApiProperty() @IsMongoId() personId!: string;
  @ApiProperty({ description: 'ГГГГ-ММ' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Месяц — в формате ГГГГ-ММ' }) month!: string;
  @ApiPropertyOptional({ description: 'Часы (для почасовой); null — очистить', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) hours?: number | null;
  @ApiPropertyOptional({ description: 'Отработано дней (для оклада); null — очистить', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) days?: number | null;
  @ApiPropertyOptional({ description: 'Норма дней в месяце (для оклада по дням); null — очистить', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(1) normDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
}

/** Выплата сотруднику (аванс, зарплата, премия). */
export class PayoutDto {
  @ApiProperty() @IsMongoId() personId!: string;
  @ApiProperty({ description: 'Наша компания (organizations), которая платит' }) @IsMongoId() companyId!: string;
  @ApiProperty({ description: 'Дата выплаты ГГГГ-ММ-ДД' }) @IsString() @Length(8, 30) date!: string;
  @ApiProperty({ description: '₽ на руки' }) @IsNumber() @Min(0.01) amount!: number;
  @ApiPropertyOptional({ enum: PAY_KINDS, description: 'advance | salary | bonus | other (умолч. salary)' }) @IsOptional() @IsIn([...PAY_KINDS]) kind?: string;
  @ApiPropertyOptional({ description: 'За какой месяц ГГГГ-ММ (умолч. месяц даты)' }) @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Месяц — в формате ГГГГ-ММ' }) month?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
  @ApiPropertyOptional({ description: 'Ключ клиента — повтор не создаёт вторую выплату' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

/** Привязка сотрудника к нашей компании (Ф5). */
export class PersonCompanyDto {
  @ApiPropertyOptional({ description: 'Наша компания (organizations); null — снять', nullable: true }) @ValidateIf((_, v) => v !== null) @IsMongoId() companyId!: string | null;
}
