import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { PermissionKey } from '../contracts/rbac-contract';
import { PERMISSIONS } from '../seed/permissions.constants';

/**
 * TZ-255 §ШАГ 4 — Boot-time validator for `@Permissions` decorator keys.
 *
 * Triggered by Nest's `OnApplicationBootstrap` lifecycle — AFTER all
 * modules are instantiated but BEFORE the HTTP server starts accepting
 * traffic. Scans every controller's handlers via `DiscoveryService`
 * and verifies each `@Permissions()` arg against the canonical catalog.
 *
 * This is a defense-in-depth check on top of the per-decorator
 * constructor assertion (`assertCanonicalKeys` inside Permissions()).
 * Necessity: if a controller file is loaded but the decorator never
 * evaluates (e.g. a future NestJS plugin bypass), the runtime guard
 * would silently allow non-existent permission keys. The boot
 * validator closes that gap with a hard log + re-throw.
 *
 * Behavior:
 *  - Production (`NODE_ENV === 'production'`): THROW on ANY invalid key.
 *    Nest's OnApplicationBootstrap handler catches and propagates to
 *    the exit code; `process.exitCode = 1` is set so the deployment
 *    orchestrator sees the failure.
 *  - Development: logs a warning but continues startup.
 *  - Disabled entirely by `BOOT_RELAX_PERMISSIONS=1`.
 *
 * NOTE on file naming: this class lives in `permissions-boot-validator.ts`
 * (NOT `.module.ts`) because it is a NestJS service, not a module.
 * The wiring NestJS module is `PermissionsBootModule` and lives in
 * the separate `permissions-boot-validator.module.ts`. Mixing them
 * into one file caused a self-import cycle in the earlier draft.
 */
@Injectable()
export class PermissionsBootValidator implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionsBootValidator.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const isProd = process.env.NODE_ENV === 'production';
    const relax = process.env.BOOT_RELAX_PERMISSIONS === '1';

    const catalogKeys = new Set<string>(PERMISSIONS.map((p) => p.key));
    const violations: Array<{
      controller: string;
      handler: string;
      key: string;
    }> = [];

    const controllers = this.discovery.getControllers();

    for (const wrapper of controllers) {
      const metatype = wrapper.metatype;
      if (!metatype || typeof metatype !== 'function') continue;
      const ctrlName = metatype.name;
      const handlers = this.metadataScanner.getAllMethodNames(metatype.prototype ?? {});

      for (const handlerName of handlers) {
        const handlerRef = metatype.prototype?.[handlerName];
        if (typeof handlerRef !== 'function') continue;
        const required = this.reflector.get<string[] | undefined>(
          PERMISSIONS_KEY,
          handlerRef,
        );
        if (!required || required.length === 0) continue;

        for (const key of required) {
          if (key === '*') continue;
          if (!catalogKeys.has(key)) {
            violations.push({
              controller: ctrlName,
              handler: handlerName,
              key,
            });
          }
        }
      }
    }

    if (violations.length === 0) {
      this.logger.log(
        `[TZ-255] PermissionsBootValidator OK — scanned ${controllers.length} controllers, all @Permissions keys canonical.`,
      );
      return;
    }

    const formatted = violations
      .map((v) => `  - ${v.controller}.${v.handler} @Permissions("${v.key}")`)
      .join('\n');

    if (isProd && !relax) {
      // Production hard-fail path: throw + set exit code. Nest's
      // bootstrap handler will propagate the throw and Docker /
      // systemd will pick up the non-zero exit code. We deliberately
      // do NOT call process.exit() here so the Nest pipeline can
      // run any in-flight `onApplicationShutdown` hooks (Sentry
      // flush, DB connection close, audit log drain, etc.).
      this.logger.error(
        `[TZ-255] PermissionsBootValidator FAILED at boot — non-canonical permission keys:\n${formatted}\n` +
          `Add canonical keys at backend/src/common/seed/permissions.constants.ts or fix the decorator.\n` +
          `Set BOOT_RELAX_PERMISSIONS=1 to bypass for emergency dev only (DO NOT do this in production).`,
      );
      process.exitCode = 1;
      throw new Error(
        `[TZ-255 FATAL] Non-canonical @Permissions keys at boot. ` +
          `Counts: ${violations.length} controllers. See explicit list above.`,
      );
    }

    if (relax) {
      this.logger.warn(
        `[TZ-255] PermissionsBootValidator RELAXED — ${violations.length} violations logged but bypassed via BOOT_RELAX_PERMISSIONS=1:\n${formatted}`,
      );
    } else {
      this.logger.warn(
        `[TZ-255] PermissionsBootValidator WARNING (dev only) — ${violations.length} non-canonical @Permissions keys:\n${formatted}\n` +
          `In production these would hard-fail the boot.`,
      );
    }
  }

  /**
   * Static entry point for unit tests — same logic without reading
   * from a live Nest container.
   */
  static validateKeys(
    required: readonly (PermissionKey | string)[] | undefined,
    catalog: ReadonlySet<string>,
  ): string[] {
    if (!required) return [];
    const violations: string[] = [];
    for (const k of required) {
      if (k === '*') continue;
      if (!catalog.has(k)) violations.push(k);
    }
    return violations;
  }
}
