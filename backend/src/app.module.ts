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
import { FormProfilesModule } from './modules/form-profiles/form-profiles.module';
import { FeatureFlagModule } from './modules/feature-flag/feature-flag.module';
import { DesktopModule } from './modules/desktop/desktop.module';
import { StatusModule } from './modules/status/status.module';
import { AuditModule } from './modules/audit/audit.module';
import { PersonModule } from './modules/person/person.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { CounterpartyModule } from './modules/counterparty/counterparty.module';
import { RoleOrgModule } from './modules/role-org/role-org.module';
import { RoleCounterpartyModule } from './modules/role-counterparty/role-counterparty.module';
import { InteractionModule } from './modules/interaction/interaction.module';
import { CategoryModule } from './modules/category/category.module';
import { UnitModule } from './modules/unit/unit.module';
import { MaterialModule } from './modules/material/material.module';
import { ProductModule } from './modules/product/product.module';
import { ProductPhotoModule } from './modules/product-photo/product-photo.module';
import { ProductModuleModule } from './modules/product-module/product-module.module';
import { ProductModulePhotoModule } from './modules/product-module-photo/product-module-photo.module';
import { PhotosModule } from './modules/photos/photos.module';
import { AttachmentModule } from './modules/attachments/attachment.module';
import { MutationJournalModule } from './modules/mutation-journal/mutation-journal.module';
import { ImportTaskModule } from './modules/import-task/import-task.module';
import { ImportMappingProfileModule } from './modules/import-mapping-profile/import-mapping-profile.module';
import { ImportTodoModule } from './modules/import-todo/import-todo.module';
import { BomModule } from './modules/bom/bom.module';
import { WorkCenterModule } from './modules/work-center/work-center.module';
import { WorkTypeModule } from './modules/work-type/work-type.module';
import { WorkerModule } from './modules/worker/worker.module';
import { RoutingStepModule } from './modules/routing-step/routing-step.module';
import { TechProcessModule } from './modules/tech-process/tech-process.module';
import { OrderTaskModule } from './modules/order-task/order-task.module';
import { ProductionOrderModule } from './modules/production-order/production-order.module';
import { WorkOrderModule } from './modules/work-order/work-order.module';
import { WorkOrderOperationModule } from './modules/work-order-operation/work-order-operation.module';
import { CostCalculationModule } from './modules/cost-calculation/cost-calculation.module';
import { ActualCostModule } from './modules/actual-cost/actual-cost.module';
import { OrderClosingModule } from './modules/order-closing/order-closing.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { StorageItemModule } from './modules/storage-item/storage-item.module';
import { StockMovementModule } from './modules/stock-movement/stock-movement.module';
import { ReservationModule } from './modules/reservation/reservation.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { PurchaseRequestModule } from './modules/purchase-request/purchase-request.module';
import { PurchaseOrderModule } from './modules/purchase-order/purchase-order.module';
import { SupplyModule } from './modules/supply/supply.module';
import { SupplyRequestModule } from './modules/supply/supply-request.module';
import { DeskNoteModule } from './modules/desk-note/desk-note.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { TenderModule } from './modules/tender/tender.module';
import { RppModule } from './modules/rpp/rpp.module';
import { QuotationModule } from './modules/quotation/quotation.module';
import { ContractModule } from './modules/contract/contract.module';
import { OrderModule } from './modules/order/order.module';
import { SiteModule } from './modules/site/site.module';
import { ShipmentModule } from './modules/shipment/shipment.module';
import { CartSessionModule } from './modules/cart-session/cart-session.module';
import { CartItemModule } from './modules/cart-item/cart-item.module';
import { DocTypeModule } from './modules/doc-type/doc-type.module';
import { DocumentTemplateModule } from './modules/document-template/document-template.module';
import { DocumentTemplateCategoryModule } from './modules/document-template-category/document-template-category.module';
import { TextBlockCategoryModule } from './modules/text-block-category/text-block-category.module';
import { ColorReferenceModule } from './modules/color-reference/color-reference.module';
import { DictionaryLabelModule } from './modules/dictionary-label/dictionary-label.module';
import { TemplateBlockModule } from './modules/template-block/template-block.module';
import { TextBlockModule } from './modules/text-block/text-block.module';
import { TableTemplateModule } from './modules/table-template/table-template.module';
import { GeneratedDocumentModule } from './modules/generated-document/generated-document.module';
import { StudioDocumentModule } from './modules/studio-document/studio-document.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { DocumentTableTypeModule } from './modules/document-table-type/document-table-type.module';
import { RegistryModule } from './modules/registry/registry.module';
import { ReconciliationActModule } from './modules/reconciliation-act/reconciliation-act.module';
import { FinancialReportModule } from './modules/financial-report/financial-report.module';
import { ImportJobsModule } from './modules/import-jobs/import-jobs.module';
import { CommentModule } from './modules/comment/comment.module';
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
import { CertificateModule } from './modules/certificate/certificate.module';
import { ComplianceRuleModule } from './modules/compliance-rule/compliance-rule.module';
import { ProductPassportModule } from './modules/product-passport/product-passport.module';
import { InventorFileModule } from './modules/inventor-file/inventor-file.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { UserContextInterceptor } from './common/interceptors/user-context.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AdminSeed } from './common/seed/admin.seed';
import { AdminPasswordDriftDetector } from './common/seed/admin-password-drift-detector';
import { SettingsSeed } from './common/seed/settings.seed';
import { FeatureFlagsSeed } from './common/seed/feature-flags.seed';
import { StatusesSeed } from './common/seed/statuses.seed';
import { OrgRolesSeed } from './common/seed/org-roles.seed';
import { CounterpartyRolesSeed } from './common/seed/counterparty-roles.seed';
import { UnitsSeed } from './common/seed/units.seed';
import { CategoriesSeed } from './common/seed/categories.seed';
import { WarehouseSeed } from './common/seed/warehouse.seed';
import { CurrenciesSeed } from './common/seed/currencies.seed';
import { DevFixturesSeed } from './common/seed/dev-fixtures.seed';
import { LocalDemoSeed } from './common/seed/local-demo.seed';
import { DocumentTemplateCategoriesSeed } from './common/seed/document-template-categories.seed';
import { BlankA4TemplateSeed } from './common/seed/blank-a4-template.seed';
import { TextBlockCategoriesSeed } from './common/seed/text-block-categories.seed';
import { ColorReferencesSeed } from './common/seed/color-references.seed';
import { BomComponentResolveService } from './modules/bom/migrations/bom-component-resolve.service';
import { HealthController } from './health.controller';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestMethod } from '@nestjs/common';

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
    CounterModule,
    PermissionsModule,
    RoleModule,
    UserModule,
    AuthModule,
    SettingModule,
    FormProfilesModule, // TZ-DICT-314: QuickCreate form profiles S/M/L
    FeatureFlagModule,
    DesktopModule,
    StatusModule,
    AuditModule,
    PersonModule,
    OrganizationModule,
    SiteModule, // TZ-ORDERS-303: площадки заказчика (до Counterparty/Order)
    CounterpartyModule,
    RoleOrgModule,
    RoleCounterpartyModule,
    InteractionModule,
    CategoryModule,
    UnitModule,
    MaterialModule,
    ProductModule,
    ProductPhotoModule,
    ProductModuleModule,
    ProductModulePhotoModule, // TZ-83 Фаза A.7: новая entity
    PhotosModule,
    AttachmentModule,
    MutationJournalModule,
    ImportTaskModule, // TZD-22: AI Import Task assembly point (no SoT / no journal)
    ImportMappingProfileModule, // TZD-37: org-scoped field mapping profiles
    ImportTodoModule, // TZD-29: manager import todos (finish list)
    BomModule,
    WorkCenterModule,
    WorkTypeModule,
    WorkerModule,
    RoutingStepModule,
    TechProcessModule,
    OrderTaskModule,
    ProductionOrderModule,
    WorkOrderModule,
    WorkOrderOperationModule,
    CostCalculationModule,
    ActualCostModule,
    OrderClosingModule,
    WarehouseModule,
    StorageItemModule,
    StockMovementModule,
    ReservationModule,
    InventoryModule,
    CurrencyModule,
    PurchaseRequestModule,
    PurchaseOrderModule,
    SupplyModule, // TZ-SUPPLY-301: задачи закупки + confirm
    SupplyRequestModule, // TZ-SUPPLY-305: быстрый заказ снабжения (строки + spawn в реестр)
    DeskNoteModule, // TZ-DESK-408: заметки стола (anchor order/line/module)
    InvoiceModule,
    TenderModule,
    RppModule,
    QuotationModule,
    ContractModule,
    OrderModule,
    ShipmentModule,
    CartSessionModule,
    CartItemModule,
    DocTypeModule,
    DocumentTemplateModule,
    // TZ-DOC-307: категории шаблонов документов (отдельная сущность)
    DocumentTemplateCategoryModule,
    // TZ-DOC-315/321: категории текстовых блоков + system «Общее» seed wiring
    TextBlockCategoryModule,
    // TZ-PRODUCTS-301: справочник цветов (RAL) — продуктовая словарная сущность
    ColorReferenceModule,
    DictionaryLabelModule,
    TemplateBlockModule,
    TextBlockModule, // TZ-86 Фаза A.1: новая entity для reusable text snippets
    TableTemplateModule,
    DocumentTableTypeModule,
    GeneratedDocumentModule,
    StudioDocumentModule, // TZ-DOC-STUDIO-201b: StudioDocument CRUD + org scope + revision gate
    UploadsModule, // TZ-DOC-STUDIO-1801: orphan upload sweep
    RegistryModule, // TZ-86 Фаза A.5: data-source catalogue for Document Constructor tool pane
    ReconciliationActModule,
    FinancialReportModule,
    ImportJobsModule,
    CommentModule,
    RateLimitModule,
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'long', ttl: 60000, limit: 100 },
    ]),
    AttributeDefinitionModule,
    EntityAttributeValueModule,
    CertificateModule,
    ComplianceRuleModule,
    ProductPassportModule,
    InventorFileModule,
    TerminusModule,
    PermissionsBootModule, // TZ-255: registers PermissionsBootValidator for OnApplicationBootstrap catalog scan
    AdminModule,            // TZ-257: /api/admin/users + /api/admin/roles (read-only slice)
    DeviceEnrollmentModule, // TZ-AUTH-303: /api/device/* + /api/admin/devices/*
    IdempotencyModule,      // TZ-247.A: registers IdempotencyStorageService + IdempotencyMiddleware
  ],
  controllers: [HealthController],
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
    WarehouseSeed,
    CurrenciesSeed,
    DevFixturesSeed,
    LocalDemoSeed,
    // TZ-DOC-307: системная default-категория шаблонов «Общее»
    DocumentTemplateCategoriesSeed,
    // TZ-DOC-STUDIO-2004: per-org sentinel «Пустой A4» for blank studio finalize
    BlankA4TemplateSeed,
    // TZ-DOC-315/321: системная default-категория текстовых блоков «Общее»
    TextBlockCategoriesSeed,
    // TZ-PRODUCTS-301: системный default-цвет «Не выбран»
    ColorReferencesSeed,
    // TZ-105.2: idempotent orphan FK migration (OnApplicationBootstrap lifecycle,
    // distinct from seeds' OnModuleInit per TZ-87 pattern). Dry-run default
    // via `BOM_MIGRATE_DRY_RUN=true`; set to "false" to apply migrations.
    BomComponentResolveService,
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
