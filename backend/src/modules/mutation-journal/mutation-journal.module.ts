import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MaterialModule } from '../material/material.module';
import { ProductModule } from '../product/product.module';
import { CounterpartyModule } from '../counterparty/counterparty.module';
import { SiteModule } from '../site/site.module';
import { OrderModule } from '../order/order.module';
import {
  MutationJournal,
  MutationJournalSchema,
} from './mutation-journal.schema';
import { MutationJournalController } from './mutation-journal.controller';
import { MutationJournalService } from './mutation-journal.service';

@Module({
  imports: [
    MaterialModule,
    ProductModule,
    // TZD-ORDER-IMPORT-01 — order import HITL chain (counterparty/site/order create).
    CounterpartyModule,
    SiteModule,
    OrderModule,
    MongooseModule.forFeature([
      { name: MutationJournal.name, schema: MutationJournalSchema },
    ]),
  ],
  controllers: [MutationJournalController],
  providers: [MutationJournalService],
  exports: [MutationJournalService],
})
export class MutationJournalModule {}
