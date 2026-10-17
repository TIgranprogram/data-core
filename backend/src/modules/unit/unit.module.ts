import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Unit, UnitSchema } from './unit.schema';
import { UnitService } from './unit.service';
import { UnitController } from './unit.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Unit.name, schema: UnitSchema }]),
  ],
  controllers: [UnitController],
  providers: [UnitService],
  exports: [UnitService, MongooseModule],
})
export class UnitModule {}
