import { Injectable } from '@nestjs/common';
import { sanitizeHtml } from '../../common/sanitize-html';
import { blockBackgroundStyle, blockLayoutStyle } from '../document-template/layout-renderer';
import type { DocumentTemplateDocument } from '../document-template/document-template.schema';
import type { TemplateBlockDocument } from '../template-block/template-block.schema';
import { blockStyleCss } from '../template-block/block-style.css';
import { styledTemplateFontCss } from '../template-block/block-style.css';
import {
  documentPublicOrigin,
  escapeHtmlValue,
  normalizeSubstitutionHtml,
} from './document-render.utils';

export {
  escapeHtmlValue,
  normalizeSubstitutionHtml,
} from './document-render.utils';

export interface RenderHtmlOptions {
  /** TZ-DOC-STUDIO-1701 — per-page letterhead index into backgroundImage[]. */
  backgroundPageIndex?: number;
  /** NX Document Studio — fraction layout matches editor canvas (no content padding). */
  studioCanvas?: boolean;
  pageMargins?: { top: number; right: number; bottom: number; left: number };
}

function isStudioPassportImageBlock(block: TemplateBlockDocument): boolean {
  if (block.type !== 'image') return false;
  return (block.settings as Record<string, unknown> | undefined)?.['overlay'] === true;
}

function partitionStudioBlocks(
  blocks: readonly TemplateBlockDocument[],
  studioCanvas: boolean,
): { foreground: TemplateBlockDocument[]; passport: TemplateBlockDocument[] } {
  if (!studioCanvas) {
    return { foreground: [...blocks], passport: [] };
  }
  const visible = blocks
    .filter((b) => b.isActive !== false)
    .sort((a, b) => (a.layout?.zIndex ?? 0) - (b.layout?.zIndex ?? 0));
  const passport = visible.filter(isStudioPassportImageBlock);
  const foreground = visible.filter((b) => !passport.includes(b));
  return { foreground, passport };
}

/**
 * TZ-DOC-STUDIO-101 — neutral HTML renderer extracted from DocumentTemplateService.
 * Studio and quotation/KP pipelines share this surface; orchestration stays upstream.
 */
@Injectable()
export class DocumentRenderService {
  renderHtml(
    template: DocumentTemplateDocument,
    blocks: TemplateBlockDocument[],
    data: Record<string, unknown>,
    options?: RenderHtmlOptions,
  ): string {
    const substitute = (s: string | undefined): string => {
      if (!s) return '';
      const normalized = normalizeSubstitutionHtml(s);
      return normalized.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
        const val = key.split('.').reduce<unknown>((acc, k) => {
          if (acc == null) return undefined;
          if (Array.isArray(acc)) {
            const idx = parseInt(k, 10);
            return Number.isFinite(idx) ? acc[idx] : undefined;
          }
          if (typeof acc === 'object') {
            return (acc as Record<string, unknown>)[k];
          }
          return undefined;
        }, data);
        return val == null ? '' : escapeHtmlValue(String(val));
      });
    };

    const safeImageUrl = (value: string | undefined): string => {
      const url = value?.trim() ?? '';
      if (!url) return '';
      if (/^data:/i.test(url)) {
        return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(url)
          ? escapeHtmlValue(url)
          : '';
      }
      if (
        /^https?:\/\//i.test(url) ||
        /^\/(?!\/)/.test(url) ||
        /^\.\.?(?:\/|$)/.test(url) ||
        /^#/.test(url)
      ) {
        return escapeHtmlValue(url);
      }
      return '';
    };

    const isLandscape = (template as { orientation?: string }).orientation === 'landscape';
    const pageWidth = isLandscape ? '297mm' : '210mm';
    const pageMinHeight = isLandscape ? '210mm' : '297mm';
    const studioCanvas = options?.studioCanvas === true;
    const contentStyles = this.buildDocumentContentStyles(template, studioCanvas, options?.pageMargins);
    const baseHref = documentPublicOrigin();
    const css = `
      <style>
        ${styledTemplateFontCss()}
        @page { size: ${isLandscape ? 'landscape' : 'portrait'}; margin: 0; }
        html, body { margin: 0; overflow: hidden; }
        html { width: ${pageWidth}; height: ${pageMinHeight}; }
        body { font-family: 'Times New Roman', serif; width: 100%; height: 100%; max-width: 100%; max-height: 100%; min-height: 0; padding: 0; position: relative; box-sizing: border-box; }
        ${contentStyles}
      </style>`;
    const bgImages = template.backgroundImage ?? [];
    const defaultIdx = (template as { defaultBackgroundIndex?: number }).defaultBackgroundIndex ?? -1;
    const pageBgIdx = options?.backgroundPageIndex;
    const activeBgs =
      pageBgIdx !== undefined && pageBgIdx >= 0 && pageBgIdx < bgImages.length
        ? [bgImages[pageBgIdx]]
        : defaultIdx >= 0 && defaultIdx < bgImages.length
          ? [bgImages[defaultIdx]]
          : bgImages;
    const bgLayers = activeBgs
      .map((url) => {
        const safeUrl = safeImageUrl(url);
        return safeUrl
          ? `<div class="doc-bg"><img src="${safeUrl}" alt=""></div>`
          : '';
      })
      .join('');
    const { foreground, passport } = partitionStudioBlocks(blocks, studioCanvas);
    const renderBlocks = studioCanvas
      ? foreground.filter((b) => Boolean(b.layout))
      : foreground;
    const blockPassportLayers = passport
      .map((b) => {
        const imageSettings = b.settings as { imageUrl?: string } | undefined;
        const imageContent =
          safeImageUrl(b.content ?? undefined) || safeImageUrl(imageSettings?.imageUrl);
        if (!imageContent) return '';
        const layoutStyle =
          blockLayoutStyle(b.layout) ||
          'position:absolute;left:0%;top:0%;width:100%;height:100%;z-index:0';
        return `<div class="doc-bg doc-bg--block" style="${layoutStyle}"><img src="${imageContent}" alt=""></div>`;
      })
      .join('');
    const termsHtml =
      typeof data['__termsHtml'] === 'string' ? data['__termsHtml'] : '';
    const body = renderBlocks
      .map((b) => {
        const blockSettings = b.settings as
          | { role?: string; imageUrl?: string }
          | undefined;
        const isTermsBlock = blockSettings?.role === 'terms';
        const rawContent = b.content ?? b.title;
        const content = isTermsBlock
          ? (rawContent ?? '')
          : substitute(rawContent);
        const literalContent = isTermsBlock
          ? content
          : b.source?.kind === 'literal'
            ? sanitizeHtml(b.source.value)
            : content;
        const imageSettings = blockSettings;
        const imageContent =
          safeImageUrl(content) || safeImageUrl(imageSettings?.imageUrl);
        const layoutStyle = blockLayoutStyle(b.layout);
        const bgStyle = blockBackgroundStyle(
          b.settings as Record<string, unknown> | undefined,
        );
        const combinedStyle = [layoutStyle, bgStyle, blockStyleCss(b.style)].filter(Boolean).join(';');
        const blockClass = layoutStyle
          ? `block block--positioned${b.type === 'text' ? ' block--text' : ''}`
          : 'block';
        const styleAttr = combinedStyle ? ` style="${combinedStyle}"` : '';
        const cols = b.columns ?? [];
        const multiColHtml =
          cols.length > 0
            ? `<div style="display:flex;gap:12px;width:100%">${cols
                .map((c) => {
                  const w = c.width && c.width > 0 ? c.width : 1;
                  // TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE: columns[].fontSize is
                  // unchanged (px, legacy default 14). A column WITHOUT its
                  // own size inherits the block style.fontSizePt default when
                  // present, otherwise keeps today's 14px — so a block with
                  // no style stays byte-identical to the pre-wave output.
                  const columnSize =
                    c.fontSize !== undefined
                      ? `${c.fontSize}px`
                      : b.style?.fontSizePt !== undefined
                        ? `${b.style.fontSizePt}pt`
                        : '14px';
                  return `<div style="flex:${w};font-size:${columnSize}">${substitute(c.content)}</div>`;
                })
                .join('')}</div>`
            : null;
        switch (b.type) {
          case 'header':
            return `<div class="${blockClass}"${styleAttr}><h2>${substitute(b.title ?? '')}</h2>${multiColHtml ?? literalContent}</div>`;
          case 'text':
            return `<div class="${blockClass}"${styleAttr}>${multiColHtml ?? literalContent}</div>`;
          case 'image': {
            const settings = b.settings as { role?: string } | undefined;
            if (settings?.role === 'separator') {
              const h = b.height ?? 40;
              return `<div class="${blockClass}" style="${[combinedStyle, `height:${h}px`].filter(Boolean).join(';')}"></div>`;
            }
            const imgStyle =
              layoutStyle && studioCanvas
                ? 'width:100%;height:100%;object-fit:cover;display:block'
                : 'max-width:100%';
            return imageContent
              ? `<div class="${blockClass}"${styleAttr}><img src="${imageContent}" alt="" style="${imgStyle}"></div>`
              : `<div class="${blockClass}" style="${[combinedStyle, `height:${b.height ?? 80}px`].filter(Boolean).join(';')}"></div>`;
          }
          case 'signature': {
            const signature = imageContent
              ? `<img src="${imageContent}" alt="Подпись" style="max-width:100%">`
              : `<em>Подпись: ___________________</em><br>${content}`;
            return `<div class="${blockClass}"${styleAttr}>${signature}</div>`;
          }
          case 'table': {
            const tableClass = layoutStyle
              ? 'block block--positioned block--table'
              : 'block block--table';
            return `<div class="${tableClass}"${styleAttr}>${literalContent || '<p>Нет данных</p>'}</div>`;
          }
          case 'spacer': {
            const h = b.height ?? 40;
            return `<div class="${blockClass}" style="${[combinedStyle, `height:${h}px`].filter(Boolean).join(';')}"></div>`;
          }
          default:
            return `<div class="${blockClass}"${styleAttr}>${content}</div>`;
        }
      })
      .join('\n');
    const fallbackTerms =
      termsHtml &&
      !renderBlocks.some(
        (block) =>
          (block.settings as { role?: string } | undefined)?.role === 'terms',
      )
        ? `<section class="block kp-terms"><h3>Условия</h3>${termsHtml}</section>`
        : '';
    const pageNumber = data['__pageNumber'];
    const pageCount = data['__pageCount'];
    const pageNumberHtml =
      template.pageNumbering &&
      typeof pageNumber === 'number' &&
      typeof pageCount === 'number'
        ? `<div class="kp-page-number">Страница ${pageNumber} из ${pageCount}</div>`
        : '';
    const pageNumberCss = template.pageNumbering
      ? '<style>.kp-page-number{position:absolute;right:20px;bottom:10px;z-index:5;font:11px Arial,sans-serif;color:#666}</style>'
      : '';
    const bodyClass = studioCanvas ? ' class="doc-body--studio"' : '';
    const contentWrapperOpen = studioCanvas
      ? '<div class="doc-stage">'
      : '<div class="doc-content">';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${escapeHtmlValue(baseHref)}/"><title>${escapeHtmlValue(template.name ?? '')}</title>${css}${pageNumberCss}</head><body${bodyClass}>${bgLayers}${blockPassportLayers}${contentWrapperOpen}${body}${fallbackTerms}</div>${pageNumberHtml}</body></html>`;
  }

  renderHtmlPages(
    template: DocumentTemplateDocument,
    pages: TemplateBlockDocument[][],
    data: Record<string, unknown>,
    options?: { backgroundPageIndices?: number[]; studioCanvas?: boolean; pageMargins?: { top: number; right: number; bottom: number; left: number } },
  ): string {
    const studioCanvas = options?.studioCanvas === true;
    const renderedBodies = pages.map((page, index) => {
      const html = this.renderHtml(template, page, {
        ...data,
        __pageNumber: index + 1,
        __pageCount: pages.length,
      }, {
        backgroundPageIndex: options?.backgroundPageIndices?.[index],
        studioCanvas,
      });
      // Extract only after </head>: studio CSS comments may contain markup-like
      // text, so matching the whole document can mistake a comment for <body>.
      const afterHead = html.split(/<\/head>/i)[1] ?? html;
      const match = afterHead.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      return match?.[1] ?? '';
    });
    const orientation = (template as { orientation?: string }).orientation === 'landscape';
    const width = orientation ? '297mm' : '210mm';
    const height = orientation ? '210mm' : '297mm';
    const contentStyles = this.buildDocumentContentStyles(template, studioCanvas, options?.pageMargins);
    const pageNumberCss = template.pageNumbering
      ? '.kp-page-number{position:absolute;right:20px;bottom:10px;z-index:5;font:11px Arial,sans-serif;color:#666}'
      : '';
    const baseHref = documentPublicOrigin();
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${escapeHtmlValue(baseHref)}/"><title>${escapeHtmlValue(template.name ?? '')}</title><style>${styledTemplateFontCss()}@page{size:${orientation ? 'landscape' : 'portrait'};margin:0}html,body{margin:0;padding:0;background:#e5e7eb}.doc-page{position:relative;width:${width};height:${height};min-height:${height};box-sizing:border-box;page-break-after:always;overflow:hidden;background:#fff}.doc-page:last-child{page-break-after:auto}${contentStyles}${pageNumberCss ? pageNumberCss : ''}</style></head><body>${renderedBodies.map((body) => `<section class="doc-page">${body}</section>`).join('')}</body></html>`;
  }

  private buildDocumentContentStyles(
    template: DocumentTemplateDocument,
    studioCanvas = false,
    pageMargins?: { top: number; right: number; bottom: number; left: number },
  ): string {
    const margins = pageMargins ?? (template as { pageMargins?: { top: number; right: number; bottom: number; left: number } }).pageMargins;
    const contentPadding = studioCanvas ? '0' : margins ? `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm` : '20px';
    const studioCanvasCss = studioCanvas
      ? `
        .doc-body--studio { position: relative; width: 100%; height: 100%; overflow: hidden; }
        .doc-stage { position: absolute; inset: 0; z-index: 1; overflow: hidden; box-sizing: border-box; }
        .block--positioned img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .block--positioned.block--text { overflow: hidden; }
        .doc-bg--block { opacity: 1; }
        .doc-bg--block img { width: 100%; height: 100%; object-fit: contain; display: block; background-color: white; }
        /* TZ-NX-PO-SWEEP-06 — WYSIWYG table contract: preview/PDF must match
           the studio canvas (studio-blocks-canvas.component.ts .table-preview),
           not the browser's ambient default font/wrap. Canvas is the SoT per
           PO ("как в редакторе, что он настроил"). Bare selectors on purpose
           (not scoped under .doc-body--studio): this whole block is already
           only emitted when studioCanvas is true, and the multi-page/table-overflow
           path has no doc-body--studio class — source order (last declaration
           wins) is what actually scopes this to studio in both the single-page
           and multi-page render paths. */
        table { font-size: 9px; }
        th, td {
          padding: 2px 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }`
      : '';
    return `
        h1, h2, h3 { margin: 8px 0; }
        .block { max-width: 100%; margin: 12px 0; padding: 8px 0; position: relative; z-index: 1; box-sizing: border-box; overflow-wrap: anywhere; }
        .doc-content { position: relative; z-index: 1; width: 100%; height: 100%; max-width: 100%; max-height: 100%; min-height: 0; padding: ${contentPadding}; box-sizing: border-box; overflow: hidden; }
        .block--positioned { margin: 0; box-sizing: border-box; border: none; background: transparent; }
        .block--positioned.block--table { overflow: hidden; }
        table { width: 100%; max-width: 100%; table-layout: fixed; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; overflow-wrap: anywhere; }
        .doc-bg { position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: ${template.backgroundOpacity ?? 0.3}; }
        .doc-bg img { width: 100%; height: 100%; object-fit: contain; background-color: white; }${studioCanvasCss}`;
  }
}
