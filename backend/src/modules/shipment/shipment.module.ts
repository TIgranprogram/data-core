import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Shipment, ShipmentSchema } from './shipment.schema';
import { Order, OrderSchema } from '../order/order.schema';
import { ShipmentService } from './shipment.service';
import { ShipmentController } from './shipment.controller';
import { CounterModule } from '../counter/counter.module';
import { StockMovementModule } from '../stock-movement/stock-movement.module';
import { ReservationModule } from '../reservation/reservation.module';
import { SessionRunner } from '../../common/db/session-runner';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Shipment.name, schema: ShipmentSchema }]),
    // TZ-SHIP-433: cancel-shipment откатывает Order.status — модель нужна в этой транзакции.
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    CounterModule,
    StockMovementModule,
    ReservationModule,
  ],
  controllers: [ShipmentController],
  providers: [ShipmentService, SessionRunner],
  exports: [ShipmentService, MongooseModule],
})
export class ShipmentModule {}
