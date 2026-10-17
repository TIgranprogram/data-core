import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { StorageItemModule } from '../storage-item/storage-item.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { StockMovementModule } from '../stock-movement/stock-movement.module';

@Module({
  imports: [StorageItemModule, WarehouseModule, StockMovementModule],
  controllers: [InventoryController],
})
export class InventoryModule {}
