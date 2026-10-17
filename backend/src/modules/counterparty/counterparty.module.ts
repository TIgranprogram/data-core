import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Counterparty, CounterpartySchema } from './counterparty.schema';
import { CounterpartyService } from './counterparty.service';
import { CounterpartyController } from './counterparty.controller';
import { SiteModule } from '../site/site.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Counterparty.name, schema: CounterpartySchema }]),
    SiteModule,
  ],
  controllers: [CounterpartyController],
  providers: [CounterpartyService],
  exports: [CounterpartyService, MongooseModule],
})
export class CounterpartyModule {}
