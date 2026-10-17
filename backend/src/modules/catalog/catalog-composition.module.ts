import { Module } from '@nestjs/common';
import { CompositionLineService } from './composition-line.service';

@Module({
  providers: [CompositionLineService],
  exports: [CompositionLineService],
})
export class CatalogCompositionModule {}
