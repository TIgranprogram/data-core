import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductModulePhoto,
  ProductModulePhotoSchema,
} from './product-module-photo.schema';
import { ProductModulePhotoService } from './product-module-photo.service';
import { ProductModulePhotoController } from './product-module-photo.controller';
import { ProductModule, ProductModuleSchema } from '../product-module/product-module.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductModulePhoto.name, schema: ProductModulePhotoSchema },
      { name: ProductModule.name, schema: ProductModuleSchema },
    ]),
  ],
  controllers: [ProductModulePhotoController],
  providers: [ProductModulePhotoService],
  exports: [ProductModulePhotoService, MongooseModule],
})
export class ProductModulePhotoModule {}
