import { DocumentRenderService } from './document-render.service';
import type { DocumentTemplateDocument } from '../document-template/document-template.schema';
import type { TemplateBlockDocument } from '../template-block/template-block.schema';
import { createHash } from 'node:crypto';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function template(overrides: Partial<DocumentTemplateDocument> = {}): DocumentTemplateDocument {
  return {
    name: 'T',
    pageSize: 'A4',
    orientation: 'portrait',
    backgroundOpacity: 0.3,
    pageNumbering: false,
    ...overrides,
  } as DocumentTemplateDocument;
}

function block(overrides: Partial<TemplateBlockDocument> = {}): TemplateBlockDocument {
  return {
    type: 'text',
    order: 0,
    showLine: false,
    isActive: true,
    ...overrides,
  } as TemplateBlockDocument;
}

describe('DocumentRenderService block.style (TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE)', () => {
  const renderService = new DocumentRenderService();

  it('golden: block style emits exactly the chosen family/size/color/align on the block container', () => {
    const html = renderService.renderHtml(template(), [
      block({
        content: '<p>Hello</p>',
        style: {
          fontFamily: 'Arial',
          fontSizePt: 18,
          color: '#c00',
          align: 'center',
          lineHeight: 1.6,
        },
      }),
    ], {});

    expect(html).toMatch(
      /<div class="block" style="[^"]*font-family: 'Arial'[^"]*font-size: 18pt[^"]*color: #c00[^"]*text-align: center[^"]*line-height: 1\.6[^"]*">/,
    );
  });

  it('regression: block WITHOUT style adds no style attrs and keeps today column px default', () => {
    const noStyle = renderService.renderHtml(template(), [
      block({ columns: [{ id: 'c1', content: 'col', width: 1 }] }),
    ], {});

    // Block div carries no inline style attribute (no style, no layout, no bg).
    expect(noStyle).toMatch(/<div class="block"><div style="display:flex;gap:12px;width:100%">/);
    // Column keeps the legacy px default → byte-identical to pre-wave behavior.
    expect(noStyle).toContain('<div style="flex:1;font-size:14px">col</div>');
    // No blockStyleCss output on this block (no font declarations leaking in).
    const blockHtml = noStyle.match(/<div class="block">.*<\/div>/)?.[0] ?? '';
    expect(blockHtml).not.toContain('font-family');
    expect(blockHtml).not.toContain('pt');
  });

  it('styled block: column without own size inherits block fontSizePt', () => {
    const html = renderService.renderHtml(template(), [
      block({ columns: [{ id: 'c1', content: 'col', width: 1 }], style: { fontSizePt: 22 } }),
    ], {});
    expect(html).toContain('<div style="flex:1;font-size:22pt">col</div>');
  });

  it('styled block: column WITH own size keeps its own px, block default not applied', () => {
    const html = renderService.renderHtml(template(), [
      block({ columns: [{ id: 'c1', content: 'col', width: 1, fontSize: 16 }], style: { fontSizePt: 22 } }),
    ], {});
    expect(html).toContain('<div style="flex:1;font-size:16px">col</div>');
    expect(html).not.toContain('font-size:22pt');
  });

  it('single-page path embeds self-hosted @font-face for the whitelist', () => {
    const html = renderService.renderHtml(template(), [], {});
    expect(html).toContain("@font-face { font-family: 'Times New Roman';");
    expect(html).toContain("@font-face { font-family: 'Calibri';");
    expect(html).toContain('/fonts/Tinos-Regular.ttf');
  });

  it('multipage path (renderHtmlPages) also embeds self-hosted @font-face + keeps no-style block markup', () => {
    const html = renderService.renderHtmlPages(template(), [
      [block({ content: '<p>p1</p>' })],
      [block({ content: '<p>p2</p>' })],
    ], {});

    expect(html).toContain("@font-face { font-family: 'Times New Roman';");
    expect(html).toContain('/fonts/LiberationSans-Regular.ttf');
    // No-style pages keep plain block markup.
    expect(html).toContain('<p>p1</p>');
    expect(html).toContain('<p>p2</p>');
  });

  it('golden hash: identical input produces identical output (determinism regression)', () => {
    const input = {
      template: template(),
      blocks: [block({ content: '<p>stable</p>' })],
      data: {},
    };
    const h1 = sha256(renderService.renderHtml(input.template, input.blocks, input.data));
    const h2 = sha256(renderService.renderHtml(input.template, input.blocks, input.data));
    expect(h1).toBe(h2);
  });
});