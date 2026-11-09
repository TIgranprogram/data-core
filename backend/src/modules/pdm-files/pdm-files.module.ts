import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PdmFile, PdmFileSchema } from './pdm-file.schema';
import { PdmFilesController } from './pdm-files.controller';
import { PdmFilesService } from './pdm-files.service';

/** /api/pdm-files — файлы PDF/DXF из PDM с версиями (`pdmfiles`), на диске `uploads/pdm/`. Запись зовёт модуль pdm-import. */
@Module({
  imports: [MongooseModule.forFeature([{ name: PdmFile.name, schema: PdmFileSchema }])],
  controllers: [PdmFilesController],
  providers: [PdmFilesService],
  exports: [PdmFilesService],
})
export class PdmFilesModule {}
