import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from './product.schema';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ProductSubroutesController } from './product-subroutes.controller';
import { Category, CategorySchema } from '../category/category.schema';
import { ProductModule as ProductModuleEntity, ProductModuleSchema } from '../product-module/product-module.schema';
import { Material, MaterialSchema } from '../material/material.schema';
import { CounterModule } from '../counter/counter.module';
import { CompositionLineService } from '../catalog/composition-line.service';
import { CatalogGraphModule } from '../catalog-graph/catalog-graph.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Category.name, schema: CategorySchema },
      { name: ProductModuleEntity.name, schema: ProductModuleSchema },
      { name: Material.name, schema: MaterialSchema },
    ]),
    CounterModule,
    CatalogGraphModule,
  ],
  controllers: [ProductController, ProductSubroutesController],
  providers: [ProductService, CompositionLineService],
  exports: [ProductService, MongooseModule],
})
export class ProductModule {}
