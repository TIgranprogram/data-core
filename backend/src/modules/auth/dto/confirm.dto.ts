import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /api/auth/confirm — пароль текущего пользователя. */
export class ConfirmDto {
  @IsString({ message: 'Введите пароль' })
  @MinLength(1, { message: 'Введите пароль' })
  @MaxLength(200)
  password!: string;
}
