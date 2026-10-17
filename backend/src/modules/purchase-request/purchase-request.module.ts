import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PurchaseRequest,
  PurchaseRequestSchema,
} from './purchase-request.schema';
import { PurchaseRequestService } from './purchase-request.service';
import { PurchaseRequestController } from './purchase-request.controller';
import { CounterModule } from '../counter/counter.module';
import {
  PurchaseOrder,
  PurchaseOrderSchema,
} from '../purchase-order/purchase-order.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PurchaseRequest.name, schema: PurchaseRequestSchema },
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
    ]),
    CounterModule,
  ],
  controllers: [PurchaseRequestController],
  providers: [PurchaseRequestService],
  exports: [PurchaseRequestService, MongooseModule],
})
export class PurchaseRequestModule {}
