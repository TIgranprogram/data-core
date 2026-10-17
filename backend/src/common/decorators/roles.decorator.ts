import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restricts an endpoint to specific roles. RolesGuard reads this metadata
 * and rejects with 403 if the authenticated user is not in the list.
 *
 * @example
 *   @Roles('admin', 'manager')
 *   @Get('protected')
 *   handler() { ... }
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
