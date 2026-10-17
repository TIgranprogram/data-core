import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { normalizeAdminListQuery, type AdminListResponse, escapeRegex } from './admin-list-query';
import { UserService } from '../user/user.service';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { LastAdminGuard } from '../../common/guards/last-admin.guard';
import { OwnerTargetGuard } from '../../common/guards/owner-target.guard';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { User, UserDocument } from '../user/user.schema';
import { Role, RoleDocument } from '../role/role.schema';
import { toClientUser } from './dto/mapper';

/**
 * TZ-257.A.1 — users-admin controller.
 *
 * Mounted at `/api/admin/users`. Read and mutation paths all map through
 * `toClientUser()`, so credentials never cross the API boundary. Mutations
 * use `UserService` so password hashing, cache invalidation, and persistence
 * remain in the user domain service.
 *
 * DTO mapping policy (TZ-257 §ШАГ 1 acceptance criterion
 * "passwordHash NEVER returned to client"):
 *
 *   - `passwordHash` field → ALWAYS stripped via `toClientUser()` mapper.
 *   - `refreshTokenVersion` → dropped (not exposed); TZ-257.A may add
 *     a "rotated at" marker if a UI sentinel becomes necessary.
 *   - `__v` Mongoose versionKey → preserved (helps with optimistic
 *     locking).
 *
 * All endpoints gated by:
 *   1. JwtAuthGuard (APP_GUARD, global)       → 401
 *   2. PermissionsGuard (APP_GUARD, global)   → 403
 *   3. RolesGuard (APP_GUARD, global)         → 403 (legacy)
 *
 * LastAdminGuard is NOT applied at class level here — the guard is a
 * no-op for read paths (no `:id` mutation), and misleading
 * class-level decoration purchases zero security for the cost of
 * confusion. Per-method @UseGuards(LastAdminGuard) is added in TZ-257.A
 * alongside the mutators.
 *
 * Permissions posture:
 *   - LIST (`GET /`) gated by `@Permissions('user:admin')` — a regular
 *     `user:read` is reserved for self-service lookups; the LIST path
 *     enumerates ALL users and is admin-only.
 *   - GET `:id` gated by `@Permissions('user:read')` — self profile reads
 *     by the user themselves; route-level Idempotency is handled by
 *     Nest `findById` throwing NotFoundException on missing id.
 */
@Controller('admin/users')
export class UsersAdminController {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    private readonly userService: UserService,
  ) {}

  /**
   * GET /api/admin/users
   * List users with `passwordHash` REDACTED. Pagination uses `page` +
   * `limit`; legacy `offset` remains accepted as a compatibility alias.
   * `search` matches username, email, and display name. Optional `role`
   * filters by the user's role.
   *
   * Permission gate: `@Permissions('user:admin')` — admin-only because
   * the LIST enumerates every user. `user:read` is reserved for
   * self-service lookups in TZ-257.A.
   */
  @Get()
  @Permissions('user:admin')
  @Roles('admin')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @CurrentUser() actor?: AuthenticatedUser,
  ): Promise<AdminListResponse<ReturnType<typeof toClientUser>>> {
    const query = normalizeAdminListQuery({ page, limit, offset, search, role });
    const filter: Record<string, unknown> = {};
    // TZ-AUTH-306 — the hidden owner never appears in a non-owner's list
    // (nor count, nor search): enumerating the owner is denied at the
    // source, before pagination/search runs.
    if (actor?.isOwner !== true) {
      filter.isOwner = { $ne: true };
    }
    if (query.role) filter.role = query.role;
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ username: pattern }, { email: pattern }, { displayName: pattern }];
    }
    const [docs, total] = await Promise.all([
      this.userModel
        .find(filter)
        .skip(query.offset ?? (query.page - 1) * query.limit)
        .limit(query.limit)
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);
    return {
      items: docs.map((d) => toClientUser(d as Record<string, unknown>)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  @Post()
  @Permissions('user:admin')
  @Roles('admin')
  @AuditAction({ action: 'admin.user.created', entityType: 'User' })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor?: AuthenticatedUser,
  ): Promise<ReturnType<typeof toClientUser>> {
    // TZ-AUTH-306 — granting administrator power is owner-only. Ordinary
    // admins may create regular (non-admin) users but never promote to admin.
    if (dto.role === 'admin' && actor?.isOwner !== true) {
      throw new ForbiddenException({
        code: 'OWNER_ONLY',
        message: 'Only the system owner can create administrator accounts',
      });
    }
    const doc = await this.userService.create(dto);
    return toClientUser(doc as unknown as Record<string, unknown>);
  }

  @Patch(':id')
  @Permissions('user:admin')
  @Roles('admin')
  @UseGuards(OwnerTargetGuard, LastAdminGuard)
  @AuditAction({ action: 'admin.user.updated', entityType: 'User', idParam: 'id' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<ReturnType<typeof toClientUser>> {
    const doc = await this.userService.update(id, dto);
    return toClientUser(doc as unknown as Record<string, unknown>);
  }

  @Post(':id/activate')
  @Permissions('user:admin')
  @Roles('admin')
  @UseGuards(OwnerTargetGuard)
  @AuditAction({ action: 'admin.user.activated', entityType: 'User', idParam: 'id' })
  async activate(@Param('id') id: string): Promise<ReturnType<typeof toClientUser>> {
    const doc = await this.userService.update(id, { isActive: true });
    return toClientUser(doc as unknown as Record<string, unknown>);
  }

  @Post(':id/deactivate')
  @Permissions('user:admin')
  @Roles('admin')
  @UseGuards(OwnerTargetGuard, LastAdminGuard)
  @AuditAction({ action: 'admin.user.deactivated', entityType: 'User', idParam: 'id' })
  async deactivate(@Param('id') id: string): Promise<ReturnType<typeof toClientUser>> {
    const doc = await this.userService.update(id, { isActive: false });
    return toClientUser(doc as unknown as Record<string, unknown>);
  }

  @Delete(':id')
  @Permissions('user:admin')
  @Roles('admin')
  @UseGuards(OwnerTargetGuard, LastAdminGuard)
  @AuditAction({ action: 'admin.user.deleted', entityType: 'User', idParam: 'id' })
  async remove(@Param('id') id: string): Promise<ReturnType<typeof toClientUser>> {
    const doc = await this.userService.remove(id);
    return toClientUser(doc as unknown as Record<string, unknown>);
  }

  /**
   * POST /api/admin/users/:id/reset-password
   * TZ-257.A.1 §2 — administrator password reset.
   *
   * Admin-only, LastAdminGuard-protected (an admin cannot reset the
   * password of the last active admin through this path — the guard
   * treats PATCH-style mutations conservatively). Audited with the
   * canonical `admin.user.password-changed` action. Returns the
   * redacted client user shape (never `passwordHash`).
   */
  @Post(':id/reset-password')
  @Permissions('user:admin')
  @Roles('admin')
  @UseGuards(OwnerTargetGuard, LastAdminGuard)
  @AuditAction({ action: 'admin.user.password-changed', entityType: 'User', idParam: 'id' })
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: AdminResetPasswordDto,
  ): Promise<ReturnType<typeof toClientUser>> {
    // TZ-AUTH-303 — device accounts have no user password; reject with a
    // clear 409 so the admin UI can surface the right explanation.
    const target = await this.userModel.findById(id).lean().exec();
    if (target?.accountType === 'device') {
      throw new ConflictException(
        'У устройства нет пользовательского пароля — доступ через cookie',
      );
    }
    const doc = await this.userService.adminResetPassword(id, dto.newPassword);
    return toClientUser(doc as unknown as Record<string, unknown>);
  }

  /**
   * GET /api/admin/users/:id
   * Single user read with `passwordHash` REDACTED. Returns 404 via
   * Mongoose `findById` when id is missing (NestJS auto-converts to
   * NotFoundException).
   *
   * Permission gate: `@Permissions('user:read')` — also gated by
   * `@Roles('admin')` — single-record reads are appropriate for the
   * self-service lookup flow (TZ-257.A may add a non-admin
   * `/api/users/me` mirror).
   */
  @Get(':id')
  @Permissions('user:read')
  @Roles('admin')
  async getById(
    @Param('id') id: string,
    @CurrentUser() actor?: AuthenticatedUser,
  ): Promise<ReturnType<typeof toClientUser>> {
    const doc = await this.userModel.findById(id).lean().exec();
    if (!doc) {
      throw new NotFoundException(`User ${id} not found`);
    }
    // TZ-AUTH-306 — the owner is invisible to non-owners: a 404 (not 403)
    // so the hidden owner cannot be fingerprinted by a direct GET.
    if (doc.isOwner === true && actor?.isOwner !== true) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return toClientUser(doc as Record<string, unknown>);
  }
}

/**
 * TZ-257.A AUDIT-EMISSION CONTRACT — applies to every mutator on this
 * controller. The global interceptor emits after successful responses and
 * redacts credential fields from the response snapshot.
 *
 * The global `AuditInterceptor` (registered as `APP_INTERCEPTOR` in
 * `app.module.ts`) inspects each handler for `@AuditAction({ action,
 * entityType, idParam? })`. For POST/PATCH/PUT/DELETE handlers with
 * this decorator it auto-emits an `AuditLog` after the response
 * resolves:
 *
 *   - `action`           — string written verbatim to `AuditLog.action`.
 *   - `entityType`       — written to `AuditLog.entityType`.
 *   - `entityId`         — resolved from the route param named in
 *                          `idParam` (e.g. `idParam: 'id'`), or
 *                          from the response body's `_id`/`id` field.
 *   - `userId`/`userName`— auto-filled from AsyncLocalStorage via
 *                          `UserContextInterceptor` (TZ-04).
 *   - `details.after`    — auto-captured from the response body via
 *                          `safeSnapshot()` (drops `passwordHash`,
 *                          `password`, `refreshToken`).
 *
 * TZ-257.A mutator decorators MUST follow this shape verbatim:
 *
 *   // POST /api/admin/users — create user
 *   @Post()
 *   @Permissions('user:admin')
 *   @Roles('admin')
 *   @UseGuards(LastAdminGuard) // n/a for create, omitted in practice
 *   @AuditAction({ action: 'admin.user.created', entityType: 'User' })
 *   async create(@Body() dto: CreateUserDto): Promise<ClientUser> {...}
 *
 *   // PATCH /api/admin/users/:id — edit user
 *   @Patch(':id')
 *   @Permissions('user:admin')
 *   @Roles('admin')
 *   @UseGuards(LastAdminGuard) // YES when target.role === 'admin'
 *   @AuditAction({
 *     action: 'admin.user.updated',
 *     entityType: 'User',
 *     idParam: 'id',
 *   })
 *   async update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<ClientUser> {...}
 *
 *   // POST /api/admin/users/:id/deactivate — last-admin invariant
 *   @Post(':id/deactivate')
 *   @Permissions('user:admin')
 *   @Roles('admin')
 *   @UseGuards(LastAdminGuard)
 *   @AuditAction({
 *     action: 'admin.user.deactivated',
 *     entityType: 'User',
 *     idParam: 'id',
 *   })
 *   async deactivate(@Param('id') id: string): Promise<ClientUser> {...}
 *
 *   // DELETE /api/admin/users/:id — last-admin invariant
 *   @Delete(':id')
 *   @Permissions('user:admin')
 *   @Roles('admin')
 *   @UseGuards(LastAdminGuard)
 *   @AuditAction({
 *     action: 'admin.user.deleted',
 *     entityType: 'User',
 *     idParam: 'id',
 *   })
 *   async remove(@Param('id') id: string): Promise<void> {...}
 *
 * No manual `AuditService.log()` calls are needed in the mutators —
 * the interceptor handles emission.
 */
