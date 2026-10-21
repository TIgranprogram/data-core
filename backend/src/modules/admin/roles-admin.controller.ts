import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  normalizeAdminListQuery,
  type AdminListResponse,
  escapeRegex,
} from './admin-list-query';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SystemRoleGuard } from '../../common/guards/system-role.guard';
import { OwnerOnlyGuard } from '../../common/guards/owner-only.guard';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Role, RoleDocument } from '../role/role.schema';
import { RoleService } from '../role/role.service';
import { AdminCreateRoleDto } from './dto/admin-role.dto';
import { AdminUpdateRoleDto } from './dto/admin-role.dto';
import { toClientRole } from './dto/mapper';

/**
 * TZ-256.B — roles-admin controller (full CRUD surface).
 *
 * Mounted at `/api/admin/roles`. Read paths ship since TZ-257; the
 * mutation paths (create / patch / delete) land here per TZ-256.B
 * (real /admin body — Roles CRUD remainder after TZ-257.A.1 shipped
 * Users CRUD).
 *
 * System-role semantics (TZ-ADMIN-303 / PO 2026-08-09):
 * `SystemRoleGuard` allows PATCH of `isSystem` roles for site admins
 * only; DELETE of system roles stays 403 `SYSTEM_ROLE_FROZEN` for
 * everyone; escalation patches stay 403 `SYSTEM_ROLE_ESCALATION`.
 * POST always forces `isSystem: false` regardless of payload.
 *
 * TZ-257.B DTO-whitelist: mutations accept ONLY `AdminCreateRoleDto` /
 * `AdminUpdateRoleDto` (name/label/description/permissions/pages). Internal
 * fields (`isSystem`, `sortOrder`, `sectionIds`, `isActive`) are not
 * declared, so the global `ValidationPipe({ whitelist: true,
 * forbidNonWhitelisted: true })` rejects them with 400 before any
 * controller/guard logic runs.
 *
 * All endpoints gated by the global guard stack (JwtAuthGuard →
 * PermissionsGuard → RolesGuard) plus per-method `@UseGuards` where
 * invariants apply. Every mutator emits an audit log via
 * `@AuditAction` (see contract block at end of file).
 *
 * TZ-AUTH-306 — the whole role editor (role CRUD) is owner-only: the
 * class-level `OwnerOnlyGuard` refuses ordinary admins with a single safe
 * 403 `OWNER_ONLY` (no owner-only permission key is enumerable in the
 * catalog). The role editor is not a grantable capability.
 */
@Controller('admin/roles')
@UseGuards(OwnerOnlyGuard)
export class RolesAdminController {
  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    private readonly roleService: RoleService,
  ) {}

  /**
   * GET /api/admin/roles
   * List all roles with their permission assignments.
   */
  @Get()
  @Permissions('role:read')
  @Roles('admin')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
  ): Promise<AdminListResponse<ReturnType<typeof toClientRole>>> {
    const query = normalizeAdminListQuery({ page, limit, offset, search });
    const filter: Record<string, unknown> = {};
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [
        { name: pattern },
        { label: pattern },
        { description: pattern },
      ];
    }
    const [docs, total] = await Promise.all([
      this.roleModel
        .find(filter)
        .sort({ name: 1 })
        .skip(query.offset ?? (query.page - 1) * query.limit)
        .limit(query.limit)
        .lean()
        .exec(),
      this.roleModel.countDocuments(filter).exec(),
    ]);
    return {
      items: docs.map((d) => toClientRole(d as Record<string, unknown>)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * POST /api/admin/roles
   * Create a custom role. `isSystem` is ALWAYS forced to `false` —
   * system roles are bootstrapped by seed only (TZ-257 §ШАГ 0).
   */
  @Post()
  @Permissions('role:write')
  @Roles('admin')
  @AuditAction({ action: 'admin.role.created', entityType: 'Role' })
  async create(
    @Body() dto: AdminCreateRoleDto,
  ): Promise<ReturnType<typeof toClientRole>> {
    const doc = await this.roleService.create({ ...dto, isSystem: false });
    return toClientRole(doc as unknown as Record<string, unknown>);
  }

  /**
   * PATCH /api/admin/roles/:id
   * Update role permissions/pages/label. System-role PATCH allowed for
   * site admins; escalation patches refused by `SystemRoleGuard`.
   */
  @Patch(':id')
  @Permissions('role:write')
  @Roles('admin')
  @UseGuards(SystemRoleGuard)
  @AuditAction({
    action: 'admin.role.updated',
    entityType: 'Role',
    idParam: 'id',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: AdminUpdateRoleDto,
  ): Promise<ReturnType<typeof toClientRole>> {
    const doc = await this.roleService.update(id, dto);
    return toClientRole(doc as unknown as Record<string, unknown>);
  }

  /**
   * DELETE /api/admin/roles/:id
   * Delete a custom role. System roles are refused by
   * `SystemRoleGuard`; the service additionally re-checks `isSystem`.
   */
  @Delete(':id')
  @Permissions('role:admin')
  @Roles('admin')
  @UseGuards(SystemRoleGuard)
  @AuditAction({
    action: 'admin.role.deleted',
    entityType: 'Role',
    idParam: 'id',
  })
  async remove(@Param('id') id: string): Promise<{ success: true }> {
    await this.roleService.remove(id);
    return { success: true };
  }

  /**
   * GET /api/admin/roles/:id
   * Single role read.
   */
  @Get(':id')
  @Permissions('role:read')
  @Roles('admin')
  async getById(
    @Param('id') id: string,
  ): Promise<ReturnType<typeof toClientRole>> {
    const doc = await this.roleModel.findById(id).lean().exec();
    if (!doc) {
      throw new Error(`Role ${id} not found`);
    }
    return toClientRole(doc as Record<string, unknown>);
  }
}

/**
 * TZ-257.A AUDIT-EMISSION CONTRACT — applies to every mutator that
 * lands in TZ-257.A on this controller. Mirrors the contract from
 * `users-admin.controller.ts`.
 *
 * System roles (`isSystem: true`): DELETE refused; PATCH allowed for
 * site admins (SystemRoleGuard). Escalation `isSystem: true` on custom
 * roles MUST refuse `@UseGuards`-mutating
 * requests with 403 — apply either an inline check via
 * `this.roleModel.findById(id)` pre-mutation or a small `SystemRoleGuard`
 * (added in TZ-257.A).
 *
 *   // POST /api/admin/roles — create role (always isSystem: false)
 *   @Post()
 *   @Permissions('role:admin')
 *   @Roles('admin')
 *   @AuditAction({ action: 'admin.role.created', entityType: 'Role' })
 *   async create(@Body() dto: CreateRoleDto): Promise<ClientRole> {...}
 *
 *   // PATCH /api/admin/roles/:id — edit role (admin may PATCH system;
 *   // DELETE still refuses isSystem)
 *   @Patch(':id')
 *   @Permissions('role:write')
 *   @Roles('admin')
 *   @AuditAction({
 *     action: 'admin.role.updated',
 *     entityType: 'Role',
 *     idParam: 'id',
 *   })
 *   async update(@Param('id') id: string, @Body() dto: UpdateRoleDto): Promise<ClientRole> {...}
 *
 *   // DELETE /api/admin/roles/:id — refuse if isSystem
 *   @Delete(':id')
 *   @Permissions('role:admin')
 *   @Roles('admin')
 *   @AuditAction({
 *     action: 'admin.role.deleted',
 *     entityType: 'Role',
 *     idParam: 'id',
 *   })
 *   async remove(@Param('id') id: string): Promise<void> {...}
 *
 * The interceptor auto-emits the audit log; no manual `AuditService.log()`
 * calls are needed in mutators. If `details.before` snapshot is needed
 * for diff, inject `AuditService` manually and call it BEFORE the
 * mutation with `details: { before: snapshot, meta: { actor: req.user.username } }`.
 */
