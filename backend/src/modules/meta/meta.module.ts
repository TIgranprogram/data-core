import { Module } from '@nestjs/common';
import { MetaController, MetaService } from './meta.controller';

/** /api/meta/* — самоописание API (схема, OpenAPI, инструкция для ИИ). */
@Module({
  controllers: [MetaController],
  providers: [MetaService],
  exports: [MetaService],
})
export class MetaModule {}
