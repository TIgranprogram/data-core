import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CostCalculation,
  CostCalculationSchema,
} from './cost-calculation.schema';
import { CostCalculationService } from './cost-calculation.service';
import { CostCalculationController } from './cost-calculation.controller';
import { ProductModule } from '../product/product.module';
import { Product, ProductSchema } from '../product/product.schema';
import { ProductModule as ProductModuleEntity, ProductModuleSchema } from '../product-module/product-module.schema';
import { Material, MaterialSchema } from '../material/material.schema';
import { WorkType, WorkTypeSchema } from '../work-type/work-type.schema';

/**
 * TZ-85 Phase A: module DI update.
 *
 * Previously this module registered `Bom`, `TechProcess`, `WorkType`,
 * `Material` schemas because `CostCalculationService.create()` queried
 * those collections directly. After the rewrite the service only needs
 * the `ProductModel` (for the deep `productModuleIds → materials/workTypes`
 * populate chain) — and `ProductModuleModule` re-registers `ProductModule`
 * under the same MongooseModule, so the inner populate target is also
 * available without an extra `forFeature` entry.
 *
 * Importing `ProductModule` (the NestJS module from
 * `backend/src/modules/product/product.module.ts`) brings in:
 *  - `ProductModel` (used by the service)
 *  - `ProductModuleModel` (used by the populate chain — registered via
 *    `MongooseModule.forFeature` inside `ProductModule`)
 *  - the re-exported `MongooseModule` (so downstream consumers of this
 *    module can still inject the CostCalculation model if they need to).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CostCalculation.name, schema: CostCalculationSchema },
      { name: Product.name, schema: ProductSchema },
      { name: ProductModuleEntity.name, schema: ProductModuleSchema },
      { name: Material.name, schema: MaterialSchema },
      { name: WorkType.name, schema: WorkTypeSchema },
    ]),
    ProductModule,
  ],
  controllers: [CostCalculationController],
  providers: [CostCalculationService],
  exports: [CostCalculationService, MongooseModule],
})
export class CostCalculationModule {}
