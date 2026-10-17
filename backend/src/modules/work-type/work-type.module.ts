import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkType, WorkTypeSchema } from './work-type.schema';
import { WorkTypeService } from './work-type.service';
import { WorkTypeController } from './work-type.controller';
import { CatalogGraphModule } from '../catalog-graph/catalog-graph.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WorkType.name, schema: WorkTypeSchema }]),
    CatalogGraphModule,
  ],
  controllers: [WorkTypeController],
  providers: [WorkTypeService],
  exports: [WorkTypeService, MongooseModule],
})
export class WorkTypeModule {}
