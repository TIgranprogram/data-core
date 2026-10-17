import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { RoleModule } from '../role/role.module';
import { UsersAdminController } from './users-admin.controller';
import { RolesAdminController } from './roles-admin.controller';
import { PermissionsAdminController } from './permissions-admin.controller';
import { LastAdminGuard } from '../../common/guards/last-admin.guard';
import { SystemRoleGuard } from '../../common/guards/system-role.guard';

/**
 * TZ-257 §ШАГ 1 — admin module.
 *
 * Isolated sub-tree for managing users, roles, and permissions.
 * Mounted at `/api/admin/*` (controllers declare their own paths).
 *
 * Authorization posture (TZ-257 §ШАГ 3):
 *   - JwtAuthGuard (APP_GUARD, global)        → 401 on no JWT
 *   - PermissionsGuard (APP_GUARD, global)   → 403 on missing permission
 *   - RolesGuard (APP_GUARD, global)          → 403 on missing role (legacy)
 *   - LastAdminGuard (per-method @UseGuards)  → 403 on last-admin invariant violation
 *
 * The admin controllers each require `@Permissions('user:admin')` (or
 * `'role:admin'`) on every endpoint, gated by the global guard stack.
 * LastAdminGuard is applied ONLY on per-method @UseGuards once mutators
 * ship in TZ-257.A.
 *
 * NO `MongooseModule.forFeature` here — UserModule / RoleModule already
 * export the models, and NestJS's DI scope resolves the duplicate
 * `getModelToken(User.name)` to the canonical provider. Re-registering
 * the schemas here would cause Mongoose "duplicate index" warnings at
 * boot (each forFeature call re-registers the schema's @Prop indexes).
 */
@Module({
  imports: [UserModule, RoleModule],
  controllers: [UsersAdminController, RolesAdminController, PermissionsAdminController],
  providers: [LastAdminGuard, SystemRoleGuard],
  exports: [LastAdminGuard, SystemRoleGuard],
})
export class AdminModule {}
