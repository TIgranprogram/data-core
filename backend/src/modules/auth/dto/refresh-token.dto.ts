/**
 * RefreshTokenDto — body shape for POST /api/auth/refresh.
 *
 * The refresh token is read from the `Authorization: Bearer` header by
 * `AuthGuard('jwt-refresh')`, not from the body. The body is therefore
 * empty by design; this class exists as a placeholder for any future
 * body fields (e.g. device-id) and to satisfy the `@Body()` decorator
 * in the controller. Any required-field validation here would 400 the
 * request because the client intentionally sends `{}`.
 */
export class RefreshTokenDto {}
