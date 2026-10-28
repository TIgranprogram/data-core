import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications/notifications.module';
import { SalesOrdersModule } from '../salesorders/salesorders.module';
import { MaterialModule } from '../material/material.module';
import { StockModule } from '../stock/stock.module';
import { SupplyController } from './supply.controller';
import { SupplyRequest, SupplyRequestSchema } from './supply-request.schema';
import { SupplierItem, SupplierItemSchema } from './supplier-item.schema';
import { SupplyInvoice, SupplyInvoiceSchema } from './supply-invoice.schema';
import { SupplyInvoiceService } from './supply-invoice.service';
import { SupplyService } from './supply.service';
import { SupplierExcelService } from './supplier-excel.service';
import { SupplierCatalogService } from './supplier-catalog.service';

/** /api/supply — заявки снабжения на общей коллекции CRM kppdf (docs/UNIFY-SUPPLY-WAREHOUSE.md). */
@Module({
  imports: [
    StockModule,
    NotificationsModule,
    SalesOrdersModule,
    MaterialModule,
    MongooseModule.forFeature([
      { name: SupplyRequest.name, schema: SupplyRequestSchema },
      { name: SupplierItem.name, schema: SupplierItemSchema },
      { name: SupplyInvoice.name, schema: SupplyInvoiceSchema },
    ]),
  ],
  controllers: [SupplyController],
  providers: [SupplyService, SupplierExcelService, SupplierCatalogService, SupplyInvoiceService],
  exports: [SupplyService],
})
export class SupplyModule {}
