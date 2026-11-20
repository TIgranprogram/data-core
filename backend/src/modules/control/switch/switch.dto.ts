import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, Equals, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { SCHEDULE_TIME, SCHEDULE_TIMEZONE, type RefreshScope } from './schedule.rules';
import { EMERGENCY_PHRASE } from './switch.rules';

/** Подтверждение смены главного. */
export class StartSwitchDto {
  @ApiProperty({ example: true, description: 'Подтверждение: только true' })
  @IsBoolean({ message: 'Нужно подтверждение: confirm=true' })
  @Equals(true, { message: 'Нужно подтверждение: confirm=true' })
  confirm!: true;
}

export class RefreshSwitchDto extends StartSwitchDto {
  @ApiPropertyOptional({ enum: ['data', 'both'], default: 'both' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['data', 'both'], { message: 'Укажите, что обновить: данные или код и данные' })
  scope?: RefreshScope;
}

export class DailyScheduleDto {
  @ApiProperty()
  @IsBoolean({ message: 'Включение расписания должно быть true или false' })
  enabled!: boolean;

  @ApiProperty({ example: '03:00' })
  @Matches(SCHEDULE_TIME, { message: 'Укажите время в формате ЧЧ:ММ' })
  time!: string;

  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5] })
  @IsArray({ message: 'Дни недели должны быть списком' })
  @ArrayUnique({ message: 'В расписании есть повторяющиеся дни' })
  @IsInt({ each: true, message: 'День недели должен быть целым числом' })
  @Min(1, { each: true, message: 'Допустимы дни недели от 1 до 7' })
  @Max(7, { each: true, message: 'Допустимы дни недели от 1 до 7' })
  days!: number[];
}

export class DataScheduleDto extends DailyScheduleDto {
  @ApiProperty({ enum: ['interval', 'daily'] })
  @IsIn(['interval', 'daily'], { message: 'Выберите интервальное или ежедневное обновление данных' })
  mode!: 'interval' | 'daily';

  @ApiProperty({ minimum: 5, maximum: 1440, example: 15 })
  @IsInt({ message: 'Интервал в минутах должен быть целым числом' })
  @Min(5, { message: 'Интервал должен быть не меньше 5 минут' })
  @Max(1440, { message: 'Интервал должен быть не больше 1440 минут' })
  intervalMinutes!: number;
}

export class SaveSwitchScheduleDto {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 })
  @IsInt({ message: 'Укажите ревизию расписания' })
  @Min(0, { message: 'Укажите действительную ревизию расписания' })
  @Max(Number.MAX_SAFE_INTEGER - 1, { message: 'Укажите действительную ревизию расписания' })
  expectedRevision!: number;

  @ApiProperty({ enum: [SCHEDULE_TIMEZONE] })
  @Equals(SCHEDULE_TIMEZONE, { message: 'Расписание задаётся по московскому времени' })
  timezone!: typeof SCHEDULE_TIMEZONE;

  @ApiProperty({ type: DataScheduleDto })
  @IsObject({ message: 'Укажите расписание обновления данных' })
  @ValidateNested() @Type(() => DataScheduleDto)
  data!: DataScheduleDto;

  @ApiProperty({ type: DailyScheduleDto })
  @IsObject({ message: 'Укажите расписание обновления кода и данных' })
  @ValidateNested() @Type(() => DailyScheduleDto)
  code!: DailyScheduleDto;
}

export class EmergencySwitchDto {
  @ApiProperty({ example: EMERGENCY_PHRASE, description: 'Ровно фраза «Я ПОНИМАЮ»' })
  @IsString()
  @Equals(EMERGENCY_PHRASE, { message: `Для аварийного подъёма введите фразу «${EMERGENCY_PHRASE}»` })
  confirm!: string;
}

export class PeerInfoDto {
  @ApiPropertyOptional({ description: 'Версия приложения на втором сервере' })
  @IsOptional() @IsString() @MaxLength(60)
  version?: string;

  @ApiPropertyOptional({ description: 'Когда база второго сервера обновлялась в последний раз (ISO)' })
  @IsOptional() @IsISO8601()
  copyAt?: string;

  @ApiPropertyOptional({ description: 'Второй сервер отвечает на health' })
  @IsOptional() @IsBoolean()
  healthy?: boolean;
}

export class SwitchDomainDto {
  @ApiProperty({ enum: ['home', 'office'], nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsIn(['home', 'office'], { message: 'Владелец домена должен быть home, office или null' })
  owner!: 'home' | 'office' | null;

  @ApiProperty({ type: Boolean, nullable: true })
  @ValidateIf((_object, value) => value !== null) @IsBoolean({ message: 'Состояние домашнего сервера должно быть true, false или null' })
  homeHealthy!: boolean | null;

  @ApiProperty({ type: Boolean, nullable: true })
  @ValidateIf((_object, value) => value !== null) @IsBoolean({ message: 'Состояние офисного сервера должно быть true, false или null' })
  officeHealthy!: boolean | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, { message: 'Укажите дату и время проверки домена в формате ISO' })
  @IsISO8601({ strict: true }, { message: 'Укажите действительную дату проверки домена' })
  checkedAt!: string | null;
}

/** Отчёт хост-моста. Принимается только по секрету из файла и только с самого хоста. */
export class SwitchReportDto {
  @ApiProperty({ description: 'Номер работы; "peer" — только сведения о втором сервере; "self" — смена роли без работы (старый главный становится запасным)' })
  @IsString() @MaxLength(64)
  id!: string;

  @ApiPropertyOptional({ example: 'dump' }) @IsOptional() @IsString() @MaxLength(40)
  step?: string;

  @ApiPropertyOptional({ enum: ['running', 'done', 'failed'] }) @IsOptional() @IsIn(['running', 'done', 'failed'])
  state?: 'running' | 'done' | 'failed';

  @ApiPropertyOptional({ description: 'Текст ошибки без секретов' }) @IsOptional() @IsString() @MaxLength(2000)
  error?: string;

  @ApiPropertyOptional({ description: 'Предупреждение, не меняющее результат операции' })
  @IsOptional() @IsString() @MaxLength(2000)
  warning?: string;

  @ApiPropertyOptional({ enum: ['main', 'standby'] }) @IsOptional() @IsIn(['main', 'standby'])
  role?: 'main' | 'standby';

  @ApiPropertyOptional({ enum: ['normal', 'readonly'] }) @IsOptional() @IsIn(['normal', 'readonly'])
  mode?: 'normal' | 'readonly';

  @ApiPropertyOptional({ type: PeerInfoDto }) @IsOptional() @ValidateNested() @Type(() => PeerInfoDto)
  peer?: PeerInfoDto;

  @ApiPropertyOptional({ type: SwitchDomainDto })
  @ValidateIf((_object, value) => value !== undefined) @IsObject({ message: 'Укажите результат проверки домена' })
  @ValidateNested() @Type(() => SwitchDomainDto)
  domain?: SwitchDomainDto;
}
