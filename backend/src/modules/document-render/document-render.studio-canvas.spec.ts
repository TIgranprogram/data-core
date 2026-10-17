import { DocumentRenderService } from './document-render.service';
import type { DocumentTemplateDocument } from '../document-template/document-template.schema';
import type { TemplateBlockDocument } from '../template-block/template-block.schema';

function template(overrides: Partial<DocumentTemplateDocument> = {}): DocumentTemplateDocument {
  return {
    name: 'Studio doc',
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

describe('DocumentRenderService studioCanvas (NX preview/PDF parity)', () => {
  const renderService = new DocumentRenderService();

  it('uses zero doc-content padding and preserves fraction layout for positioned text', () => {
    const html = renderService.renderHtml(
      template(),
      [
        block({
          content: '<p>Новый текст</p>',
          layout: { page: 1, x: 0.2, y: 0.3, width: 0.4, height: 0.12, zIndex: 2, rotation: 0 },
        }),
      ],
      {},
      { studioCanvas: true },
    );

    expect(html).toContain('padding: 0');
    expect(html).toContain('left:20%');
    expect(html).toContain('top:30%');
    expect(html).toContain('width:40%');
    expect(html).toContain('block--positioned block--text');
  });

  it('renders overlay passport images as full-page doc-bg layers, not foreground blocks', () => {
    const html = renderService.renderHtml(
      template(),
      [
        block({
          type: 'image',
          settings: { overlay: true, imageUrl: '/uploads/template-blocks/x/bg.png' },
          layout: { page: 1, x: 0, y: 0, width: 1, height: 1, zIndex: 0, rotation: 0 },
        }),
        block({
          content: '<p>Caption</p>',
          layout: { page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.1, zIndex: 2, rotation: 0 },
        }),
      ],
      {},
      { studioCanvas: true },
    );

    expect(html).toContain('doc-bg--block');
    expect(html).toContain('/uploads/template-blocks/x/bg.png');
    expect(html).toContain('object-fit: contain');
    expect(html).toMatch(/doc-bg--block[\s\S]*bg\.png/);
    expect(html).toMatch(/doc-stage[\s\S]*Caption/);
    expect(html).not.toContain(
      'block--positioned"><img src="/uploads/template-blocks/x/bg.png"',
    );
  });

  it('passes studioCanvas through multipage render', () => {
    const html = renderService.renderHtmlPages(
      template(),
      [
        [
          block({
            content: '<p>P1</p>',
            layout: { page: 1, x: 0.15, y: 0.2, width: 0.5, height: 0.1, zIndex: 1, rotation: 0 },
          }),
        ],
      ],
      {},
      { studioCanvas: true },
    );

    expect(html).toContain('padding: 0');
    expect(html).toContain('left:15%');
    expect(html).toContain('top:20%');
  });

  describe('TZ-NX-PO-SWEEP-06 — WYSIWYG table CSS contract (canvas is the SoT)', () => {
    it('single-page preview/PDF table CSS matches the studio canvas (9px, 2px 4px, nowrap+ellipsis)', () => {
      const html = renderService.renderHtml(template(), [], {}, { studioCanvas: true });

      expect(html).toMatch(/table\s*\{[^}]*font-size:\s*9px/);
      expect(html).toMatch(/th,\s*td\s*\{[^}]*padding:\s*2px 4px/);
      expect(html).toMatch(/th,\s*td\s*\{[^}]*white-space:\s*nowrap/);
      expect(html).toMatch(/th,\s*td\s*\{[^}]*text-overflow:\s*ellipsis/);
    });

    it('multi-page (table-overflow) preview/PDF gets the same table CSS contract', () => {
      const html = renderService.renderHtmlPages(template(), [[]], {}, { studioCanvas: true });

      expect(html).toMatch(/table\s*\{[^}]*font-size:\s*9px/);
      expect(html).toMatch(/th,\s*td\s*\{[^}]*white-space:\s*nowrap/);
    });

    it('keeps studio CSS comments in the head without HTML body markers', () => {
      const html = renderService.renderHtml(template(), [], {}, { studioCanvas: true });
      const head = html.split(/<\/head>/i)[0] ?? '';

      expect(head).toContain('multi-page/table-overflow');
      expect(head).not.toMatch(/<body/i);
    });

    it('does not leak the studio CSS comment into multi-page document bodies', () => {
      const html = renderService.renderHtmlPages(
        template({ pageNumbering: true }),
        [[], []],
        {},
        { studioCanvas: true },
      );
      const afterHead = html.split(/<\/head>/i)[1] ?? '';

      expect(afterHead).toContain('<section class="doc-page">');
      expect(afterHead).not.toContain('multi-page/table-overflow');
      expect(afterHead).not.toContain('bare table selectors');
    });

    it('does not leak the studio 9px table contract into non-studio (legacy/Create-КП) rendering', () => {
      const html = renderService.renderHtml(template(), [], {}, { studioCanvas: false });

      expect(html).not.toMatch(/font-size:\s*9px/);
      expect(html).not.toMatch(/white-space:\s*nowrap/);
    });
  });
});
