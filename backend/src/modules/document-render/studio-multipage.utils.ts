import type { TemplateBlockDocument } from '../template-block/template-block.schema';
import type { PhotoFrame } from '../photos/photo.schema';
import {
  renderStudioTableHtml,
  storedRows,
  STUDIO_TABLE_PHOTO_MAX_HEIGHT_DEFAULT_PX,
  tableColumnsFromBlock,
  tableDataSetKey,
} from '../studio-document/studio-data-resolver';

const A4_HEIGHT_PX = 1123;
const DOC_CONTENT_PADDING_PX = 40;
const DEFAULT_ROWS_FIRST = 20;
const DEFAULT_ROWS_NEXT = 25;
const TABLE_HEADER_PX = 30;
const TABLE_ROW_PX = 28;

export interface StudioTableColumn {
  key: string;
  label: string;
}

export interface StudioRenderPagePlan {
  pageNumber: number;
  blocks: TemplateBlockDocument[];
  backgroundIndex: number;
}

export interface StudioMultipageInput {
  blocks: TemplateBlockDocument[];
  manualPageCount: number;
  dataSets: Record<string, unknown>[];
  backgroundImages: string[];
  defaultBackgroundIndex: number;
  backgroundPageIndices?: number[];
  sheetLayout?: { rowsFirstPage?: number; rowsNextPage?: number };
}

export function buildStudioTableHtml(
  columns: StudioTableColumn[],
  rows: string[][],
): string {
  return renderStudioTableHtml(columns, rows);
}

function blockPage(block: TemplateBlockDocument): number {
  const page = block.layout?.page;
  return typeof page === 'number' && page >= 1 ? Math.floor(page) : 1;
}

function tableDataSetKeyForBlock(block: TemplateBlockDocument): string {
  return tableDataSetKey(block);
}

function tableColumns(block: TemplateBlockDocument): StudioTableColumn[] {
  return tableColumnsFromBlock(block) as StudioTableColumn[];
}

type DataSetEntryLike = { rows?: unknown; photoFrames?: Record<string, PhotoFrame> };

function readDataSetEntry(
  dataSets: Record<string, unknown>[],
  key: string,
): DataSetEntryLike | undefined {
  return dataSets.find(
    (item) => String((item as { key?: unknown }).key ?? '') === key,
  ) as DataSetEntryLike | undefined;
}

function readDataSetRows(
  dataSets: Record<string, unknown>[],
  key: string,
): string[][] {
  return storedRows(readDataSetEntry(dataSets, key) ?? {});
}

/** TZ-NX-PO-SWEEP-05 — mirrors FE `studioTablePhotoDisplay` / the resolver's own `tablePhotoDisplayFromBlock`. */
function tablePhotoDisplayFromBlock(block: TemplateBlockDocument): { fit: PhotoFrame['fit'] | null; maxHeightPx: number } {
  const raw = (block.settings as { tablePhotoDisplay?: { fit?: unknown; maxHeightPx?: unknown } } | undefined)
    ?.tablePhotoDisplay;
  const fit = raw?.fit === 'contain' || raw?.fit === 'cover' ? raw.fit : null;
  const maxHeightPx =
    typeof raw?.maxHeightPx === 'number' && Number.isFinite(raw.maxHeightPx) && raw.maxHeightPx >= 16 && raw.maxHeightPx <= 96
      ? raw.maxHeightPx
      : STUDIO_TABLE_PHOTO_MAX_HEIGHT_DEFAULT_PX;
  return { fit, maxHeightPx };
}

function estimateRowCapacity(
  layoutHeight: number | undefined,
  isFirstSegment: boolean,
): number {
  if (!isFirstSegment) return DEFAULT_ROWS_NEXT;
  if (layoutHeight === undefined || !(layoutHeight > 0)) return DEFAULT_ROWS_FIRST;
  const slotHeightPx = (A4_HEIGHT_PX - DOC_CONTENT_PADDING_PX) * layoutHeight;
  const usablePx = Math.max(0, slotHeightPx - TABLE_HEADER_PX);
  return Math.min(200, Math.max(1, Math.floor(usablePx / TABLE_ROW_PX)));
}

function cloneBlock(
  block: TemplateBlockDocument,
  patch: Partial<TemplateBlockDocument>,
): TemplateBlockDocument {
  // TZ-NX-DOCSTUDIO-S42 — `block` here is a hydrated Mongoose Document from
  // findAllByStudioDocument (no `.lean()`), same as the S37C defect class:
  // `{...block}` alone does not reliably carry the document's own paths
  // (constructor.name === 'model'). `.toObject()` first, same pattern as
  // injectTableContent / applyTableAggregateTokensToBlocks.
  const plain =
    typeof (block as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (block as { toObject: () => Record<string, unknown> }).toObject()
      : { ...(block as object) };
  return { ...plain, ...patch } as TemplateBlockDocument;
}

function backgroundIndexForPage(
  pageNumber: number,
  backgroundImages: string[],
  defaultBackgroundIndex: number,
  backgroundPageIndices?: number[],
): number {
  const pageIdx = pageNumber - 1;
  const configured = backgroundPageIndices?.[pageIdx];
  if (typeof configured === 'number' && configured >= 0 && configured < backgroundImages.length) return configured;
  if (configured === -1) return -1;
  if (pageIdx >= 0 && pageIdx < backgroundImages.length) return pageIdx;
  if (defaultBackgroundIndex >= 0 && defaultBackgroundIndex < backgroundImages.length) {
    return defaultBackgroundIndex;
  }
  return backgroundImages.length > 0 ? 0 : -1;
}

/**
 * TZ-DOC-STUDIO-1701 — manual pages + table auto-overflow for studio preview/PDF.
 */
export function planStudioMultipage(
  input: StudioMultipageInput,
): StudioRenderPagePlan[] {
  const manualPageCount = Math.max(1, input.manualPageCount);
  const pageMap = new Map<number, TemplateBlockDocument[]>();

  const ensurePage = (pageNumber: number): TemplateBlockDocument[] => {
    const existing = pageMap.get(pageNumber);
    if (existing) return existing;
    const created: TemplateBlockDocument[] = [];
    pageMap.set(pageNumber, created);
    return created;
  };

  for (let page = 1; page <= manualPageCount; page += 1) {
    ensurePage(page);
  }

  const nonTableBlocks = input.blocks.filter((b) => b.type !== 'table');
  for (const block of nonTableBlocks) {
    ensurePage(blockPage(block)).push(block);
  }

  let maxPage = manualPageCount;

  for (const block of input.blocks.filter((b) => b.type === 'table')) {
    const columns = tableColumns(block);
    const rows = readDataSetRows(input.dataSets, tableDataSetKeyForBlock(block));
    const startPage = blockPage(block);
    let rowOffset = 0;
    let segment = 0;

    while (rowOffset < rows.length || segment === 0) {
      const pageNumber = startPage + segment;
      const isFirstSegment = segment === 0;
      const configured = isFirstSegment ? input.sheetLayout?.rowsFirstPage : input.sheetLayout?.rowsNextPage;
      const capacity = configured && configured > 0
        ? Math.min(200, Math.max(1, Math.floor(configured)))
        : estimateRowCapacity(block.layout?.height, isFirstSegment);
      const slice = rows.slice(rowOffset, rowOffset + capacity);
      const entry = readDataSetEntry(input.dataSets, tableDataSetKeyForBlock(block));
      const photoDisplay = tablePhotoDisplayFromBlock(block);
      const html = renderStudioTableHtml(columns, slice, [], 20, {
        frames: entry?.photoFrames,
        fit: photoDisplay.fit,
        maxHeightPx: photoDisplay.maxHeightPx,
      });

      let layout = block.layout;
      if (!isFirstSegment && layout) {
        layout = { ...layout, y: 0, height: 1, page: pageNumber };
      } else if (layout) {
        layout = { ...layout, page: pageNumber };
      }

      const rendered = cloneBlock(block, {
        content: html,
        layout,
      });
      ensurePage(pageNumber).push(rendered);

      maxPage = Math.max(maxPage, pageNumber);
      rowOffset += capacity;
      segment += 1;
      if (rowOffset >= rows.length) break;
    }
  }

  const sortedPages = [...pageMap.keys()].sort((a, b) => a - b);
  const highest = Math.max(maxPage, sortedPages[sortedPages.length - 1] ?? manualPageCount);

  const pageNumbers: number[] = [];
  for (let page = 1; page <= highest; page += 1) {
    pageNumbers.push(page);
  }

  return pageNumbers.map((pageNumber) => ({
    pageNumber,
    blocks: pageMap.get(pageNumber) ?? [],
    backgroundIndex: backgroundIndexForPage(
      pageNumber,
      input.backgroundImages,
      input.      defaultBackgroundIndex,
      input.backgroundPageIndices,
    ),
  }));
}
