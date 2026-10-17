import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InventorFile, InventorFileSchema } from './inventor-file.schema';
import { InventorFileService } from './inventor-file.service';
import { InventorFileController } from './inventor-file.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InventorFile.name, schema: InventorFileSchema },
    ]),
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [InventorFileController],
  providers: [InventorFileService],
  exports: [InventorFileService],
})
export class InventorFileModule {}
