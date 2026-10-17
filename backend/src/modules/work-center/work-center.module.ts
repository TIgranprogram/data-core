import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkCenter, WorkCenterSchema } from './work-center.schema';
import { WorkCenterService } from './work-center.service';
import { WorkCenterController } from './work-center.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WorkCenter.name, schema: WorkCenterSchema }]),
  ],
  controllers: [WorkCenterController],
  providers: [WorkCenterService],
  exports: [WorkCenterService, MongooseModule],
})
export class WorkCenterModule {}
