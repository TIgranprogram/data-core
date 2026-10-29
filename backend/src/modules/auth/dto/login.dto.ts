import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin', description: 'Имя пользователя' })
  @IsString()
  @Length(1, 64)
  username!: string;

  @ApiProperty({ description: 'Пароль' })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ required: false, default: true, description: 'Запомнить меня: refresh 90 дней скользящий; false — до закрытия браузера' })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
