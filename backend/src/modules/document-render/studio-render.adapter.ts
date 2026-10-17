import type { DocumentTemplateDocument } from '../document-template/document-template.schema';
import type { TemplateBlockDocument } from '../template-block/template-block.schema';
import type { BuildDocumentDto } from '../document-template/dto/build-document.dto';

/** Minimal studio document slice needed for render adapter (Wave 2c). */
export interface StudioDocumentRenderSlice {
  name: string;
  pageSize?: 'A3' | 'A4' | 'A5';
  orientation?: 'portrait' | 'landscape';
  backgroundImage?: string[];
  defaultBackgroundIndex?: number;
  backgroundPageIndices?: number[];
  backgroundOpacity?: number;
  pageMargins?: { top: number; right: number; bottom: number; left: number };
  sheetLayout?: { rowsFirstPage: number; rowsNextPage: number };
  pageNumbering?: boolean;
  manualPageCount?: number;
}

export interface StudioDocumentAggregate {
  document: StudioDocumentRenderSlice;
  blocks: TemplateBlockDocument[];
  buildDto?: Partial<BuildDocumentDto>;
  dataSets?: Record<string, unknown>[];
  /**
   * TZ-NX-DOCSTUDIO-S8-1 — pre-hydrated substitution bag
   * (organization/counterparty/quotation/order…) from the caller.
   * When present it is passed straight through to DocumentRenderService;
   * when absent the adapter falls back to the legacy stub behaviour.
   */
  data?: Record<string, unknown>;
}

/**
 * Maps a studio aggregate to template + data bag for DocumentRenderService.
 * Deterministic: same aggregate → same render input JSON shape.
 */
export function studioAggregateToRenderInput(
  aggregate: StudioDocumentAggregate,
): {
  template: DocumentTemplateDocument;
  blocks: TemplateBlockDocument[];
  data: Record<string, unknown>;
} {
  const doc = aggregate.document;
  const template = {
    name: doc.name,
    pageSize: doc.pageSize ?? 'A4',
    orientation: doc.orientation ?? 'portrait',
    backgroundImage: doc.backgroundImage ?? [],
    defaultBackgroundIndex: doc.defaultBackgroundIndex ?? -1,
    backgroundPageIndices: doc.backgroundPageIndices,
    backgroundOpacity: doc.backgroundOpacity ?? 0.3,
    pageMargins: doc.pageMargins,
    sheetLayout: doc.sheetLayout,
    pageNumbering: doc.pageNumbering ?? false,
  } as unknown as DocumentTemplateDocument;

  const data: Record<string, unknown> = {};
  const dto = aggregate.buildDto ?? {};
  if (aggregate.data) {
    // TZ-NX-DOCSTUDIO-S8-1 — hydrated bag from buildSubstitutionBag takes
    // precedence over the buildDto stubs.
    for (const [k, v] of Object.entries(aggregate.data)) {
      data[k] = v;
    }
  }
  if (dto.organizationId && !data.organization) data.organization = { _id: dto.organizationId };
  if (dto.counterpartyId && !data.counterparty) data.counterparty = { name: '' };

  return {
    template,
    blocks: aggregate.blocks,
    data,
  };
}
