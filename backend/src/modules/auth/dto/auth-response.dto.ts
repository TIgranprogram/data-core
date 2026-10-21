/**
 * AuthUserPayload — the canonical "safe" projection of a user record.
 * Returned by `register`, `login`, and `getMe` (TZ-92 §1). Strips the
 * sensitive `passwordHash`, `refreshTokenVersion`, `isActive`, and
 * soft-delete fields that should NEVER reach the client.
 *
 * TZ-92.1 expansion: `phone` and `fullName` added as optional fields so
 * a frontend profile page on `/me` can render the contact info the user
 * provided at register time. Pre-TZ-92.1, these were stripped which
 * meant /me response was missing data the user already had.
 *
 * Why optional? Existing users (pre-TZ-92.1 register path) may have
 * null/missing phone/fullName. Optional shape keeps backward compat.
 *
 * Why not deprecated? Cross-cutting auth flow (login/register response)
 * still benefits from the canonical minimal projection. /me can opt in
 * to richer fields via TypeScript overloads in a future cleanup.
 */
export interface AuthUserPayload {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: string;
  permissions: string[];
  phone?: string | null;
  fullName?: string | null;
  /** TZ-238 */
  organizationId?: string | null;
  /** TZ-ACCESS-301: page ACL — visible nav pages from role. */
  pages?: string[];
  /**
   * TZ-AUTH-306 — `true` only for the single hidden owner; `false` for
   * everyone else. Owner-only pages (e.g. `admin-roles`) are already
   * stripped from `pages` for non-owners, so the flag only drives
   * owner-only UI (e.g. «Добавить мой компьютер» in TZ-AUTH-304).
   */
  isOwner?: boolean;
}

export interface AuthResponse {
  access: string;
  /** Refresh JWT for Bearer refresh flow (FE stores in localStorage). */
  refresh: string;
  user: AuthUserPayload;
}

export interface AccessTokenResponse {
  access: string;
}
