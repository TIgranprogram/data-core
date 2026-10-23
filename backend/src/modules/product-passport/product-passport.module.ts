import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductPassport, ProductPassportSchema } from './product-passport.schema';
import { PassportTemplate, PassportTemplateSchema } from './passport-template.schema';
import { ProductPassportService } from './product-passport.service';
import { PassportPdfService } from './passport-pdf.service';
import { ProductPassportController } from './product-passport.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductPassport.name, schema: ProductPassportSchema },
      { name: PassportTemplate.name, schema: PassportTemplateSchema },
    ]),
  ],
  controllers: [ProductPassportController],
  providers: [ProductPassportService, PassportPdfService],
  exports: [ProductPassportService],
})
export class ProductPassportModule {}
