import type { DataBindingFormat, DataBindingSource } from './template-block.schema';

export interface BlockLayout {
  page: number;
  x: number;
  y: number;
  width: number;
  height?: number;
  zIndex: number;
  rotation: number;
}

export type BlockSource =
  | { kind: 'text-block'; refId: string; mode: 'live' | 'snapshot' }
  | { kind: 'table-template'; refId: string; mode: 'live' | 'snapshot' }
  | {
      kind: 'field';
      source: Exclude<DataBindingSource, 'static'>;
      field: string;
      format?: DataBindingFormat;
    }
  | { kind: 'literal'; value: string };

interface LegacyOverlaySettings {
  overlay?: unknown;
  overlayLeft?: unknown;
  overlayTop?: unknown;
  imageWidth?: unknown;
  imageHeight?: unknown;
  zIndex?: unknown;
}

const DEFAULT_LAYOUT: BlockLayout = {
  page: 1,
  x: 0,
  y: 0,
  width: 1,
  zIndex: 1,
  rotation: 0,
};

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface NormalizeBlockLayoutOptions {
  /** TZ-DOC-STUDIO-1701 — studio allows pages up to manualPageCount; builder stays at 1. */
  maxPage?: number;
}

export function normalizeBlockLayout(
  layout: Partial<BlockLayout> | null | undefined,
  options?: NormalizeBlockLayoutOptions,
): BlockLayout {
  const maxPage = Math.max(1, Math.floor(finite(options?.maxPage, 1)));
  const page = Math.min(maxPage, Math.max(1, Math.floor(finite(layout?.page, DEFAULT_LAYOUT.page))));
  const width = Math.min(1, Math.max(0.001, finite(layout?.width, DEFAULT_LAYOUT.width)));
  const x = Math.min(1 - width, Math.max(0, finite(layout?.x, DEFAULT_LAYOUT.x)));
  const rawHeight = layout?.height === undefined
    ? undefined
    : Math.min(1, Math.max(0.001, finite(layout.height, 0.1)));
  const y = rawHeight === undefined
    ? Math.min(1, Math.max(0, finite(layout?.y, DEFAULT_LAYOUT.y)))
    : Math.min(1 - rawHeight, Math.max(0, finite(layout?.y, DEFAULT_LAYOUT.y)));

  return {
    page,
    x,
    y,
    width,
    ...(rawHeight === undefined ? {} : { height: rawHeight }),
    zIndex: Math.max(0, Math.floor(finite(layout?.zIndex, DEFAULT_LAYOUT.zIndex))),
    rotation: finite(layout?.rotation, DEFAULT_LAYOUT.rotation),
  };
}

/** Clamp one normalized pointer delta against the union of selected block bounds. */
export function clampLayoutDelta(
  layouts: readonly BlockLayout[],
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  if (layouts.length === 0) return { dx: 0, dy: 0 };
  const normalized = layouts.map((layout) => normalizeBlockLayout(layout));
  const minX = Math.min(...normalized.map((layout) => layout.x));
  const minY = Math.min(...normalized.map((layout) => layout.y));
  const maxX = Math.max(...normalized.map((layout) => layout.x + layout.width));
  const maxY = Math.max(...normalized.map((layout) => layout.y + (layout.height ?? 0.1)));
  return {
    dx: Math.max(-minX, Math.min(1 - maxX, finite(dx, 0))),
    dy: Math.max(-minY, Math.min(1 - maxY, finite(dy, 0))),
  };
}

export function legacyOverlayToLayout(
  settings: LegacyOverlaySettings | null | undefined,
  paperWidthPx: number,
  paperHeightPx: number,
): BlockLayout | null {
  if (!settings || settings.overlay !== true) return null;
  if (!(paperWidthPx > 0) || !(paperHeightPx > 0)) return null;

  return normalizeBlockLayout({
    page: 1,
    x: finite(settings.overlayLeft, 0) / paperWidthPx,
    y: finite(settings.overlayTop, 0) / paperHeightPx,
    width: finite(settings.imageWidth, 300) / paperWidthPx,
    height: finite(settings.imageHeight, 200) / paperHeightPx,
    zIndex: finite(settings.zIndex, 20),
    rotation: 0,
  });
}

export function defaultBlockLayout(index: number): BlockLayout {
  const row = Math.max(0, Math.floor(index));
  return normalizeBlockLayout({
    page: 1,
    x: 0.08,
    y: Math.min(0.85, 0.04 + row * 0.12),
    width: 0.84,
    height: 0.12,
    zIndex: 1,
    rotation: 0,
  });
}
