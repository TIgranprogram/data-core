import { Controller, Get, UseGuards } from '@nestjs/common';
import { PAGE_KEYS, PERMISSIONS } from '../../common/seed/permissions.constants';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnerOnlyGuard } from '../../common/guards/owner-only.guard';
import { AuditAction } from '../../common/interceptors/audit.interceptor';

/**
 * TZ-257.B — permissions catalog for the admin role editor.
 *
 * Serves the canonical `PERMISSIONS` constant (single source of truth
 * used by the seeder, `PermissionsBootValidator` and role validation)
 * grouped by `section`. The admin role-form dialog renders this as a
 * checkbox catalogue so editors pick from the real permission keys
 * instead of free-typing.
 *
 * TZ-ADMIN-301: also returns `pages` (= PAGE_KEYS) for the nav pageKey
 * ACL picker (Клиенты / Снабжение / …).
 *
 * Response shape:
 *   { sections: [...], pages: string[] }
 *
 * Gated by the global guard stack: JwtAuthGuard → PermissionsGuard
 * (`role:write`) → RolesGuard (`admin`) AND the class-level
 * `OwnerOnlyGuard` (TZ-AUTH-306): the permissions/pages matrix editor is
 * owner-only and never a grantable capability. The full catalogue is a
 * sensitive read and explicitly emits `admin.permissions.catalog` audit
 * entries; ordinary GET handlers remain unaudited.
 */
@Controller('admin/permissions')
@UseGuards(OwnerOnlyGuard)
export class PermissionsAdminController {
  @Get()
  @Permissions('role:write')
  @Roles('admin')
  @AuditAction({ action: 'admin.permissions.catalog', entityType: 'Permission', auditRead: true })
  catalog(): {
    sections: Array<{
      section: string;
      permissions: Array<{ key: string; action: string; description: string }>;
    }>;
    pages: string[];
  } {
    const bySection = new Map<
      string,
      Array<{ key: string; action: string; description: string }>
    >();
    for (const p of PERMISSIONS) {
      const list = bySection.get(p.section) ?? [];
      list.push({ key: p.key, action: p.action, description: p.description });
      bySection.set(p.section, list);
    }
    const sections = Array.from(bySection.entries()).map(([section, permissions]) => ({
      section,
      permissions,
    }));
    return { sections, pages: [...PAGE_KEYS] };
  }
}
