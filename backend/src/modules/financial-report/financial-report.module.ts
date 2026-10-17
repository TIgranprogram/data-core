import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FinancialReport, FinancialReportSchema } from './financial-report.schema';
import { FinancialReportService } from './financial-report.service';
import { FinancialReportController } from './financial-report.controller';
import { Invoice, InvoiceSchema } from '../invoice/invoice.schema';
import { ActualCost, ActualCostSchema } from '../actual-cost/actual-cost.schema';
import { PurchaseOrder, PurchaseOrderSchema } from '../purchase-order/purchase-order.schema';
import { CounterModule } from '../counter/counter.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FinancialReport.name, schema: FinancialReportSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: ActualCost.name, schema: ActualCostSchema },
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
    ]),
    CounterModule,
  ],
  controllers: [FinancialReportController],
  providers: [FinancialReportService],
  exports: [FinancialReportService],
})
export class FinancialReportModule {}
