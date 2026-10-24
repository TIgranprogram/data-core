import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CounterModule } from '../counter/counter.module';
import { Material, MaterialSchema } from '../material/material.schema';
import { Reservation, ReservationSchema } from './schemas/reservation.schema';
import { StockMovement, StockMovementSchema } from './schemas/stock-movement.schema';
import { StorageItem, StorageItemSchema } from './schemas/storage-item.schema';
import { Warehouse, WarehouseSchema } from './schemas/warehouse.schema';
import { StockController } from './stock.controller';
import { StockCatalogService } from './stock-catalog.service';
import { StockCompositionService } from './stock-composition.service';
import { StockCoreService } from './stock-core.service';
import { StockMovementsService } from './stock-movements.service';
import { StockReservationsService } from './stock-reservations.service';
import { StockSearchService } from './stock-search.service';
import { StockSpecService } from './stock-spec.service';
import { StockService } from './stock.service';

/** /api/stock — склад на общих коллекциях CRM kppdf (docs/UNIFY-SUPPLY-WAREHOUSE.md). */
@Module({
  imports: [
    CounterModule,
    MongooseModule.forFeature([
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: StorageItem.name, schema: StorageItemSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: Material.name, schema: MaterialSchema },
    ]),
  ],
  controllers: [StockController],
  providers: [StockCoreService, StockSearchService, StockCatalogService, StockMovementsService, StockReservationsService, StockSpecService, StockCompositionService, StockService],
  exports: [StockService],
})
export class StockModule {}
