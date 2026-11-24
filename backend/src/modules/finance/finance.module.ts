import { FinancialOperationsReader } from './financial-operations-reader.service';
import { FinancialClassificationService } from './financial-classification.service';
import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { PayrollModule } from '../payroll/payroll.module';
import { ExpenseArticlesModule } from '../expense-articles/expense-articles.module';
import { SupplyModule } from '../supply/supply.module';
import { FinanceService } from './finance.service';

/** /api/finance — платёжный календарь и сводка (расчёт по supplyrequests + incomes, без своих таблиц). */
@Module({
  imports: [PayrollModule, ExpenseArticlesModule, SupplyModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinancialOperationsReader, FinancialClassificationService],
  exports: [FinanceService],
})
export class FinanceModule {}
