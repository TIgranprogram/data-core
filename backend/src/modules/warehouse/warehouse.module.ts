import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Warehouse, WarehouseSchema } from './warehouse.schema';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';
import {
  StorageItem,
  StorageItemSchema,
} from '../storage-item/storage-item.schema';
import {
  StockMovement,
  StockMovementSchema,
} from '../stock-movement/stock-movement.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: StorageItem.name, schema: StorageItemSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
    ]),
  ],
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService, MongooseModule],
})
export class WarehouseModule {}
