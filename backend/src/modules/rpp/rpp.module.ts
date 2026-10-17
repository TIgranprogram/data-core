import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Rpp, RppSchema } from './rpp.schema';
import { RppService } from './rpp.service';
import { RppController } from './rpp.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Rpp.name, schema: RppSchema }]),
  ],
  controllers: [RppController],
  providers: [RppService],
  exports: [RppService, MongooseModule],
})
export class RppModule {}
