import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ColorReference,
  ColorReferenceSchema,
} from './color-reference.schema';
import { ColorReferenceService } from './color-reference.service';
import { ColorReferenceController } from './color-reference.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ColorReference.name, schema: ColorReferenceSchema },
    ]),
  ],
  controllers: [ColorReferenceController],
  providers: [ColorReferenceService],
  exports: [ColorReferenceService, MongooseModule],
})
export class ColorReferenceModule {}
