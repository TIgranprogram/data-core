import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { PayrollModule } from '../payroll/payroll.module';
import { ExpenseArticlesModule } from '../expense-articles/expense-articles.module';
import { FinanceService } from './finance.service';

/** /api/finance — платёжный календарь и сводка (расчёт по supplyrequests + incomes, без своих таблиц). */
@Module({
  imports: [PayrollModule, ExpenseArticlesModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
