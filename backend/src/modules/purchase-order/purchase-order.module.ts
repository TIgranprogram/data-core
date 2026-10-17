import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PurchaseOrder,
  PurchaseOrderSchema,
} from './purchase-order.schema';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { CounterModule } from '../counter/counter.module';
import { StockMovementModule } from '../stock-movement/stock-movement.module';
import { SessionRunner } from '../../common/db/session-runner';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
    ]),
    CounterModule,
    StockMovementModule,
  ],
  controllers: [PurchaseOrderController],
  providers: [PurchaseOrderService, SessionRunner],
  exports: [PurchaseOrderService, MongooseModule],
})
export class PurchaseOrderModule {}
