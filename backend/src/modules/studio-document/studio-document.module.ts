import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../product/product.schema';
import { ProductModule as ProductModuleEntity, ProductModuleSchema } from '../product-module/product-module.schema';
import { Material, MaterialSchema } from '../material/material.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organization/organization.schema';
import { Photo, PhotoSchema } from '../photos/photo.schema';
import {
  StudioDocument,
  StudioDocumentSchema,
} from './studio-document.schema';
import { StudioDocumentService } from './studio-document.service';
import { StudioDocumentController } from './studio-document.controller';
import { TemplateBlockModule } from '../template-block/template-block.module';
import { DocumentTemplateModule } from '../document-template/document-template.module';
import { DocumentRenderModule } from '../document-render/document-render.module';
import { GeneratedDocumentModule } from '../generated-document/generated-document.module';
import { QuotationModule } from '../quotation/quotation.module';
import { OrderModule } from '../order/order.module';
import { DocType, DocTypeSchema } from '../doc-type/doc-type.schema';
import { StudioOutputService } from './studio-output.service';
import { StudioDataResolverService } from './studio-data-resolver';
import { StudioQuotationLifecycleService } from './studio-quotation-lifecycle.service';
import { OrganizationModule } from '../organization/organization.module';

/**
 * TZ-DOC-STUDIO-201b — StudioDocument module (persistence + org scope + revision API).
 * TZ-DOC-STUDIO-401 — nested blocks facade via TemplateBlockModule.
 * Wave 9–10 — preview/finalize/pdf via StudioOutputService.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StudioDocument.name, schema: StudioDocumentSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Product.name, schema: ProductSchema },
      { name: ProductModuleEntity.name, schema: ProductModuleSchema },
      { name: Material.name, schema: MaterialSchema },
      { name: DocType.name, schema: DocTypeSchema },
      { name: Photo.name, schema: PhotoSchema },
    ]),
    TemplateBlockModule,
    DocumentTemplateModule,
    DocumentRenderModule,
    GeneratedDocumentModule,
    QuotationModule,
    OrderModule,
    OrganizationModule,
  ],
  controllers: [StudioDocumentController],
  providers: [StudioDocumentService, StudioOutputService, StudioDataResolverService, StudioQuotationLifecycleService],
  exports: [StudioDocumentService, MongooseModule],
})
export class StudioDocumentModule {}
