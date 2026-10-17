import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ImportTask, ImportTaskSchema } from './import-task.schema';
import { ImportTaskController } from './import-task.controller';
import { ImportTaskService } from './import-task.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ImportTask.name, schema: ImportTaskSchema },
    ]),
  ],
  controllers: [ImportTaskController],
  providers: [ImportTaskService],
  exports: [ImportTaskService],
})
export class ImportTaskModule {}
