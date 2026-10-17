import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Текущий пароль' })
  @IsString()
  oldPassword!: string;

  @ApiProperty({ description: 'Новый пароль (минимум 8 символов)' })
  @IsString()
  @Length(8, 128)
  newPassword!: string;
}
