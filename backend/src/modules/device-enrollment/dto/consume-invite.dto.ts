import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * TZ-AUTH-303 — public invite consumption payload.
 *
 * The ONLY personal data collected from the recipient is the device name.
 * No name/email/login/password — the device is the access subject.
 * `secret` is the raw one-time invite secret embedded in the invite URL.
 */
export class ConsumeInviteDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  secret!: string;

  @IsString()
  @Length(1, 80)
  @Matches(/\S/, { message: 'deviceName must not be blank' })
  deviceName!: string;
}
