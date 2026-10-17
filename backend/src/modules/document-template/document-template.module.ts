import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DocumentTemplate,
  DocumentTemplateSchema,
} from './document-template.schema';
import { DocumentTemplateService } from './document-template.service';
import { DocumentTemplateController } from './document-template.controller';
import { DocumentRenderModule } from '../document-render/document-render.module';
import { TemplateBlockModule } from '../template-block/template-block.module';
import { QuotationModule } from '../quotation/quotation.module';
import { ContractModule } from '../contract/contract.module';
import { OrderModule } from '../order/order.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { CounterModule } from '../counter/counter.module';
import { OrganizationModule } from '../organization/organization.module';
import { PersonModule } from '../person/person.module';
import { SiteModule } from '../site/site.module';
import { CounterpartyModule } from '../counterparty/counterparty.module';
import { ProductModule } from '../product/product.module';
import { MaterialModule } from '../material/material.module';
import { WorkTypeModule } from '../work-type/work-type.module';
import { TableTemplateModule } from '../table-template/table-template.module';
import { TextBlockModule } from '../text-block/text-block.module';
import { OwnershipGuard } from '../../common/guards/ownership/ownership.guard';
import { DocumentTemplateCategoryModule } from '../document-template-category/document-template-category.module';
import { DocTypeModule } from '../doc-type/doc-type.module';

/**
 * TZ-86 Phase A.4 — DocumentTemplateModule extended.
 *
 * TZ-251 §ШАГ 2 — Ownership guard is registered as a per-module provider
 * because it needs `@InjectModel(DocumentTemplate.name)` to work. Mongoose
 * models are module-scoped (the `forFeature` registration below), so a
 * guard that needs to read from this model must live in this module's DI
 * scope. A future cross-entity registry (TZ-251.A) can lift it to a
 * generic provider.
 *
 * @UseGuards(OwnershipGuard) on the controller class activates the guard
 * for every route in this controller. The `@OwnerOnly(entityKey)`
 * metadata is read INSIDE the guard's `canActivate()` — routes that
 * don't carry `@OwnerOnly` short-circuit to true.
 *
 * TZ-DOC-307 — DocumentTemplateCategoryModule is imported so the service
 * can resolve/validate the template category contract (default + scope).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DocumentTemplate.name, schema: DocumentTemplateSchema },
    ]),
    DocumentRenderModule,
    TemplateBlockModule,
    QuotationModule,
    ContractModule,
    OrderModule,
    InvoiceModule,
    CounterModule,
    // TZ-86 Phase A.4 — data source models for build()
    OrganizationModule,
    PersonModule,
    SiteModule,
    CounterpartyModule,
    ProductModule,
    MaterialModule,
    WorkTypeModule,
    TableTemplateModule,
    TextBlockModule,
    // TZ-DOC-307 — document-template categories
    DocumentTemplateCategoryModule,
    // TZ-DOC-STUDIO-2004 — blank A4 sentinel needs active DocType lookup
    DocTypeModule,
  ],
  controllers: [DocumentTemplateController],
  providers: [DocumentTemplateService, OwnershipGuard],
  exports: [DocumentTemplateService, MongooseModule],
})
export class DocumentTemplateModule {}
