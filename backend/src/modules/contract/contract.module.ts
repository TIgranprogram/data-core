import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contract, ContractSchema } from './contract.schema';
import { ContractService } from './contract.service';
import { ContractController } from './contract.controller';
import { CounterModule } from '../counter/counter.module';
import { OrderModule } from '../order/order.module';
import { SiteModule } from '../site/site.module';
import { SessionRunner } from '../../common/db/session-runner';
import { PhotosModule } from '../photos/photos.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Contract.name, schema: ContractSchema }]),
    CounterModule,
    OrderModule,
    SiteModule,
    PhotosModule,
  ],
  controllers: [ContractController],
  providers: [ContractService, SessionRunner],
  exports: [ContractService, MongooseModule],
})
export class ContractModule {}
