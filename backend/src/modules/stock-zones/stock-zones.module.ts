import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockZone, StockZoneSchema } from './stock-zone.schema';
import { StockZonesController } from './stock-zones.controller';
import { StockZonesService } from './stock-zones.service';

/** /api/stockzones — справочник «Склады»; кэш доступа к складам для всех модулей (common/stock-scope.ts). */
@Module({
  imports: [MongooseModule.forFeature([{ name: StockZone.name, schema: StockZoneSchema }])],
  controllers: [StockZonesController],
  providers: [StockZonesService],
  exports: [StockZonesService],
})
export class StockZonesModule {}
