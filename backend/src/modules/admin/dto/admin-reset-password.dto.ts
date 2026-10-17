import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * TZ-257.A.1 §2 — Administrator password reset DTO.
 *
 * Deliberately does NOT require `oldPassword`: an admin resets another
 * user's password and by definition cannot know (and must not be asked
 * for) the target's current password. The service method
 * (`UserService.adminResetPassword`) therefore skips the old-password
 * bcrypt comparison that `changePassword()` performs.
 */
export class AdminResetPasswordDto {
  @ApiProperty({ description: 'Новый пароль (минимум 8 символов)' })
  @IsString()
  @Length(8, 128)
  newPassword!: string;
}
