import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DictionaryLabel,
  DictionaryLabelSchema,
} from './dictionary-label.schema';
import { DictionaryLabelService } from './dictionary-label.service';
import { DictionaryLabelController } from './dictionary-label.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DictionaryLabel.name, schema: DictionaryLabelSchema },
    ]),
  ],
  controllers: [DictionaryLabelController],
  providers: [DictionaryLabelService],
  exports: [DictionaryLabelService, MongooseModule],
})
export class DictionaryLabelModule {}
