import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EntityStatus, EntityStatusSchema } from './entity-status.schema';
import { StatusWorkflow, StatusWorkflowSchema } from './status-workflow.schema';
import { StatusService } from './status.service';
import { StatusController } from './status.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EntityStatus.name, schema: EntityStatusSchema },
      { name: StatusWorkflow.name, schema: StatusWorkflowSchema },
    ]),
  ],
  controllers: [StatusController],
  providers: [StatusService],
  exports: [StatusService, MongooseModule],
})
export class StatusModule {}
