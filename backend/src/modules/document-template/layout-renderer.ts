import { normalizeBlockLayout } from '../template-block/template-block-layout';
import type { BlockLayout } from '../template-block/template-block-layout';

/**
 * Compile normalized block geometry into a deterministic inline style.
 * Numeric values are produced by the trusted server-side layout normalizer,
 * so the result is safe to embed in the renderer's generated HTML.
 */
export function blockLayoutStyle(layout: BlockLayout | null | undefined): string {
  if (!layout) return '';
  const safeLayout = normalizeBlockLayout(layout);

  const declarations = [
    'position:absolute',
    `left:${safeLayout.x * 100}%`,
    `top:${safeLayout.y * 100}%`,
    `width:${safeLayout.width * 100}%`,
    `z-index:${safeLayout.zIndex}`,
  ];

  if (safeLayout.height !== undefined) declarations.push(`height:${safeLayout.height * 100}%`);
  if (safeLayout.rotation !== 0) declarations.push(`transform:rotate(${safeLayout.rotation}deg)`);

  return declarations.join(';');
}

/** Clamp an opacity value to [0, 1]; non-finite values become 0. */
function clampOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * TZ-DOC-273 — compile a block background setting into a deterministic
 * `background-color:rgba(...)` declaration, or `''` for transparent.
 * Strict hex-only validation (`#RGB`/`#RRGGBB`, optional `#`) — CSS injection
 * (`url(...)`), gradients, named colors, and NaN are rejected. Opacity is
 * clamped to [0, 1]. Mirrors the frontend `blockBackgroundCss` so the
 * generated document renders the same values as the builder preview.
 */
export function blockBackgroundStyle(
  settings: Record<string, unknown> | null | undefined,
): string {
  const color = settings?.['blockBackgroundColor'];
  if (typeof color !== 'string' || color.length === 0) return '';
  const hex = color.startsWith('#') ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{3}$/.test(hex) && !/^[0-9a-fA-F]{6}$/.test(hex)) return '';

  const parts =
    hex.length === 3
      ? [hex[0] + hex[0], hex[1] + hex[1], hex[2] + hex[2]]
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
  const rgb = parts.map((p) => parseInt(p, 16));
  if (rgb.some((v) => !Number.isFinite(v))) return '';

  const o = clampOpacity(settings?.['blockOpacity']);
  return `background-color:rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${o})`;
}
