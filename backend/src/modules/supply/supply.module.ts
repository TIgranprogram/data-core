import { SupplyUndatedPaymentsService } from './supply-undated-payments.service';
import { ExpenseArticlesModule } from '../expense-articles/expense-articles.module';
import { SupplyInvoicePaymentsService } from './supply-invoice-payments.service';
import { SupplyInvoicePayment, SupplyInvoicePaymentSchema } from './supply-invoice-payment.schema';
import { Module } from '@nestjs/common';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { CounterModule } from '../counter/counter.module';
import { ZonesModule } from '../zones/zones.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SalesOrdersModule } from '../salesorders/salesorders.module';
import { MaterialModule } from '../material/material.module';
import { StockModule } from '../stock/stock.module';
import { PhotosModule } from '../photos/photos.module';
import { SupplyController } from './supply.controller';
import { SupplyRequest, SupplyRequestSchema } from './supply-request.schema';
import { SupplierItem, SupplierItemSchema } from './supplier-item.schema';
import { SupplyInvoice, SupplyInvoiceSchema } from './supply-invoice.schema';
import { SupplierContract, SupplierContractSchema } from './supplier-contract.schema';
import { SupplierContractService } from './supplier-contract.service';
import { SupplierContractController } from './supplier-contract.controller';
import { SupplyInvoiceService } from './supply-invoice.service';
import { SupplyInvoiceIntakeController } from './supply-invoice-intake.controller';
import { SupplyIntakeReviewController, ReviewUploadGuard } from './supply-intake-review.controller';
import { SupplyIntakeReviewService } from './supply-intake-review.service';
import { SupplyIntakeReview, SupplyIntakeReviewSchema } from './supply-intake-review.schema';
import { SupplyInvoiceIntakeService } from './supply-invoice-intake.service';
import { SupplyService } from './supply.service';
import { SupplierExcelService } from './supplier-excel.service';
import { SupplierCatalogService } from './supplier-catalog.service';

/** /api/supply — заявки снабжения на общей коллекции CRM kppdf (docs/UNIFY-SUPPLY-WAREHOUSE.md). */
@Module({
  imports: [
    FeatureFlagModule,
    ExpenseArticlesModule,
    StockModule,
    PhotosModule,
    AuditModule,
    CounterModule,
    NotificationsModule,
    ZonesModule,
    SalesOrdersModule,
    MaterialModule,
    MongooseModule.forFeature([
      { name: SupplyRequest.name, schema: SupplyRequestSchema },
      { name: SupplyIntakeReview.name, schema: SupplyIntakeReviewSchema },
      { name: SupplierItem.name, schema: SupplierItemSchema },
      { name: SupplyInvoice.name, schema: SupplyInvoiceSchema },
      { name: SupplyInvoicePayment.name, schema: SupplyInvoicePaymentSchema },
      { name: SupplierContract.name, schema: SupplierContractSchema },
    ]),
  ],
  controllers: [SupplyIntakeReviewController, SupplyInvoiceIntakeController, SupplyController, SupplierContractController],
  providers: [SupplyUndatedPaymentsService, SupplyInvoicePaymentsService, SupplyService, SupplierExcelService, SupplierCatalogService, SupplyInvoiceService, SupplyInvoiceIntakeService, SupplyIntakeReviewService, ReviewUploadGuard, SupplierContractService],
  exports: [SupplyService],
})
export class SupplyModule {}
