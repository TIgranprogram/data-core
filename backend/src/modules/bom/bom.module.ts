import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Bom, BomSchema } from './bom.schema';
import { BomService } from './bom.service';
import { BomController } from './bom.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Bom.name, schema: BomSchema }])],
  controllers: [BomController],
  providers: [BomService],
  exports: [BomService, MongooseModule],
})
export class BomModule {}
