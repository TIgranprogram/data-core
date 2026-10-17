import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageItem, StorageItemSchema } from './storage-item.schema';
import { StorageItemService } from './storage-item.service';
import { StorageItemController } from './storage-item.controller';
import {
  StockMovement,
  StockMovementSchema,
} from '../stock-movement/stock-movement.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StorageItem.name, schema: StorageItemSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
    ]),
  ],
  controllers: [StorageItemController],
  providers: [StorageItemService],
  exports: [StorageItemService, MongooseModule],
})
export class StorageItemModule {}
