import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from '../product/product.schema';
import { ProductModule, ProductModuleDocument } from '../product-module/product-module.schema';
import { Material, MaterialDocument } from '../material/material.schema';
import { Organization, OrganizationDocument } from '../organization/organization.schema';
import { Photo, PhotoDocument, type PhotoFrame } from '../photos/photo.schema';
import type { QuotationItem } from '../quotation/quotation.schema';
import { QuotationService } from '../quotation/quotation.service';
import type { OrderItem } from '../order/order.schema';
import { OrderService } from '../order/order.service';
import type { TemplateBlockDocument } from '../template-block/template-block.schema';
import type { StudioDocumentDocument } from './studio-document.schema';
import { escapeHtmlValue, localUploadFileExists } from '../document-render/document-render.utils';

export type DataSetSourceType =
  | 'manual'
  | 'quotation-items'
  | 'order-items'
  | 'catalog-products'
  | 'catalog-modules'
  | 'catalog-parts'
  | 'catalog-materials';

/** TZ-NX-PO-SWEEP-06 — mirrors FE `STUDIO_TABLE_PHOTO_MAX_HEIGHT_DEFAULT_PX` (studio-table-defaults.ts): one contract, canvas is the SoT. */
export const STUDIO_TABLE_PHOTO_MAX_HEIGHT_DEFAULT_PX = 28;

export type StudioTableColumn = {
  key: string;
  label?: string;
  type?: string;
  align?: string;
  width?: number;
};

/**
 * TZ-NX-DOCSTUDIO-TABLE-COL-WIDTH-APPLY — `col.width` (1-100, meant as a %
 * share of the table) used to be saved by the Свойства column editor but
 * never read by the renderer (`renderStudioTableHtml` always split columns
 * equally) — a dead control the operator could turn without any visible
 * effect. Clamps each raw width to [1,100]; if none are set at all (sum 0,
 * the common case for existing tables), falls back to the previous
 * equal-split behavior instead of dividing by a zero sum. Otherwise scales
 * proportionally to 100, the last column absorbing the rounding remainder
 * so the percentages always sum to exactly 100.
 */
export function columnWidthPercents(columns: readonly StudioTableColumn[]): number[] {
  const n = columns.length;
  if (n === 0) return [];
  const raw = columns.map((col) =>
    typeof col.width === 'number' && Number.isFinite(col.width) ? Math.min(100, Math.max(1, col.width)) : 0,
  );
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const equal = Math.round(100 / n);
    const percents = new Array(n).fill(equal);
    percents[n - 1] = 100 - equal * (n - 1);
    return percents;
  }
  const scaled = raw.map((w) => Math.round((w / sum) * 100));
  const total = scaled.reduce((a, b) => a + b, 0);
  scaled[n - 1] = Math.max(1, (scaled[n - 1] ?? 0) + (100 - total));
  return scaled;
}

type LineItem = {
  productName?: string;
  productSku?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  total?: number;
  description?: string;
  photoUrl?: string;
};

type DataSetEntry = {
  key?: string;
  source?: { type?: string };
  rows?: unknown;
  disabledRowIndices?: unknown;
  /** TZ-NX-PO-SWEEP-05 — catalog photo's РАМКА (`Photo.frame`), keyed by the
   * resolved `storageUrl` (the same string a photo cell holds), so canvas
   * and PDF/preview render the same fit/pan without restructuring `rows`. */
  photoFrames?: Record<string, PhotoFrame>;
};

/** TZ-NX-DOCSTUDIO-S47 — parity with Create КП aliases (`proposal-table-layout.util.ts`). */
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'productname', 'title', 'product', 'наименование'],
  qty: ['qty', 'quantity', 'count', 'кол-во', 'количество'],
  /**
   * TZ-NX-DOCSTUDIO-TABLE-PRICE-SUM — `listPrice`/`basePrice`/`pricePerUnit`
   * are the catalog fields this resolver itself reads (`fetchLiveRows`
   * below); a manually-typed or registry-template column key using one of
   * those exact names used to silently fail to bind (only `price`/
   * `unitPrice` matched), showing an empty "Цена" cell despite a live qty.
   */
  price: ['price', 'unitprice', 'unit_price', 'цена', 'listprice', 'list_price', 'baseprice', 'base_price', 'priceperunit', 'price_per_unit'],
  sum: ['sum', 'total', 'amount', 'сумма'],
  unit: ['unit', 'ед', 'ед.изм'],
  sku: ['sku', 'productsku', 'артикул', 'article'],
  photo: ['photo', 'image', 'рисунок', 'photourl', 'photoid', 'photo_id', 'photoids', 'photo_ids', 'фото'],
  description: ['description', 'desc', 'описание'],
};

function refId(value: unknown): string {
  if (value && typeof value === 'object' && '_id' in value) {
    return String((value as { _id: unknown })._id);
  }
  return value == null ? '' : String(value);
}

function sourceType(entry: DataSetEntry): DataSetSourceType {
  const raw = entry.source?.type;
  if (raw === 'quotation-items' || raw === 'order-items' || raw === 'catalog-products' || raw === 'catalog-modules' || raw === 'catalog-parts' || raw === 'catalog-materials') return raw;
  return 'manual';
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

const PHOTO_COLUMN_KEYS = new Set(COLUMN_ALIASES.photo);

/** TZ-NX-DOCSTUDIO-S48 — same key aliases as the `photo` alias group above. */
function isPhotoColumnKey(key: string): boolean {
  return PHOTO_COLUMN_KEYS.has(normalizeKey(key));
}

/** Escape a value for use inside a double-quoted HTML attribute (`escapeHtmlValue`'s quote branch never matches a bare `"`). */
function escapeAttrValue(value: string): string {
  return escapeHtmlValue(value).replace(/"/g, '&quot;');
}

/** TZ-NX-PO-SWEEP-05 — same `fit`/`posX`/`posY` normalization as the FE's `normalizePhotoFrame` (`@kppdf/ui/photo`); default = contain/center, same as a missing frame. */
function normalizePhotoFrameServer(frame: Partial<PhotoFrame> | undefined): PhotoFrame {
  const posX = typeof frame?.posX === 'number' && Number.isFinite(frame.posX) ? frame.posX : 50;
  const posY = typeof frame?.posY === 'number' && Number.isFinite(frame.posY) ? frame.posY : 50;
  return { fit: frame?.fit === 'cover' ? 'cover' : 'contain', posX, posY };
}

/**
 * TZ-NX-DOCSTUDIO-S48 / TZ-NX-PO-SWEEP-05 — thumbnail or blank cell (mirrors
 * legacy `table-template.service.ts` `formatCell`'s photo branch, no
 * Create-КП rewrite). `frame` = the catalog photo's own РАМКА
 * (`Photo.frame`); `blockFit` = the table block's «Фото в ячейке» override,
 * which only ever overrides `fit` — pan/crop stay catalog-owned.
 *
 * TZ-NX-DOCSTUDIO-TABLE-PHOTO-EMPTY-BLANK — no photo / missing file used to
 * render a «Нет фото» label (PO: intentional at the time, S48); PO reversed
 * that — an empty photo cell should be blank, not carry text or a broken-
 * image icon. Row height comes from the shared `td` padding, not this cell.
 */
function renderPhotoCellHtml(
  value: string,
  frame?: Partial<PhotoFrame>,
  blockFit?: PhotoFrame['fit'] | null,
  maxHeightPx = STUDIO_TABLE_PHOTO_MAX_HEIGHT_DEFAULT_PX,
): string {
  const url = value.trim();
  if (!url) return '';
  const normalized = normalizePhotoFrameServer(frame);
  const fit = blockFit ?? normalized.fit;
  const style = `max-width:100%;max-height:${maxHeightPx}px;object-fit:${fit};object-position:${normalized.posX}% ${normalized.posY}%`;
  return `<img src="${escapeAttrValue(url)}" alt="" style="${style}" />`;
}

function lineValue(columnKey: string, line: LineItem): string {
  const normalized = normalizeKey(columnKey);
  const alias = Object.entries(COLUMN_ALIASES).find(([, values]) =>
    values.includes(normalized),
  )?.[0];

  switch (alias ?? normalized) {
    case 'name':
      return line.productName ?? '';
    case 'qty':
      return line.quantity == null ? '' : String(line.quantity);
    case 'price':
      return line.unitPrice == null ? '' : String(line.unitPrice);
    case 'sum':
      return line.total == null ? '' : String(line.total);
    case 'unit':
      return line.unit ?? '';
    case 'sku':
      return line.productSku ?? '';
    case 'photo':
      return line.photoUrl ?? '';
    case 'description':
      return line.description ?? '';
    default:
      return '';
  }
}

export function mapLineItemsToRows(
  items: LineItem[],
  columns: StudioTableColumn[],
): string[][] {
  return items.map((item) =>
    columns.map((column) => lineValue(column.key, item)),
  );
}

export function storedRows(entry: DataSetEntry): string[][] {
  const rows = entry.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [],
  );
}

export interface StudioTablePhotoRenderOptions {
  /** Keyed by resolved photo URL (same string a photo cell holds). */
  frames?: Record<string, PhotoFrame>;
  /** Block's «Фото в ячейке» override; null/undefined defers to each photo's own frame.fit. */
  fit?: PhotoFrame['fit'] | null;
  maxHeightPx?: number;
}

export function renderStudioTableHtml(
  columns: StudioTableColumn[],
  rows: string[][],
  disabledRowIndices: number[] = [],
  vatPercent = 20,
  photoOptions?: StudioTablePhotoRenderOptions,
): string {
  if (columns.length === 0) {
    return '<p class="pi-empty-state">Нет описанных колонок.</p>';
  }
  const widths = columnWidthPercents(columns);
  const head = columns
    .map(
      (col, idx) =>
        `<th scope="col" style="text-align:${col.align ?? 'left'};width:${widths[idx]}%">${escapeHtmlValue(col.label ?? col.key)}</th>`,
    )
    .join('');
  const body =
    rows.length > 0
      ? rows
          .map((row, rowIndex) => {
            if (disabledRowIndices.includes(rowIndex)) return '';

            const cells = columns
              .map((column, idx) => {
                const value = row[idx] ?? '';
                const cellContent = isPhotoColumnKey(column.key)
                  ? renderPhotoCellHtml(
                      value,
                      photoOptions?.frames?.[value],
                      photoOptions?.fit,
                      photoOptions?.maxHeightPx,
                    )
                  : escapeHtmlValue(value);
                return `<td style="text-align:${column.align ?? 'left'};width:${widths[idx]}%">${cellContent}</td>`;
              })
              .join('');
            return `<tr>${cells}</tr>`;
          })
          .join('')
      : `<tr>${columns.map(() => '<td></td>').join('')}</tr>`;
  const totalColumnIndex = columns.findIndex((column) => column.type === 'sum' || ['sum', 'total'].includes(normalizeKey(column.key)));
  const total = totalColumnIndex >= 0
    ? rows.reduce((sum, row, rowIndex) => disabledRowIndices.includes(rowIndex) ? sum : sum + (Number(row[totalColumnIndex]) || 0), 0)
    : 0;
  const showVat = columns.some((column) => ['vat', 'nds', 'ндс'].includes(normalizeKey(column.key))) || columns.some((column) => column.type === 'vat');
  const footer = totalColumnIndex >= 0 ? `<tfoot><tr class="pi-table-subtotal"><td colspan="${Math.max(1, columns.length - 1)}">Итого</td><td>${escapeHtmlValue(String(total))}</td></tr>${showVat ? `<tr class="pi-table-vat"><td colspan="${Math.max(1, columns.length - 1)}">НДС (${vatPercent}%)</td><td>${escapeHtmlValue(String(total * vatPercent / 100))}</td></tr>` : ''}</tfoot>` : '';
  return (
    `<table class="pi-table pi-table-preview" cellspacing="0" cellpadding="6" style="border-collapse:collapse;table-layout:fixed;width:100%">` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>${footer}</table>`
  );
}

export function tableDataSetKey(block: TemplateBlockDocument): string {
  return `table-${String(block._id)}`;
}

export function tableColumnsFromBlock(
  block: TemplateBlockDocument,
): StudioTableColumn[] {
  const settings = block.settings as
    | { tableTemplateColumns?: StudioTableColumn[] }
    | undefined;
  return settings?.tableTemplateColumns ?? [];
}

/**
 * TZ-NX-DOCSTUDIO-TABLE-LINE-QTY — per-row quantity overrides for
 * catalog-sourced table rows, keyed by row index. Lives on the block
 * (a property of this table's rows), never on Product/Material/Module —
 * a catalog pick's default is always `1`, this is what survives an
 * operator's edit across refresh/re-fetch.
 */
export function tableQtyOverridesFromBlock(
  block: TemplateBlockDocument,
): Record<number, number> {
  const settings = block.settings as
    | { tableQtyOverrides?: unknown }
    | undefined;
  const raw = settings?.tableQtyOverrides;
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<number, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const idx = Number(key);
    const qty = Number(value);
    if (Number.isInteger(idx) && idx >= 0 && Number.isFinite(qty) && qty >= 0) {
      result[idx] = qty;
    }
  }
  return result;
}

/** Manual table rows stored on the block until baked into document.dataSets. */
export function sampleRowsFromBlock(block: TemplateBlockDocument): string[][] {
  const settings = block.settings as
    | {
        tableTemplateSampleRows?: unknown;
        tableTemplateDisabledRows?: unknown;
      }
    | undefined;
  const rawRows = settings?.tableTemplateSampleRows;
  if (!Array.isArray(rawRows)) return [];
  const disabled = new Set(
    Array.isArray(settings?.tableTemplateDisabledRows)
      ? settings!.tableTemplateDisabledRows!.filter(
          (value): value is number => typeof value === 'number' && Number.isFinite(value),
        )
      : [],
  );
  return rawRows
    .map((row, index) => (disabled.has(index) ? null : row))
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? '')));
}

/** Ensure each table block has a dataSet entry (preview/PDF when dataSets[] is empty). */
export function ensureTableDataSetsFromBlocks(
  blocks: TemplateBlockDocument[],
  entries: DataSetEntry[],
): DataSetEntry[] {
  const merged = [...entries];
  const keys = new Set(
    merged
      .filter((entry) => typeof entry.key === 'string')
      .map((entry) => String(entry.key)),
  );
  for (const block of blocks) {
    if (block.type !== 'table') continue;
    const key = tableDataSetKey(block);
    if (keys.has(key)) continue;
    merged.push({
      key,
      source: { type: 'manual' },
      rows: sampleRowsFromBlock(block),
    });
    keys.add(key);
  }
  return merged;
}

/** TZ-NX-PO-SWEEP-05 — mirrors FE `studioTablePhotoDisplay` (studio-table-defaults.ts): block-level «Фото в ячейке» override. */
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

export function injectTableContent(
  blocks: TemplateBlockDocument[],
  dataSets: DataSetEntry[],
  vatPercent = 20,
): TemplateBlockDocument[] {
  const byKey = new Map(
    dataSets
      .filter((entry) => typeof entry.key === 'string')
      .map((entry) => [String(entry.key), entry]),
  );

    return blocks.map((block) => {
    if (block.type !== 'table') return block;
    const key = tableDataSetKey(block);
    const entry = byKey.get(key);
    const columns = tableColumnsFromBlock(block);
    const rows = entry ? storedRows(entry) : [];
    const disabled = entry && Array.isArray(entry.disabledRowIndices) ? entry.disabledRowIndices.filter((value): value is number => typeof value === 'number') : [];
    const photoDisplay = tablePhotoDisplayFromBlock(block);
    const html = renderStudioTableHtml(columns, rows, disabled, vatPercent, {
      frames: entry?.photoFrames,
      fit: photoDisplay.fit,
      maxHeightPx: photoDisplay.maxHeightPx,
    });
    const plain =
      typeof (block as { toObject?: () => Record<string, unknown> }).toObject ===
      'function'
        ? (block as { toObject: () => Record<string, unknown> }).toObject()
        : { ...(block as object) };
    return { ...plain, content: html } as TemplateBlockDocument;
  });
}

/**
 * TZ-DOC-STUDIO-1601 — live-read ERP rows for draft studio documents.
 */
@Injectable()
export class StudioDataResolverService {
  constructor(
    private readonly quotationService: QuotationService,
    private readonly orderService: OrderService,
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(ProductModule.name) private readonly moduleModel: Model<ProductModuleDocument>,
    @InjectModel(Material.name) private readonly materialModel: Model<MaterialDocument>,
    @InjectModel(Organization.name) private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(Photo.name) private readonly photoModel: Model<PhotoDocument>,
  ) {}

  async resolveOrganizationVatRate(organizationId: string): Promise<number> {
    if (!Types.ObjectId.isValid(organizationId)) return 20;
    const org = await this.orgModel.findById(organizationId).select('vatRate').lean().exec();
    const rate = org?.vatRate;
    return typeof rate === 'number' && rate >= 0 ? rate : 20;
  }

  async resolveDataSets(
    doc: StudioDocumentDocument,
    blocks: TemplateBlockDocument[],
    useLive: boolean,
  ): Promise<Record<string, unknown>[]> {
    const context = doc.context ?? {};
    const orgId = refId(doc.organizationId);
    const entries = ensureTableDataSetsFromBlocks(
      blocks,
      [...(doc.dataSets ?? [])] as DataSetEntry[],
    );
    const columnsByKey = new Map(
      blocks
        .filter((block) => block.type === 'table')
        .map((block) => [tableDataSetKey(block), tableColumnsFromBlock(block)]),
    );
    const qtyOverridesByKey = new Map(
      blocks
        .filter((block) => block.type === 'table')
        .map((block) => [tableDataSetKey(block), tableQtyOverridesFromBlock(block)]),
    );

    const resolved = await Promise.all(
      entries.map(async (entry) => {
        const type = sourceType(entry);
        if (!useLive || type === 'manual') {
          return { ...entry };
        }
        const key = String(entry.key ?? '');
        const columns = columnsByKey.get(key) ?? this.defaultColumns();
        const qtyOverrides = qtyOverridesByKey.get(key) ?? {};
        const live = await this.fetchLiveRows(
          type,
          context,
          orgId,
          columns,
          qtyOverrides,
        );
        if (live == null) {
          return { ...entry };
        }
        const manual = storedRows(entry);
        const rows =
          manual.length > 0
            ? this.mergeRowOverrides(live.rows, manual)
            : live.rows;
        return {
          ...entry,
          rows,
          ...(live.photoFrames ? { photoFrames: live.photoFrames } : {}),
        };
      }),
    );

    return resolved as Record<string, unknown>[];
  }

  async bakeSnapshot(
    doc: StudioDocumentDocument,
    blocks: TemplateBlockDocument[],
  ): Promise<Record<string, unknown>[]> {
    const baked = await this.resolveDataSets(doc, blocks, true);
    return baked.map((entry) => {
      const type = sourceType(entry as DataSetEntry);
      if (type === 'manual') return entry;
      return {
        ...entry,
        source: { type: 'manual', bakedFrom: type },
        rows: storedRows(entry as DataSetEntry),
      };
    });
  }

  private mergeRowOverrides(
    liveRows: string[][],
    manualRows: string[][],
  ): string[][] {
    const max = Math.max(liveRows.length, manualRows.length);
    const merged: string[][] = [];
    for (let i = 0; i < max; i += 1) {
      const live = liveRows[i] ?? [];
      const manual = manualRows[i] ?? [];
      const width = Math.max(live.length, manual.length);
      const row: string[] = [];
      for (let j = 0; j < width; j += 1) {
        const override = manual[j]?.trim();
        row.push(override ? manual[j]! : (live[j] ?? ''));
      }
      merged.push(row);
    }
    return merged;
  }

  private async fetchLiveRows(
    type: DataSetSourceType,
    context: Record<string, unknown>,
    organizationId: string,
    columns: StudioTableColumn[],
    qtyOverrides: Record<number, number> = {},
  ): Promise<{ rows: string[][]; photoFrames?: Record<string, PhotoFrame> } | null> {
    if (type === 'quotation-items') {
      const quotationId = context['quotationId'];
      if (typeof quotationId !== 'string' || !quotationId.trim()) return null;
      const quotation = await this.quotationService.findById(quotationId);
      if (refId(quotation.organizationId) !== organizationId) {
        throw new ForbiddenException(
          'Quotation belongs to another organization scope',
        );
      }
      return {
        rows: mapLineItemsToRows(
          (quotation.items ?? []) as QuotationItem[],
          columns,
        ),
      };
    }

    if (type === 'order-items') {
      const orderId = context['orderId'];
      if (typeof orderId !== 'string' || !orderId.trim()) return null;
      const order = await this.orderService.findById(orderId);
      const orderOrg = order.organizationId
        ? refId(order.organizationId)
        : organizationId;
      if (orderOrg !== organizationId) {
        throw new ForbiddenException(
          'Order belongs to another organization scope',
        );
      }
      return { rows: mapLineItemsToRows((order.items ?? []) as OrderItem[], columns) };
    }

    if (type.startsWith('catalog-')) {
      const kind = type.slice('catalog-'.length);
      const selections = (context['catalogSelections'] as Record<string, unknown> | undefined) ?? {};
      const rawIds = selections[kind];
      if (!Array.isArray(rawIds)) return { rows: [] };
      const ids = rawIds.filter((id): id is string => typeof id === 'string' && Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
      if (ids.length === 0) return { rows: [] };
      const filter: Record<string, unknown> = { _id: { $in: ids }, deletedAt: null };
      if (kind === 'parts') filter.materialKind = 'part';
      if (kind === 'materials') filter.materialKind = { $ne: 'part' };
      const scopeFilter = { ...filter, $or: [{ organizationId: new Types.ObjectId(organizationId) }, { organizationId: null }, { organizationId: { $exists: false } }] };
      const docs: Array<Record<string, unknown>> = kind === 'products'
        ? await this.productModel.find(scopeFilter).lean().exec() as unknown as Array<Record<string, unknown>>
        : kind === 'modules'
          ? await this.moduleModel.find(scopeFilter).lean().exec() as unknown as Array<Record<string, unknown>>
          : await this.materialModel.find(scopeFilter).lean().exec() as unknown as Array<Record<string, unknown>>;
      const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
      const photoById = await this.resolveCatalogPhotoUrls(docs);
      const photoFrames: Record<string, PhotoFrame> = {};
      const rows = ids.filter((id) => byId.has(String(id))).map((id, index) => {
        const item = byId.get(String(id)) as Record<string, unknown>;
        const name = String(item['name'] ?? item['sku'] ?? item['article'] ?? '');
        const sku = String(item['sku'] ?? item['article'] ?? '');
        const unit = String(item['unit'] ?? 'шт');
        const price = Number(item['listPrice'] ?? item['basePrice'] ?? item['pricePerUnit'] ?? 0);
        const description = String(item['description'] ?? '');
        const photo = photoById.get(this.catalogPhotoId(item));
        const photoUrl = photo?.url ?? '';
        // TZ-NX-PO-SWEEP-05: keyed by the resolved URL — the same string the
        // rendered cell holds, so canvas/PDF can look the frame up without
        // threading a parallel photoId through `rows`.
        if (photoUrl && photo?.frame) photoFrames[photoUrl] = photo.frame;
        // TZ-NX-DOCSTUDIO-TABLE-LINE-QTY — catalog pick defaults to 1 but an
        // operator's edit (tableQtyOverrides, keyed by row index) sticks across
        // refetch; total recomputes with it (was always `price`, i.e. only
        // correct by coincidence at qty=1).
        const quantity = qtyOverrides[index] ?? 1;
        const total = price * quantity;
        return mapLineItemsToRows([{ productName: name, productSku: sku, unit, quantity, unitPrice: price, total, description, photoUrl }], columns)[0] ?? [];
      });
      return { rows, photoFrames };
    }

    return null;
  }

  /** Catalog item's photo ref: `mainPhotoId`, falling back to the first `photoIds` entry. */
  private catalogPhotoId(item: Record<string, unknown>): string {
    const main = item['mainPhotoId'];
    if (main) return refId(main);
    const ids = item['photoIds'];
    return Array.isArray(ids) && ids.length > 0 ? refId(ids[0]) : '';
  }

  /**
   * Batch-resolve catalog docs' photo refs to `Photo.storageUrl` + `frame`
   * (S48 renders the thumbnail; TZ-NX-PO-SWEEP-05 applies the frame's
   * fit/pan instead of a hardcoded contain).
   */
  private async resolveCatalogPhotoUrls(
    docs: Array<Record<string, unknown>>,
  ): Promise<Map<string, { url: string; frame?: PhotoFrame }>> {
    const ids = [...new Set(docs.map((doc) => this.catalogPhotoId(doc)).filter((id) => id && Types.ObjectId.isValid(id)))];
    if (ids.length === 0) return new Map();
    const photos = await this.photoModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select('storageUrl frame')
      .lean()
      .exec();
    const entries = await Promise.all(
      photos.map(async (photo) => {
        const url = String((photo as { storageUrl?: string }).storageUrl ?? '');
        const verified = url && (await localUploadFileExists(url)) ? url : '';
        const frame = (photo as { frame?: PhotoFrame }).frame;
        return [String((photo as { _id: unknown })._id), { url: verified, frame }] as const;
      }),
    );
    return new Map(entries);
  }

  private defaultColumns(): StudioTableColumn[] {
    return [
      { key: 'name', label: 'Наименование', align: 'left' },
      { key: 'qty', label: 'Кол-во', align: 'right' },
      { key: 'price', label: 'Цена', align: 'right' },
    ];
  }
}
