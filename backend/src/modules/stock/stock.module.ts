import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QrModule } from '../qr/qr.module';
import { CounterModule } from '../counter/counter.module';
import { StockZonesModule } from '../stock-zones/stock-zones.module';
import { Material, MaterialSchema } from '../material/material.schema';
import { Reservation, ReservationSchema } from './schemas/reservation.schema';
import { StockMovement, StockMovementSchema } from './schemas/stock-movement.schema';
import { StorageItem, StorageItemSchema } from './schemas/storage-item.schema';
import { Warehouse, WarehouseSchema } from './schemas/warehouse.schema';
import { StockController } from './stock.controller';
import { StockCatalogService } from './stock-catalog.service';
import { StockCatalogName, StockCatalogNameSchema } from './stock-catalog-name.schema';
import { StockCatalogNameService } from './stock-catalog-name.service';
import { StockCompositionService } from './stock-composition.service';
import { StockSummaryService } from './stock-summary.service';
import { StockSummaryController } from './stock-summary.controller';
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
    QrModule,
    StockZonesModule,
    MongooseModule.forFeature([
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: StorageItem.name, schema: StorageItemSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: Material.name, schema: MaterialSchema },
      { name: StockCatalogName.name, schema: StockCatalogNameSchema },
    ]),
  ],
  controllers: [StockController, StockSummaryController],
  providers: [StockCoreService, StockSearchService, StockCatalogNameService, StockCatalogService, StockMovementsService, StockReservationsService, StockSpecService, StockCompositionService, StockSummaryService, StockService],
  exports: [StockService],
})
export class StockModule {}
