import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { EMERGENCY_PHRASE } from './switch.rules';

export class StartSwitchDto {
  @ApiProperty({ example: true, description: 'Подтверждение: только true' })
  @IsBoolean({ message: 'Нужно подтверждение: confirm=true' })
  @Equals(true, { message: 'Нужно подтверждение: confirm=true' })
  confirm!: true;
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

/** Отчёт хост-моста. Принимается только по секрету из файла и только с самого хоста. */
export class SwitchReportDto {
  @ApiProperty({ description: 'Номер работы; "peer" — только сведения о втором сервере, без работы' })
  @IsString() @MaxLength(64)
  id!: string;

  @ApiPropertyOptional({ example: 'dump' }) @IsOptional() @IsString() @MaxLength(40)
  step?: string;

  @ApiPropertyOptional({ enum: ['running', 'done', 'failed'] }) @IsOptional() @IsIn(['running', 'done', 'failed'])
  state?: 'running' | 'done' | 'failed';

  @ApiPropertyOptional({ description: 'Текст ошибки без секретов' }) @IsOptional() @IsString() @MaxLength(2000)
  error?: string;

  @ApiPropertyOptional({ enum: ['main', 'standby'] }) @IsOptional() @IsIn(['main', 'standby'])
  role?: 'main' | 'standby';

  @ApiPropertyOptional({ enum: ['normal', 'readonly'] }) @IsOptional() @IsIn(['normal', 'readonly'])
  mode?: 'normal' | 'readonly';

  @ApiPropertyOptional({ type: PeerInfoDto }) @IsOptional() @ValidateNested() @Type(() => PeerInfoDto)
  peer?: PeerInfoDto;
}
