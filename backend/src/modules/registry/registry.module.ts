import { Module } from '@nestjs/common';
import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';

/**
 * Registry module — exposes `GET /api/registry/data-sources` for the
 * Document Constructor tool pane (TZ-86 Фаза A.5 + D.3).
 *
 * Standalone: no DB Models, no foreign modules. Pure-static catalogue
 * served from in-memory `DATA_SOURCES` constant.
 *
 * Why a separate module (not a controller-only fixture on app.module)?
 * - Future-proofing: TZ-87 may add `GET /api/registry/currencies`,
 *   `GET /api/registry/units`, etc. as siblings.
 * - Consistent with project convention (every controller has its
 *   own module — see `HealthModule`, `AuthModule`, ...).
 */
@Module({
  controllers: [RegistryController],
  providers: [RegistryService],
})
export class RegistryModule {}
