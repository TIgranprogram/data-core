import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockMovement, StockMovementSchema } from './stock-movement.schema';
import { StockMovementService } from './stock-movement.service';
import { StockMovementController } from './stock-movement.controller';
import { StorageItem, StorageItemSchema } from '../storage-item/storage-item.schema';
import { Material, MaterialSchema } from '../material/material.schema';
import { Product, ProductSchema } from '../product/product.schema';
import { Warehouse, WarehouseSchema } from '../warehouse/warehouse.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: StorageItem.name, schema: StorageItemSchema },
      // TZ-NX-WH-INV-BE-BATCH — batch inventory resolves article/sku/warehouseName
      // to concrete ids server-side (same schema-registration pattern
      // WarehouseModule already uses in reverse for StockMovement/StorageItem).
      { name: Material.name, schema: MaterialSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Warehouse.name, schema: WarehouseSchema },
    ]),
  ],
  controllers: [StockMovementController],
  providers: [StockMovementService],
  exports: [StockMovementService, MongooseModule],
})
export class StockMovementModule {}
