import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ImportJobs, ImportJobsSchema } from './import-jobs.schema';
import { ImportJobsService } from './import-jobs.service';
import { ImportJobsController } from './import-jobs.controller';
import { Material, MaterialSchema } from '../material/material.schema';
import { Product, ProductSchema } from '../product/product.schema';
import { Counterparty, CounterpartySchema } from '../counterparty/counterparty.schema';
import { CounterModule } from '../counter/counter.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ImportJobs.name, schema: ImportJobsSchema },
      { name: Material.name, schema: MaterialSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Counterparty.name, schema: CounterpartySchema },
    ]),
    CounterModule,
  ],
  controllers: [ImportJobsController],
  providers: [ImportJobsService],
  exports: [ImportJobsService],
})
export class ImportJobsModule {}
