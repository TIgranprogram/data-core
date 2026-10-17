import {
  BLOCK_ALIGN_VALUES,
  BLOCK_FONT_FACES,
  BLOCK_FONT_MENU,
  type BlockFontWeight,
  type BlockFontMenuItem,
} from './font.menu';
import type { BlockStyle } from './block-style';
import { documentPublicOrigin } from '../document-render/document-render.utils';

/**
 * Escape a value destined for an inline `style` attribute or an `@font-face`
 * `url(...)`. Only whitelisted scale-less values are expected; this guards the
 * residual path (e.g. legacy/bound color) against CSS breaking out of the
 * attribute or injecting a second declaration.
 */
function escapeCss(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ')
    .replace(/>/g, '\\3e ')
    .replace(/\n/g, ' ');
}

/**
 * Emit a self-hosted `@font-face` block for the block-style font menu.
 * The display name is registered as the CSS family, pointing at the bundled
 * metric-equivalent file served under `${publicOrigin}/fonts/...`.
 *
 * Used by BOTH render paths (single-page `renderHtml` and multipage
 * `renderHtmlPages`) so the server PDF and the screen preview share glyphs.
 */
export function styledTemplateFontCss(): string {
  const src = (file: string) =>
    `url("${escapeCss(documentPublicOrigin())}/fonts/${encodeURIComponent(file)}") format("truetype")`;
  const faces = (BLOCK_FONT_MENU as readonly string[]).map((display) => {
    const font = BLOCK_FONT_FACES[display as keyof typeof BLOCK_FONT_FACES];
    const decl = (weight: BlockFontWeight, fontWeight: string, fontStyle: string) => {
      if (!font) return '';
      return `@font-face { font-family: '${escapeCss(display)}'; font-weight: ${fontWeight}; font-style: ${fontStyle}; src: ${src(font[weight])}; font-display: block; }`;
    };
    return [
      decl('regular', '400', 'normal'),
      decl('bold', '700', 'normal'),
      decl('italic', '400', 'italic'),
    ].join('\n');
  });
  return faces.join('\n');
}

/**
 * Block color is validated as `#rgb` / `#rrggbb` at the DTO/schema boundary,
 * but the boundary can be bypassed for legacy rows; re-validate here and drop
 * anything not hex-safe before it reaches CSS.
 */
function safeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (!/^#[0-9a-fA-F]{3}$/.test(color) && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return undefined;
  }
  return color;
}

/**
 * Compile a block style into a deterministic inline CSS declaration string,
 * or '' when no block style (regression: no-style blocks keep today's HTML).
 *
 * Typography lives ONLY here (block.style). Values are whitelisted upstream;
 * this function additionally clamps font size / line-height and drops non-hex
 * color and out-of-menu font family so nothing non-whitelisted reaches CSS.
 */
export function blockStyleCss(style: BlockStyle | undefined): string {
  if (!style) return '';
  const declarations: string[] = [];

  if (style.fontFamily && BLOCK_FONT_MENU.includes(style.fontFamily as BlockFontMenuItem)) {
    declarations.push(`font-family: '${escapeCss(style.fontFamily)}'`);
  }

  if (typeof style.fontSizePt === 'number' && Number.isFinite(style.fontSizePt)) {
    const size = Math.min(96, Math.max(6, style.fontSizePt));
    declarations.push(`font-size: ${size}pt`);
  }

  const c = safeColor(style.color);
  if (c) declarations.push(`color: ${c}`);

  if (style.align && (BLOCK_ALIGN_VALUES as readonly string[]).includes(style.align)) {
    declarations.push(`text-align: ${style.align}`);
  }

  if (typeof style.lineHeight === 'number' && Number.isFinite(style.lineHeight)) {
    const lh = Math.min(3, Math.max(0.8, style.lineHeight));
    declarations.push(`line-height: ${lh}`);
  }

  return declarations.join(';');
}

export { escapeCss };