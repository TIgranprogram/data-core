import { Module } from '@nestjs/common';
import { DocumentRenderService } from './document-render.service';

/** TZ-DOC-STUDIO-101 — shared HTML render surface for templates and studio. */
@Module({
  providers: [DocumentRenderService],
  exports: [DocumentRenderService],
})
export class DocumentRenderModule {}
