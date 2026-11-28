import { PassportSourceService } from './passport-source.service';
import { PassportImportService } from './passport-import.service';
import { PassportInstallSeed } from './passport-install.seed';
import { ProductAttachmentsModule } from '../productattachments/productattachments.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductPassport, ProductPassportSchema } from './product-passport.schema';
import { PassportTemplate, PassportTemplateSchema } from './passport-template.schema';
import { PassportLook, PassportLookSchema } from './passport-look.schema';
import { ProductPassportService } from './product-passport.service';
import { PassportPdfService } from './passport-pdf.service';
import { PassportLookService } from './passport-look.service';
import { PassportHandover, PassportHandoverSchema } from './passport-handover.schema';
import { PassportRegistryController } from './passport-registry.controller';
import { PassportRegistryService } from './passport-registry.service';
import { ProductPassportController } from './product-passport.controller';

@Module({
  imports: [
    ProductAttachmentsModule,
    MongooseModule.forFeature([
      { name: ProductPassport.name, schema: ProductPassportSchema },
      { name: PassportTemplate.name, schema: PassportTemplateSchema },
      { name: PassportLook.name, schema: PassportLookSchema },
      { name: PassportHandover.name, schema: PassportHandoverSchema },
    ]),
  ],
  controllers: [PassportRegistryController, ProductPassportController],
  providers: [PassportRegistryService, PassportImportService, PassportInstallSeed, PassportSourceService, ProductPassportService, PassportPdfService, PassportLookService],
  exports: [ProductPassportService],
})
export class ProductPassportModule {}
