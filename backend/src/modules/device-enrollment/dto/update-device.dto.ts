import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * TZ-AUTH-303 — admin device management payload.
 *
 *   - `role`          — change the device's role (applies at the next session
 *                       renewal, i.e. within the ≤5m device-JWT window).
 *   - `deviceName`    — relabel the device.
 *   - `expiresInDays` — extend/shorten the grant lifetime (bounded 1..3650).
 */
export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  role?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MinLength(1)
  @MaxLength(80)
  deviceName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}
