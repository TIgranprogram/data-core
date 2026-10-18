import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { CounterModule } from './modules/counter/counter.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RoleModule } from './modules/role/role.module';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { SettingModule } from './modules/setting/setting.module';
import { FeatureFlagModule } from './modules/feature-flag/feature-flag.module';
import { DesktopModule } from './modules/desktop/desktop.module';
import { StatusModule } from './modules/status/status.module';
import { AuditModule } from './modules/audit/audit.module';
import { PersonModule } from './modules/person/person.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { CounterpartyModule } from './modules/counterparty/counterparty.module';
import { RoleOrgModule } from './modules/role-org/role-org.module';
import { RoleCounterpartyModule } from './modules/role-counterparty/role-counterparty.module';
import { CategoryModule } from './modules/category/category.module';
import { UnitModule } from './modules/unit/unit.module';
import { WorkTypeModule } from './modules/work-type/work-type.module';
import { MaterialModule } from './modules/material/material.module';
import { ProductModule } from './modules/product/product.module';
import { ProductPhotoModule } from './modules/product-photo/product-photo.module';
import { ProductModuleModule } from './modules/product-module/product-module.module';
import { ProductModulePhotoModule } from './modules/product-module-photo/product-module-photo.module';
import { PhotosModule } from './modules/photos/photos.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { SiteModule } from './modules/site/site.module';
// TZ-PRODUCTS-301: справочник цветов (RAL) — продуктовая словарная сущность
import { ColorReferenceModule } from './modules/color-reference/color-reference.module';
import { DictionaryLabelModule } from './modules/dictionary-label/dictionary-label.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerBehindAuthGuard } from './common/guards/throttler-behind-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { PermissionsBootModule } from './common/middleware/permissions-boot-validator.module';
import { AdminModule } from './modules/admin/admin.module';
import { DeviceEnrollmentModule } from './modules/device-enrollment/device-enrollment.module';
import { IdempotencyModule } from './common/idempotency/idempotency-storage.module';
import { IdempotencyMiddleware } from './common/idempotency/idempotency.middleware';
import { AttributeDefinitionModule } from './modules/attribute-definition/attribute-definition.module';
import { EntityAttributeValueModule } from './modules/entity-attribute-value/entity-attribute-value.module';
import { ProductPassportModule } from './modules/product-passport/product-passport.module';
import { AppDataModule } from './modules/app-data/app-data.module';
import { SheetsSyncModule } from './modules/sheets-sync/sheets-sync.module';
import { MetaModule } from './modules/meta/meta.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { UserContextInterceptor } from './common/interceptors/user-context.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { IdNormalizeInterceptor } from './common/interceptors/id-normalize.interceptor';
import { AdminSeed } from './common/seed/admin.seed';
import { AdminPasswordDriftDetector } from './common/seed/admin-password-drift-detector';
import { SettingsSeed } from './common/seed/settings.seed';
import { FeatureFlagsSeed } from './common/seed/feature-flags.seed';
import { StatusesSeed } from './common/seed/statuses.seed';
import { OrgRolesSeed } from './common/seed/org-roles.seed';
import { CounterpartyRolesSeed } from './common/seed/counterparty-roles.seed';
import { UnitsSeed } from './common/seed/units.seed';
import { CategoriesSeed } from './common/seed/categories.seed';
import { CurrenciesSeed } from './common/seed/currencies.seed';
import { ColorReferencesSeed } from './common/seed/color-references.seed';
import { HealthController } from './health.controller';
import { ApiRootController } from './api-root.controller';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestMethod } from '@nestjs/common';

/**
 * data-core — платформенное ядро + канонические справочники (VISION #4).
 *
 * Транзакционный CRM-домен (сделки, заказы, склад, производство,
 * документооборот/DocStudio, импорты и т.п.) удалён при чистке H:
 * 93 → 35 модулей. См. ROADMAP.md «P1.5 / H».
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers["x-api-key"]',
              'password',
              'passwordHash',
              'token',
              'secret',
              'refreshToken',
              'accessToken',
              '*.password',
              '*.passwordHash',
              '*.token',
              '*.secret',
              '*.refreshToken',
              '*.accessToken',
            ],
            remove: true,
          },
          transport:
            process.env.NODE_ENV === 'production'
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true },
                },
        },
      }),
    }),
    DatabaseModule,
    // ─── Платформенное ядро ───────────────────────────────────────────
    CounterModule,
    PermissionsModule,
    RoleModule,
    UserModule,
    AuthModule,
    SettingModule,
    FeatureFlagModule,
    DesktopModule,
    StatusModule,
    AuditModule,
    RateLimitModule,
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'long', ttl: 60000, limit: 100 },
    ]),
    TerminusModule,
    PermissionsBootModule, // TZ-255: registers PermissionsBootValidator for OnApplicationBootstrap catalog scan
    AdminModule,            // TZ-257: /api/admin/users + /api/admin/roles (read-only slice)
    DeviceEnrollmentModule, // TZ-AUTH-303: /api/device/* + /api/admin/devices/*
    IdempotencyModule,      // TZ-247.A: registers IdempotencyStorageService + IdempotencyMiddleware
    AppDataModule,          // P1: /api/apps/:app/:collection — до EntityAttributeValueModule (коллизия маршрутов)
    SheetsSyncModule,       // /api/admin/sheets-sync — сервер читает Google-таблицы (сервисный аккаунт) → /api/apps
    MetaModule,             // /api/meta/{schema,openapi.json,guide} — самоописание API для клиентов и ИИ
    // ─── Канонические справочники (VISION #4) ─────────────────────────
    PersonModule,
    OrganizationModule,
    CounterpartyModule,
    RoleOrgModule,
    RoleCounterpartyModule,
    SiteModule, // площадки контрагента
    CategoryModule,
    UnitModule,
    // Канонический справочник видов работ: product-module и product
    // популейтят workTypes.workTypeId → без него GET /modules и
    // GET /products/:id падают 500 (runtime-ref зависимость).
    WorkTypeModule,
    CurrencyModule,
    ColorReferenceModule,       // TZ-PRODUCTS-301: справочник цветов (RAL)
    DictionaryLabelModule,
    MaterialModule,
    ProductModule,
    ProductPhotoModule,
    ProductModuleModule,
    ProductModulePhotoModule, // TZ-83 Фаза A.7: новая entity
    ProductPassportModule,
    PhotosModule, // загрузка изображений (логотипы и т.п.)
    // ─── EAV-инфраструктура (нужна product) ───────────────────────────
    AttributeDefinitionModule,
    EntityAttributeValueModule,
  ],
  controllers: [HealthController, ApiRootController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // TZ-255: guard execution order is JWT → Permissions → Roles.
    //
    // - JwtAuthGuard populates `req.user` (req'd by everything below).
    // - PermissionsGuard runs BEFORE RolesGuard so that a missing
    //   capability surfaces a precision «403 — required permission: …»
    //   rather than a generic «403 — required role: …». When the user
    //   has BOTH, the order doesn't matter (AND-composition). When they
    //   have neither, Permissions fires first because it is registered
    //   first.
    // - RolesGuard catches the legacy `@Roles()`-only routes that
    //   pre-date the permissions matrix; AND-composed with Permissions.
    //
    // IMPORTANT: do NOT reorder these providers without re-testing the
    // error message UX above. Nest runs APP_GUARDs in registration
    // order and the returned messages determine what users see.
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: UserContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // T18: аддитивно добавляет `id` рядом с `_id` во все ответы.
    { provide: APP_INTERCEPTOR, useClass: IdNormalizeInterceptor },
    ThrottlerBehindAuthGuard,
    AdminSeed,
    AdminPasswordDriftDetector,
    SettingsSeed,
    FeatureFlagsSeed,
    StatusesSeed,
    OrgRolesSeed,
    CounterpartyRolesSeed,
    UnitsSeed,
    CategoriesSeed,
    CurrenciesSeed,
    // TZ-PRODUCTS-301: системный default-цвет «Не выбран»
    ColorReferencesSeed,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    // TZ-247.A: mount the idempotency middleware on MUTATING verbs only.
    // GET / HEAD / OPTIONS requests pass through unchanged; the
    // middleware itself additionally excludes /auth/login|register|refresh|logout
    // and /health from caching even if they bear an Idempotency-Key header.
    consumer
      .apply(IdempotencyMiddleware)
      .forRoutes(
        { path: '*', method: RequestMethod.POST },
        { path: '*', method: RequestMethod.PUT },
        { path: '*', method: RequestMethod.PATCH },
        { path: '*', method: RequestMethod.DELETE },
      );
  }
}
