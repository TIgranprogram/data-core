import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CounterModule } from '../counter/counter.module';
import { Shipment, ShipmentSchema } from './shipment.schema';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

/** /api/salesorders/:id/shipments, /api/shipments/:id — отгрузки заказов (`shipments`). */
@Module({
  imports: [MongooseModule.forFeature([{ name: Shipment.name, schema: ShipmentSchema }]), CounterModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService],
})
export class ShipmentsModule {}
