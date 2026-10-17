import { Controller, Get } from '@nestjs/common';
import { RegistryService } from './registry.service';

/**
 * Registry endpoints — read-only metadata about data sources available
 * to the Document Constructor (TZ-86 Фаза D.3 tool pane «Данные» tab).
 *
 * No `@AuditAction()`: this is configuration, not data mutation; the
 * AuditInterceptor is a no-op on GET endpoints (it only fires on POST/
 * PATCH/DELETE that change state).
 *
 * Auth: JwtAuthGuard is APP_GUARD global (main.ts) so all routes
 * require a valid JWT. RolesGuard allows any authenticated user —
 * registry descriptors are not privileged.
 */
@Controller('registry')
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  /**
   * Returns the full catalogue of addressable data sources for the
   * Document Constructor. Stable contract — see `DataSourceDescriptor`
   * in registry.service.ts for the descriptor shape.
   */
  @Get('data-sources')
  getDataSources() {
    return this.registry.getDataSources();
  }
}
