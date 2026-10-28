import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/** /api/payroll — ФОТ: табель, начисления, выплаты. Коллекции payroll_timesheets, payroll_payments; ставки — persons. */
@Module({
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
