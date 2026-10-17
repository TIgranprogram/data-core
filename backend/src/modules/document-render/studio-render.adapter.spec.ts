import { DocumentRenderService } from './document-render.service';
import {
  studioAggregateToRenderInput,
  type StudioDocumentAggregate,
} from './studio-render.adapter';
import type { TemplateBlockDocument } from '../template-block/template-block.schema';
import { createHash } from 'node:crypto';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('studio-render.adapter golden (TZ-DOC-STUDIO-201c)', () => {
  const renderService = new DocumentRenderService();

  const aggregate: StudioDocumentAggregate = {
    document: {
      name: 'Golden Studio Doc',
      pageSize: 'A4',
      orientation: 'portrait',
      backgroundOpacity: 0.3,
      pageNumbering: false,
    },
    blocks: [
      {
        type: 'text',
        order: 0,
        showLine: false,
        isActive: true,
        content: '<p>Hello Studio</p>',
        layout: {
          page: 1,
          x: 0.1,
          y: 0.1,
          width: 0.8,
          height: 0.1,
          zIndex: 1,
          rotation: 0,
        },
      } as TemplateBlockDocument,
    ],
  };

  it('produces deterministic HTML hash for fixed aggregate', () => {
    const input = studioAggregateToRenderInput(aggregate);
    const html1 = renderService.renderHtml(input.template, input.blocks, input.data);
    const html2 = renderService.renderHtml(input.template, input.blocks, input.data);
    expect(html1).toBe(html2);
    expect(sha256(html1)).toMatch(/^[a-f0-9]{64}$/);
    expect(html1).toContain('Hello Studio');
  });
});
