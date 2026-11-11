import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductPassport, ProductPassportSchema } from './product-passport.schema';
import { PassportTemplate, PassportTemplateSchema } from './passport-template.schema';
import { PassportLook, PassportLookSchema } from './passport-look.schema';
import { ProductPassportService } from './product-passport.service';
import { PassportPdfService } from './passport-pdf.service';
import { PassportLookService } from './passport-look.service';
import { ProductPassportController } from './product-passport.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductPassport.name, schema: ProductPassportSchema },
      { name: PassportTemplate.name, schema: PassportTemplateSchema },
      { name: PassportLook.name, schema: PassportLookSchema },
    ]),
  ],
  controllers: [ProductPassportController],
  providers: [ProductPassportService, PassportPdfService, PassportLookService],
  exports: [ProductPassportService],
})
export class ProductPassportModule {}
