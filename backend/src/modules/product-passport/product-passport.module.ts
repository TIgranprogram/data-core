import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductPassport, ProductPassportSchema } from './product-passport.schema';
import { ProductPassportService } from './product-passport.service';
import { ProductPassportController } from './product-passport.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductPassport.name, schema: ProductPassportSchema },
    ]),
  ],
  controllers: [ProductPassportController],
  providers: [ProductPassportService],
  exports: [ProductPassportService],
})
export class ProductPassportModule {}
