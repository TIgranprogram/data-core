import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  GeneratedDocument,
  GeneratedDocumentSchema,
} from './generated-document.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organization/organization.schema';
import { Quotation, QuotationSchema } from '../quotation/quotation.schema';
import { QuotationOutputService } from './quotation-output.service';
import { QuotationOutputController } from './quotation-output.controller';
import { GeneratedDocumentService } from './generated-document.service';
import { GeneratedDocumentController } from './generated-document.controller';
import { DocumentTemplateModule } from '../document-template/document-template.module';
import { CounterModule } from '../counter/counter.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GeneratedDocument.name, schema: GeneratedDocumentSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Quotation.name, schema: QuotationSchema },
    ]),
    DocumentTemplateModule,
    CounterModule,
  ],
  controllers: [GeneratedDocumentController, QuotationOutputController],
  providers: [GeneratedDocumentService, QuotationOutputService],
  exports: [GeneratedDocumentService, QuotationOutputService, MongooseModule],
})
export class GeneratedDocumentModule {}
