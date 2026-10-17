import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TechProcess, TechProcessSchema } from './tech-process.schema';
import { TechProcessService } from './tech-process.service';
import { TechProcessController } from './tech-process.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TechProcess.name, schema: TechProcessSchema },
    ]),
  ],
  controllers: [TechProcessController],
  providers: [TechProcessService],
  exports: [TechProcessService, MongooseModule],
})
export class TechProcessModule {}
