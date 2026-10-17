import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductPhoto, ProductPhotoSchema } from './product-photo.schema';
import { ProductPhotoService } from './product-photo.service';
import { ProductPhotoController } from './product-photo.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProductPhoto.name, schema: ProductPhotoSchema }]),
  ],
  controllers: [ProductPhotoController],
  providers: [ProductPhotoService],
  exports: [ProductPhotoService, MongooseModule],
})
export class ProductPhotoModule {}
