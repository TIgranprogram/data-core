import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReconciliationAct, ReconciliationActSchema } from './reconciliation-act.schema';
import { ReconciliationActService } from './reconciliation-act.service';
import { ReconciliationActController } from './reconciliation-act.controller';
import { Invoice, InvoiceSchema } from '../invoice/invoice.schema';
import { Counterparty, CounterpartySchema } from '../counterparty/counterparty.schema';
import { CounterModule } from '../counter/counter.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReconciliationAct.name, schema: ReconciliationActSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Counterparty.name, schema: CounterpartySchema },
    ]),
    CounterModule,
  ],
  controllers: [ReconciliationActController],
  providers: [ReconciliationActService],
  exports: [ReconciliationActService],
})
export class ReconciliationActModule {}
