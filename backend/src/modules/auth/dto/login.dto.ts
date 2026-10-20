import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin', description: 'Имя пользователя' })
  @IsString()
  @Length(1, 64)
  username!: string;

  @ApiProperty({ description: 'Пароль' })
  @IsString()
  @Length(1, 128)
  password!: string;
}
