import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockModule } from '../stock/stock.module';
import { SupplyController } from './supply.controller';
import { SupplyRequest, SupplyRequestSchema } from './supply-request.schema';
import { SupplyService } from './supply.service';

/** /api/supply — заявки снабжения на общей коллекции CRM kppdf (docs/UNIFY-SUPPLY-WAREHOUSE.md). */
@Module({
  imports: [StockModule, MongooseModule.forFeature([{ name: SupplyRequest.name, schema: SupplyRequestSchema }])],
  controllers: [SupplyController],
  providers: [SupplyService],
  exports: [SupplyService],
})
export class SupplyModule {}
