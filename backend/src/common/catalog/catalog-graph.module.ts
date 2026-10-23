import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Material, MaterialSchema } from '../../modules/material/material.schema';
import { Photo, PhotoSchema } from '../../modules/photos/photo.schema';
import { Product, ProductSchema } from './product.schema';
import { ProductModule, ProductModuleSchema } from './product-module.schema';
import { CatalogGraphService } from './catalog-graph.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: ProductModule.name, schema: ProductModuleSchema },
      { name: Material.name, schema: MaterialSchema },
      { name: Photo.name, schema: PhotoSchema },
    ]),
  ],
  providers: [CatalogGraphService],
  exports: [CatalogGraphService],
})
export class CatalogGraphModule {}
