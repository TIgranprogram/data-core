import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductModule as ProductModuleEntity, ProductModuleSchema } from './product-module.schema';
import { ProductModuleService } from './product-module.service';
import { ProductModuleController } from './product-module.controller';
import { Product, ProductSchema } from '../product/product.schema';
import { Material, MaterialSchema } from '../material/material.schema';
import { Category, CategorySchema } from '../category/category.schema';
import { CompositionLineService } from '../catalog/composition-line.service';
import { CatalogGraphModule } from '../catalog-graph/catalog-graph.module';

/**
 * TZ-83: ProductModuleService uses Product for M:N reverse lookup and
 * Material for TZ-MATERIALS-309 immutable-dimension enforcement.
 * TZ-COST-302 cost-preview удалён вместе с модулем cost-calculation (чистка CRM-домена).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductModuleEntity.name, schema: ProductModuleSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Material.name, schema: MaterialSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
    CatalogGraphModule,
  ],
  controllers: [ProductModuleController],
  providers: [ProductModuleService, CompositionLineService],
  exports: [ProductModuleService, MongooseModule],
})
export class ProductModuleModule {}
