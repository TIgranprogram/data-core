import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  KP_LINE_ITEM_COLUMNS,
  KP_LINE_ITEM_PRESET_NAME,
  TableTemplate,
  TableTemplateDocument,
} from './table-template.schema';
import { CreateTableTemplateDto } from './dto/create-table-template.dto';
import { UpdateTableTemplateDto } from './dto/update-table-template.dto';

/** Request-only copy-on-write layout applied to a live table preview. */
export interface TablePreviewLayoutColumn {
  key: string;
  visible?: boolean;
  widthPercent?: number;
}

export interface TableDealTotals {
  total: number;
  additionalTotal?: number;
  vatPercent: number;
  discountType?: 'none' | 'percent' | 'amount';
  discountPercent?: number;
  discountAmount?: number;
}

export interface TablePhotoOptions {
  photoScalePercent?: number;
  photoCropYPercent?: number;
  showPhotoColumn?: boolean;
  /** KP table body font size in px (default 12, clamp 8–20). */
  tableFontSize?: number;
  /** KP table header font size in px (default 12, clamp 8–20). */
  tableHeaderFontSize?: number;
}

export interface TablePreviewChrome {
  borderWeight?: 'thin' | 'normal' | 'thick';
  headerWeight?: 'normal' | 'bold';
}

/** Per-row visual snapshot for KP blank (TZ-SALES-370). Enums only — never raw CSS. */
export interface TableRowPresentation {
  density?: 'auto' | 'compact' | 'large';
  emphasis?: 'normal' | 'accent';
  separatorBefore?: boolean;
  pageBreakBefore?: boolean;
  showDescription?: boolean;
  photoFit?: 'inherit' | 'contain' | 'cover';
}

/**
 * TZ-86 Phase A.2 — TableTemplateService extended.
 *
 * New responsibilities:
 *  - preview(id) → HTML string. Server-side Intl.NumberFormat ('ru-RU' /
 *    'RUB') for currency/number cells; ISO date short for date cells;
 *    HTML-escaped text for text/bool cells.
 *  - create() / update() preserve new optional fields.
 *  - remove() uses Mongoose deleteOne with softDelete plugin (captures
 *    `deletedAt`). Service previously did `$set: {deletedAt}` — that's a
 *    raw mongo update that BYPASSES the softDelete plugin's audit hook;
 *    fixing it to deleteOne() restores plugin integration.
 */
@Injectable()
export class TableTemplateService implements OnModuleInit {
  constructor(
    @InjectModel(TableTemplate.name)
    private readonly model: Model<TableTemplateDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureKpPreset();
  }

  /** Ensure the canonical active KP preset exists exactly once by name/category. */
  async ensureKpPreset(): Promise<TableTemplateDocument> {
    const existing = await this.model
      .findOne({ name: KP_LINE_ITEM_PRESET_NAME, category: 'kp' })
      .exec();
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        await existing.save();
      }
      return existing;
    }

    return this.model.create({
      name: KP_LINE_ITEM_PRESET_NAME,
      description: 'Канон колонок позиций для коммерческого предложения',
      category: 'kp',
      sortOrder: -100,
      columns: KP_LINE_ITEM_COLUMNS.map((column) => ({ ...column })),
      isActive: true,
    });
  }

  async create(dto: CreateTableTemplateDto): Promise<TableTemplateDocument> {
    return this.model.create({
      name: dto.name,
      description: dto.description,
      category: dto.category,
      sortOrder: dto.sortOrder ?? 0,
      columns: dto.columns,
      sampleRows: dto.sampleRows,
      dataSource: dto.dataSource,
      isActive: dto.isActive ?? true,
    });
  }

  async findAll(filter?: {
    activeOnly?: boolean;
  }): Promise<TableTemplateDocument[]> {
    const q: Record<string, unknown> = {};
    if (filter?.activeOnly) q.isActive = true;
    return this.model
      .find(q)
      .sort({ category: 1, sortOrder: 1, name: 1 })
      .exec();
  }

  async findById(id: string): Promise<TableTemplateDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`TableTemplate ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`TableTemplate ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    dto: UpdateTableTemplateDto,
  ): Promise<TableTemplateDocument> {
    const doc = await this.findById(id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.category !== undefined) doc.category = dto.category;
    if (dto.sortOrder !== undefined) doc.sortOrder = dto.sortOrder;
    if (dto.columns !== undefined) doc.columns = dto.columns as never;
    if (dto.sampleRows !== undefined) doc.sampleRows = dto.sampleRows;
    if (dto.dataSource !== undefined) doc.dataSource = dto.dataSource;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    /**
     * `model.deleteOne({ _id, deletedAt: null })` lets the softDelete plugin
     *   set `deletedAt: <now>` automatically AND fire audit-log. The previous
     *   `$set: {deletedAt}` raw update bypassed both — fixing here.
     */
    await this.model.deleteOne({ _id: doc._id, deletedAt: null }).exec();
  }

  // ── Phase A.2 — preview endpoint ───────────────────────────────────────────

  /**
   * Render the table-template as inline HTML using sampleRows.
   * Pure HTML (no CSS — host page provides container styling).
   * Used by: TZ-86C.2 picker preview + TZ-86D.7 canvas placeholder.
   *
   * Cell formatting rules:
   *   - currency → `Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'RUB'})`
   *   - number   → `Intl.NumberFormat('ru-RU')` (no currency symbol, default decimals)
   *   - date     → `Date.toLocaleDateString('ru-RU')` (short dd.mm.yyyy)
   *   - bool     → «Да» / «Нет» (Russian labels, culturally consistent)
   *   - text     → HTML-escaped via `escapeHtml()`
   *
   * Empty sampleRows with declared columns preserve the table geometry:
   * headers plus one blank data row. A table without columns keeps the short
   * Russian empty state «Нет описанных колонок.».
   */
  async preview(
    id: string,
    previewRows?: unknown[][],
    layout?: TablePreviewLayoutColumn[],
    dealTotals?: TableDealTotals,
    photoOptions?: TablePhotoOptions,
    chrome?: TablePreviewChrome,
    rowPresentations?: TableRowPresentation[],
  ): Promise<string> {
    const doc = await this.findById(id);
    const cols = this.resolvePreviewColumns(
      doc.columns ?? [],
      layout,
      photoOptions,
    );
    if (cols.length === 0) {
      return '<p class="pi-empty-state">Нет описанных колонок.</p>';
    }

    const widthByKey = this.resolveWidthPercents(cols, layout);
    const borderPx =
      chrome?.borderWeight === 'thin'
        ? '0.5px'
        : chrome?.borderWeight === 'thick'
          ? '2px'
          : '1px';
    const headerWeight = chrome?.headerWeight === 'bold' ? '700' : '600';
    const tableFontPx = this.resolveTableFontSize(photoOptions);
    const headerFontPx = this.resolveTableHeaderFontSize(photoOptions);
    const colgroup = cols
      .map(
        (c) =>
          `<col style="width:${widthByKey.get(c.key) ?? Math.round(100 / cols.length)}%" />`,
      )
      .join('');
    const headHtml = cols
      .map(
        (c) =>
          `<th scope="col" style="text-align:${c.align ?? 'left'};width:${
            widthByKey.get(c.key) ?? Math.round(100 / cols.length)
          }%;font-size:${headerFontPx}px;font-weight:${headerWeight};border:${borderPx} solid #ccc">${this.escapeHtml(c.label ?? c.key ?? '')}</th>`,
      )
      .join('');
    // A caller-supplied array is request-scoped preview data. An explicit empty
    // array intentionally preserves the table skeleton instead of falling back
    // to persisted sample rows.
    const rows = previewRows ?? doc.sampleRows ?? [];
    if (rows.length === 0) {
      const blankCells = cols
        .map(
          (c) =>
            `<td style="text-align:${c.align ?? 'left'};font-size:${tableFontPx}px;border:${borderPx} solid #ccc"></td>`,
        )
        .join('');
      const tableHtml =
        `<table class="pi-table pi-table-preview" cellspacing="0" cellpadding="6" style="border-collapse:collapse;table-layout:fixed;width:100%">` +
        `<colgroup>${colgroup}</colgroup>` +
        `<thead><tr>${headHtml}</tr></thead>` +
        `<tbody><tr>${blankCells}</tr></tbody>` +
        '</table>';
      return tableHtml + this.renderDealFooter(dealTotals);
    }

    const bodyHtml = rows
      .map((row, rowIndex) => {
        const presentation = this.resolveRowPresentation(
          rowPresentations?.[rowIndex],
        );
        const cells = cols
          .map((c, idx) => {
            const cell = Array.isArray(row) ? row[idx] : undefined;
            const formatted = this.formatCell(
              cell,
              c.type,
              c.format,
              photoOptions,
              presentation,
              c.key,
            );
            const pad =
              presentation.density === 'compact'
                ? '2px 4px'
                : presentation.density === 'large'
                  ? '10px 8px'
                  : '6px';
            const minH =
              presentation.density === 'compact'
                ? 'min-height:1.4em;'
                : presentation.density === 'large'
                  ? 'min-height:2.6em;'
                  : '';
            const topBorder =
              presentation.separatorBefore === true
                ? `border-top:2px solid #333;`
                : `border-top:${borderPx} solid #ccc;`;
            return `<td style="text-align:${c.align ?? 'left'};font-size:${tableFontPx}px;border:${borderPx} solid #ccc;${topBorder}padding:${pad};${minH}">${formatted}</td>`;
          })
          .join('');
        const trStyles: string[] = [];
        if (presentation.emphasis === 'accent') {
          trStyles.push('background:#f3f3f0');
        }
        if (presentation.pageBreakBefore === true && rowIndex > 0) {
          trStyles.push('page-break-before:always');
          trStyles.push('break-before:page');
        }
        const trAttr =
          trStyles.length > 0 ? ` style="${trStyles.join(';')}"` : '';
        return `<tr${trAttr}>${cells}</tr>`;
      })
      .join('');

    const tableHtml =
      `<table class="pi-table pi-table-preview" cellspacing="0" cellpadding="6" style="border-collapse:collapse;table-layout:fixed;width:100%">` +
      `<colgroup>${colgroup}</colgroup>` +
      `<thead><tr>${headHtml}</tr></thead>` +
      `<tbody>${bodyHtml}</tbody>` +
      '</table>';
    return tableHtml + this.renderDealFooter(dealTotals);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** KP sheetLayout.tableFontSize — body; default 12, clamp 8–20 (TZ-SALES-373). */
  private resolveTableFontSize(photoOptions?: TablePhotoOptions): number {
    const raw = photoOptions?.tableFontSize;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 12;
    return Math.min(20, Math.max(8, Math.round(raw)));
  }

  /** KP sheetLayout.tableHeaderFontSize — th; default 12, clamp 8–20 (TZ-SALES-374). */
  private resolveTableHeaderFontSize(photoOptions?: TablePhotoOptions): number {
    const raw = photoOptions?.tableHeaderFontSize;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 12;
    return Math.min(20, Math.max(8, Math.round(raw)));
  }

  private resolveWidthPercents(
    cols: TableTemplateDocument['columns'],
    layout?: TablePreviewLayoutColumn[],
  ): Map<string, number> {
    const fromLayout = new Map<string, number>();
    for (const entry of layout ?? []) {
      if (
        typeof entry.widthPercent === 'number' &&
        Number.isFinite(entry.widthPercent) &&
        entry.widthPercent > 0
      ) {
        fromLayout.set(
          entry.key,
          Math.min(80, Math.max(5, Math.round(entry.widthPercent))),
        );
      }
    }
    const equal = cols.length > 0 ? Math.round(100 / cols.length) : 100;
    const result = new Map<string, number>();
    let assigned = 0;
    cols.forEach((col, index) => {
      const value = fromLayout.get(col.key) ?? equal;
      if (index === cols.length - 1) {
        result.set(col.key, Math.max(5, 100 - assigned));
      } else {
        result.set(col.key, value);
        assigned += value;
      }
    });
    return result;
  }

  private resolvePreviewColumns(
    columns: TableTemplateDocument['columns'],
    layout?: TablePreviewLayoutColumn[],
    photoOptions?: TablePhotoOptions,
  ): TableTemplateDocument['columns'] {
    if (!layout) {
      return photoOptions?.showPhotoColumn === false
        ? columns.filter((column) => !this.isPhotoColumn(column.key))
        : columns;
    }
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const selected = layout
      .filter((entry) => entry.visible !== false)
      .filter(
        (entry) =>
          photoOptions?.showPhotoColumn !== false ||
          !this.isPhotoColumn(entry.key),
      )
      .map((entry) => byKey.get(entry.key) ?? this.syntheticKpColumn(entry.key))
      .filter((column): column is TableTemplateDocument['columns'][number] =>
        Boolean(column),
      );
    return selected.length > 0 ? selected : columns;
  }

  /** Request-only KP columns; never persisted into the shared table template. */
  private syntheticKpColumn(
    key: string,
  ): TableTemplateDocument['columns'][number] | null {
    const normalized = key.trim().toLowerCase();
    const aliases: Record<string, string[]> = {
      index: ['index', 'number', '№', 'номер'],
      productName: ['productname', 'name', 'title', 'product', 'наименование'],
      quantity: ['quantity', 'qty', 'count', 'кол-во', 'количество'],
      unit: ['unit', 'ед', 'ед.изм'],
      unitPrice: ['unitprice', 'price', 'unit_price', 'цена'],
      sum: ['sum', 'total', 'amount', 'сумма'],
      photo: ['photo', 'image', 'рисунок', 'photourl', 'photoid', 'photo_id', 'photoids', 'photo_ids', 'фото'],
    };
    const match = Object.entries(aliases).find(([, values]) =>
      values.includes(normalized),
    );
    if (!match) return null;
    const defaults = KP_LINE_ITEM_COLUMNS.find(
      (column) => column.key === match[0],
    );
    if (match[0] === 'photo') {
      return {
        key: 'photo',
        label: 'Фото',
        type: 'text',
        width: 100,
        align: 'center',
      } as TableTemplateDocument['columns'][number];
    }
    return defaults
      ? ({ ...defaults } as TableTemplateDocument['columns'][number])
      : null;
  }

  private renderDealFooter(dealTotals?: TableDealTotals): string {
    if (!dealTotals) return '';
    const total = this.roundMoney(dealTotals.total);
    const totalLabel = this.formatMoney(total);
    const vat = this.roundMoney(
      dealTotals.vatPercent > 0
        ? (total * dealTotals.vatPercent) / (100 + dealTotals.vatPercent)
        : 0,
    );
    const vatRow =
      dealTotals.vatPercent > 0
        ? `<div>в т.ч. НДС ${dealTotals.vatPercent}%: ${this.formatMoney(vat)} ₽</div>`
        : '';
    const additional =
      (dealTotals.additionalTotal ?? 0) > 0
        ? `<div>Дополнительно (не входит в стоимость): ${this.formatMoney(this.roundMoney(dealTotals.additionalTotal ?? 0))} ₽</div>`
        : '';
    return (
      `<div class="pi-deal-totals" style="margin-top:8px;text-align:right">` +
      `<div><strong>Итого: ${totalLabel} ₽</strong></div>${additional}${vatRow}</div>`
    );
  }

  private roundMoney(value: number): number {
    return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  }

  private formatMoney(value: number): string {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  private formatCell(
    value: unknown,
    type: string,
    format?: string,
    photoOptions?: TablePhotoOptions,
    rowPresentation?: TableRowPresentation,
    columnKey?: string,
  ): string {
    // Photo columns: accept {kind:'image'}, real /uploads URL strings, and
    // neutralize legacy sample placeholders like `[img]` (TZ-QA-445C).
    if (columnKey && this.isPhotoColumn(columnKey)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        (value as { kind?: string }).kind === 'image'
      ) {
        return this.formatImageCell(
          (value as { url?: unknown }).url,
          photoOptions,
          rowPresentation?.photoFit,
        );
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // TZ-NX-DOCSTUDIO-TABLE-PHOTO-EMPTY-BLANK: no photo → blank cell, not a «Нет фото» label.
        if (!trimmed || /^\[(?:img|image|фото|photo)\]$/i.test(trimmed)) {
          return '';
        }
        return this.formatImageCell(
          trimmed,
          photoOptions,
          rowPresentation?.photoFit,
        );
      }
      if (value === null || value === undefined || value === '') {
        return '';
      }
    }
    if (value === null || value === undefined || value === '') {
      return '';
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as { kind?: string }).kind === 'image'
    ) {
      return this.formatImageCell(
        (value as { url?: unknown }).url,
        photoOptions,
        rowPresentation?.photoFit,
      );
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as { kind?: string }).kind === 'line-text'
    ) {
      const line = value as {
        title?: unknown;
        description?: unknown;
        optional?: boolean;
      };
      const title = this.escapeHtml(String(line.title ?? ''));
      const showDescription = rowPresentation?.showDescription !== false;
      const description =
        showDescription && line.description
          ? `<div style="font-size:0.85em;color:#666">${this.escapeHtml(String(line.description))}</div>`
          : '';
      const optional = line.optional
        ? ' <span style="font-size:0.8em;color:#666">(не входит в стоимость)</span>'
        : '';
      return `<div>${title}${optional}</div>${description}`;
    }
    switch (type) {
      case 'currency': {
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num)) return this.escapeHtml(String(value));
        try {
          return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            ...(format ? { minimumFractionDigits: Number(format) || 2 } : {}),
          }).format(num);
        } catch {
          return this.escapeHtml(String(value));
        }
      }
      case 'number': {
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num)) return this.escapeHtml(String(value));
        try {
          return new Intl.NumberFormat('ru-RU', {
            ...(format ? { minimumFractionDigits: Number(format) || 0 } : {}),
          }).format(num);
        } catch {
          return this.escapeHtml(String(value));
        }
      }
      case 'date': {
        const d = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(d.getTime())) return this.escapeHtml(String(value));
        return d.toLocaleDateString('ru-RU');
      }
      case 'bool':
        return value === true ||
          value === 'true' ||
          value === 1 ||
          value === '1'
          ? 'Да'
          : 'Нет';
      case 'text':
      default:
        return this.escapeHtml(String(value));
    }
  }

  private isPhotoColumn(key: string): boolean {
    return [
      'photo',
      'image',
      'рисунок',
      'photourl',
      'photoid',
      'photo_id',
      'photoids',
      'photo_ids',
      'фото',
    ].includes(key.trim().toLowerCase());
  }

  private resolveRowPresentation(
    value?: TableRowPresentation | null,
  ): Required<
    Pick<
      TableRowPresentation,
      | 'density'
      | 'emphasis'
      | 'separatorBefore'
      | 'pageBreakBefore'
      | 'showDescription'
      | 'photoFit'
    >
  > {
    return {
      density: value?.density ?? 'auto',
      emphasis: value?.emphasis ?? 'normal',
      separatorBefore: value?.separatorBefore === true,
      pageBreakBefore: value?.pageBreakBefore === true,
      showDescription: value?.showDescription !== false,
      photoFit: value?.photoFit ?? 'inherit',
    };
  }

  private formatImageCell(
    value: unknown,
    photoOptions?: TablePhotoOptions,
    photoFit?: TableRowPresentation['photoFit'],
  ): string {
    // TZ-NX-DOCSTUDIO-TABLE-PHOTO-EMPTY-BLANK: no photo / unresolved file → blank cell.
    if (typeof value !== 'string' || !value) {
      return '';
    }
    const url = this.resolvePhotoUrl(value.trim());
    if (!url) return '';
    const fit =
      photoFit === 'contain' || photoFit === 'cover' ? photoFit : null;
    if (!photoOptions) {
      const objectFit = fit ?? 'contain';
      return `<img src="${this.escapeHtml(url)}" alt="" style="max-width:72px;max-height:48px;object-fit:${objectFit}" />`;
    }
    const scale = Math.min(
      400,
      Math.max(10, photoOptions.photoScalePercent ?? 100),
    );
    const cropY = Math.min(
      100,
      Math.max(0, photoOptions?.photoCropYPercent ?? 0),
    );
    const width = Math.min(240, Math.max(10, (72 * scale) / 100));
    const height = Math.min(120, Math.max(10, (48 * scale) / 100));
    const objectFit = fit ?? 'cover';
    return `<img src="${this.escapeHtml(url)}" alt="" style="width:${width}px;height:${height}px;max-width:100%;object-fit:${objectFit};object-position:center ${cropY}%" />`;
  }

  private resolvePhotoUrl(value: string): string | null {
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) {
      return value;
    }
    if (/^\/uploads\/(?!\/|\.\.?\/)/.test(value) && !value.includes('..\\') && !value.includes('/../') && !/[?\s]/.test(value)) {
      return value;
    }
    try {
      const parsed = new URL(value);
      const configured = process.env.KPPDF_PUBLIC_ORIGIN ?? process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000';
      const configuredOrigin = new URL(configured).origin;
      const loopbackOrigin = configuredOrigin.replace('127.0.0.1', 'localhost');
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      if (![configuredOrigin, loopbackOrigin].includes(parsed.origin)) return null;
      if (!parsed.pathname.startsWith('/uploads/') || parsed.search || parsed.hash) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  /** Minimal HTML escaper; output rendered as `[innerHTML]` on consumer side. */
  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
