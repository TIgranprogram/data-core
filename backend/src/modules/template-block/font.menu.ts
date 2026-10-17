/**
 * TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE — display-font whitelist + self-host mapping.
 *
 * The PDF pipeline renders with a server-side headless browser. The dev box
 * (Windows Chrome) and the production image (node:20-alpine + chromium +
 * font-noto/ttf-dejavu) share NO common system font set. A "system font"
 * whitelist entry would be silently substituted on at least one environment,
 * so the operator would see one typeface on screen and another in the PDF.
 *
 * Fix: the operator picks a familiar display name below, and the render
 * service wires it through `@font-face` to a metric-equivalent file bundled
 * in this repo (`template-block/assets/fonts`). Both the screen and the PDF
 * then load the same glyph file regardless of environment.
 *
 * The frontend (S4 toolbar) MUST consume this constant rather than hard-coding
 * its own list; validation of the create/update DTO uses this same list.
 */
export const BLOCK_FONT_MENU = [
  'Times New Roman',
  'Arial',
  'Calibri',
] as const;

export type BlockFontMenuItem = (typeof BLOCK_FONT_MENU)[number];

export type BlockFontWeight = 'regular' | 'bold' | 'italic';

/**
 * Display name → bundled metric-equivalent font family. This maps the exact
 * face files under `assets/fonts`. `@font-face` registers the DISPLAY name as
 * the CSS family so a chosen display name renders identically everywhere.
 */
export const BLOCK_FONT_FACES: Record<
  BlockFontMenuItem,
  Record<BlockFontWeight, string>
> = {
  'Times New Roman': {
    regular: 'Tinos-Regular.ttf',
    bold: 'Tinos-Bold.ttf',
    italic: 'Tinos-Italic.ttf',
  },
  Arial: {
    regular: 'LiberationSans-Regular.ttf',
    bold: 'LiberationSans-Bold.ttf',
    italic: 'LiberationSans-Italic.ttf',
  },
  Calibri: {
    regular: 'Carlito-Regular.ttf',
    bold: 'Carlito-Bold.ttf',
    italic: 'Carlito-Italic.ttf',
  },
};

/** Align values allowed on a block style. */
export const BLOCK_ALIGN_VALUES = ['left', 'center', 'right', 'justify'] as const;
export type BlockAlignValue = (typeof BLOCK_ALIGN_VALUES)[number];