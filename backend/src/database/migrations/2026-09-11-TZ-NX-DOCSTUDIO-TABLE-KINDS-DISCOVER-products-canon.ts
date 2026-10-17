import { Model } from 'mongoose';
import {
  TableColumn,
  TableTemplate,
  TableTemplateDocument,
  TableTemplateSchema,
} from '../../modules/table-template/table-template.schema';

/**
 * TZ-NX-DOCSTUDIO-TABLE-KINDS-DISCOVER — canonical «Продукты» table template.
 *
 * Live-DB audit (2026-09-11, same session) found THREE active duplicate
 * «Продукты» templates, all with the identical 6-column set
 * `sku|photoIds|name|description|unit|listPrice` and — critically — no
 * «Количество» column at all. That is the root cause of the PO complaint
 * "нет Количества": the canonical view itself never had the field, quite
 * apart from the (separately fixed, TZ-NX-DOCSTUDIO-TABLE-COL-STRUCTURE)
 * UI gate that blocked adding one manually.
 *
 * This migration:
 *  1. Picks the OLDEST active «Продукты» template as canonical (stable
 *     choice — does not depend on _id ordering, which is random).
 *  2. Deactivates (never deletes) every other duplicate — any studio
 *     document still referencing a duplicate's `tableTemplateId` keeps
 *     working (the block's own `tableTemplateColumns` snapshot is
 *     unaffected either way), it just stops appearing in the picker.
 *  3. Appends a «Количество» (`qty`) column to the canonical template ONLY
 *     if none of the qty aliases is already present — never overwrites an
 *     operator's existing customization otherwise.
 *  4. Creates one fresh canonical template from scratch only if no active
 *     «Продукты» exists at all.
 *
 * Idempotency: after one run, exactly one active «Продукты» remains and it
 * already has a qty column — a second run finds 0 duplicates and
 * `addedQtyColumn: false`.
 *
 * RUNTIME INVOCATION (manual, per TZ-240 convention):
 *   `npx ts-node backend/src/database/migrations/2026-09-11-TZ-NX-DOCSTUDIO-TABLE-KINDS-DISCOVER-products-canon.ts`
 */
export const PRODUCTS_CANON_NAME = 'Продукты';

/** Mirrors backend `COLUMN_ALIASES.qty` (studio-data-resolver.ts) — kept local, this migration is a standalone script. */
const QTY_COLUMN_ALIASES = new Set(['qty', 'quantity', 'count', 'кол-во', 'количество']);

export const PRODUCTS_CANON_COLUMNS: TableColumn[] = [
  { key: 'sku', label: 'Артикул', type: 'text', width: 50, align: 'center' } as TableColumn,
  { key: 'photoIds', label: 'Фото', type: 'text', width: 120, align: 'center' } as TableColumn,
  { key: 'name', label: 'Наименование', type: 'text', width: 120, align: 'center' } as TableColumn,
  { key: 'description', label: 'Описание', type: 'text', width: 120, align: 'center' } as TableColumn,
  { key: 'unit', label: 'Ед.Изм.', type: 'text', width: 120, align: 'left' } as TableColumn,
  { key: 'listPrice', label: 'Цена', type: 'currency', width: 50, align: 'center' } as TableColumn,
  { key: 'qty', label: 'Количество', type: 'number', width: 60, align: 'right' } as TableColumn,
];

export interface ProductsCanonMigrationResult {
  created: boolean;
  canonicalId: string | null;
  deduped: number;
  addedQtyColumn: boolean;
}

export async function runProductsCanonMigration(
  templateModel: Model<TableTemplateDocument>,
): Promise<ProductsCanonMigrationResult> {
  const candidates = await templateModel
    .find({ name: PRODUCTS_CANON_NAME, isActive: true })
    .sort({ createdAt: 1 })
    .exec();

  if (candidates.length === 0) {
    const created = await templateModel.create({
      name: PRODUCTS_CANON_NAME,
      columns: PRODUCTS_CANON_COLUMNS,
      isActive: true,
      sortOrder: 0,
    });
    console.log(
      `[TZ-NX-DOCSTUDIO-TABLE-KINDS-DISCOVER] No active «${PRODUCTS_CANON_NAME}» template found — created ${created._id}`,
    );
    return { created: true, canonicalId: String(created._id), deduped: 0, addedQtyColumn: false };
  }

  const [canonical, ...duplicates] = candidates;
  let deduped = 0;
  for (const duplicate of duplicates) {
    await templateModel.updateOne({ _id: duplicate._id }, { $set: { isActive: false } }).exec();
    deduped += 1;
  }
  if (deduped > 0) {
    console.log(
      `[TZ-NX-DOCSTUDIO-TABLE-KINDS-DISCOVER] Deactivated ${deduped} duplicate «${PRODUCTS_CANON_NAME}» template(s); canonical = ${canonical._id}`,
    );
  }

  const hasQty = canonical.columns.some((col) => QTY_COLUMN_ALIASES.has(col.key.trim().toLowerCase()));
  let addedQtyColumn = false;
  if (!hasQty) {
    const nextColumns = [
      ...canonical.columns,
      { key: 'qty', label: 'Количество', type: 'number', width: 60, align: 'right' } as TableColumn,
    ];
    await templateModel.updateOne({ _id: canonical._id }, { $set: { columns: nextColumns } }).exec();
    addedQtyColumn = true;
    console.log(
      `[TZ-NX-DOCSTUDIO-TABLE-KINDS-DISCOVER] Added «Количество» column to canonical «${PRODUCTS_CANON_NAME}» template ${canonical._id}`,
    );
  }

  return { created: false, canonicalId: String(canonical._id), deduped, addedQtyColumn };
}

/** Self-invocation guard: runs only when executed directly via ts-node. */
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mongoose = require('mongoose');
  (async () => {
    await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kppdf');
    try {
      const templateModel = mongoose.model(TableTemplate.name, TableTemplateSchema);
      const result = await runProductsCanonMigration(templateModel);
      console.log('[TZ-NX-DOCSTUDIO-TABLE-KINDS-DISCOVER] Result:', result);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error('[TZ-NX-DOCSTUDIO-TABLE-KINDS-DISCOVER] Migration failed:', err);
    process.exitCode = 1;
  });
}
