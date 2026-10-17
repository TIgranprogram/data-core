import type { TemplateBlockDocument } from '../template-block/template-block.schema';
import {
  storedRows,
  tableColumnsFromBlock,
  tableDataSetKey,
  type StudioTableColumn,
} from './studio-data-resolver';

export type TableAggregateKey = 'subtotal' | 'vat' | 'grand';

export function tableAggregateValue(
  columns: StudioTableColumn[],
  rows: string[][],
  key: TableAggregateKey,
  vatPercent: number,
): number {
  const totalColumnIndex = columns.findIndex(
    (column) => column.type === 'sum' || ['sum', 'total'].includes(column.key.trim().toLowerCase()),
  );
  const subtotal = totalColumnIndex >= 0
    ? rows.reduce((sum, row) => sum + (Number(row[totalColumnIndex]) || 0), 0)
    : 0;
  const vat = subtotal * vatPercent / 100;
  if (key === 'subtotal') return subtotal;
  if (key === 'vat') return vat;
  return subtotal + vat;
}

function formatMoneyRu(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function resolveTableAggregateTokens(
  content: string,
  blocks: TemplateBlockDocument[],
  dataSets: Record<string, unknown>[],
  vatPercent: number,
): string {
  const tableBlocks = blocks.filter((block) => block.type === 'table');
  const primary = tableBlocks[0];
  if (!primary) return content;

  const key = tableDataSetKey(primary);
  const entry = dataSets.find((item) => String(item['key'] ?? '') === key);
  const columns = tableColumnsFromBlock(primary);
  const rows = entry ? storedRows(entry as { rows?: unknown }) : [];
  const blockId = String(primary._id);

  const replacements: Record<string, string> = {
    subtotal: formatMoneyRu(tableAggregateValue(columns, rows, 'subtotal', vatPercent)),
    vat: formatMoneyRu(tableAggregateValue(columns, rows, 'vat', vatPercent)),
    grand: formatMoneyRu(tableAggregateValue(columns, rows, 'grand', vatPercent)),
  };

  let next = content;
  for (const [aggregate, value] of Object.entries(replacements)) {
    next = next.replaceAll(`{{table.${blockId}.${aggregate}}}`, value);
    next = next.replaceAll(`{{table.${aggregate}}}`, value);
  }
  return next;
}

export function applyTableAggregateTokensToBlocks(
  blocks: TemplateBlockDocument[],
  dataSets: Record<string, unknown>[],
  vatPercent: number,
): TemplateBlockDocument[] {
  return blocks.map((block) => {
    if (block.type !== 'text' || typeof block.content !== 'string') return block;
    // TZ-NX-DOCSTUDIO-S37C: `block` here is frequently a live Mongoose Document
    // (findAllByStudioDocument doesn't .lean()). Spreading it directly does not
    // reliably carry nested subdocument paths like `layout` — Mongoose documents
    // need `.toObject()` first. Without this, the block silently loses its layout
    // and document-render.service.ts's `Boolean(b.layout)` filter drops it from
    // Preview/PDF entirely (same guard injectTableContent already applies).
    const plain =
      typeof (block as { toObject?: () => Record<string, unknown> }).toObject === 'function'
        ? (block as { toObject: () => Record<string, unknown> }).toObject()
        : { ...(block as object) };
    return {
      ...plain,
      content: resolveTableAggregateTokens(block.content, blocks, dataSets, vatPercent),
    } as TemplateBlockDocument;
  });
}
