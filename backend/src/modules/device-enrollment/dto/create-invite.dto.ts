import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Allowed invite TTL values (days) per TZ-AUTH-303: 1 / 3 / 7. */
export const ALLOWED_INVITE_TTL_DAYS = [1, 3, 7] as const;

/**
 * TZ-AUTH-303 — regular device invite (admin-only).
 *
 * `role` is REQUIRED: a regular invite can only be minted against a
 * preselected active role. `ttlDays` is the invite lifetime; `deviceTtlDays`
 * optionally overrides the default grant lifetime for this device (bounded
 * to sane limits at the service layer).
 */
export class CreateRegularInviteDto {
  @IsString()
  role!: string;

  @IsOptional()
  @IsInt()
  @IsIn(ALLOWED_INVITE_TTL_DAYS)
  ttlDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  deviceTtlDays?: number;
}

/**
 * TZ-AUTH-303 — owner-device invite (owner-only, password step-up).
 *
 * No role is accepted: the grant binds to the existing single owner User.
 */
export class CreateOwnerInviteDto {
  @IsString()
  password!: string;
}
