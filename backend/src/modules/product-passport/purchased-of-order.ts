import { Types } from 'mongoose';
import { safeDownloadName } from '../productattachments/attachment-paths';

/** То, что нужно от базы: `collection(name).find(filter).toArray()` (подходит и `Db`, и мини-база в тестах). */
export interface DbLike { collection(name: string): { find(filter: Record<string, unknown>, opts?: Record<string, unknown>): { toArray(): Promise<Array<Record<string, any>>> } } } // eslint-disable-line @typescript-eslint/no-explicit-any

export interface PurchasedMaterial { id: string; name: string }
export interface SupplierFile { materialId: string; name: string; path: string; ext: string }

const MAX_DEPTH = 8;
const oid = (v: unknown) => (v instanceof Types.ObjectId ? v : Types.ObjectId.isValid(String(v)) ? new Types.ObjectId(String(v)) : null);
const uniq = (ids: Iterable<unknown>) => [...new Map([...ids].map(oid).filter((x): x is Types.ObjectId => !!x).map((x) => [String(x), x])).values()];

/**
 * Покупные материалы заказа (C136): строки заказа → изделия → состав (вложенные модули и изделия) → материалы с
 * `materialKind = 'purchased'`. Каждый уровень состава — один запрос с `$in` (без N+1); один материал — одна запись.
 * Строки без изделия (покупное вписано вручную) связи с материалом не имеют — в список не попадают.
 */
export async function purchasedMaterialsOfOrder(db: DbLike, orderId: string): Promise<PurchasedMaterial[]> {
  const order = oid(orderId);
  if (!order) return [];
  const lines = await db.collection('incomes').find({ orderId: order, deletedAt: null, cancelledAt: null, productId: { $ne: null } }, { projection: { productId: 1 } }).toArray();
  let products = uniq(lines.map((l) => l.productId));
  let modules: Types.ObjectId[] = [];
  const seenP = new Set(products.map(String));
  const seenM = new Set<string>();
  const materials = new Set<string>();
  for (let depth = 0; depth < MAX_DEPTH && (products.length || modules.length); depth++) {
    const [ps, ms] = await Promise.all([
      products.length ? db.collection('products').find({ _id: { $in: products } }, { projection: { composition: 1 } }).toArray() : [],
      modules.length ? db.collection('productmodules').find({ _id: { $in: modules } }, { projection: { composition: 1, materials: 1 } }).toArray() : [],
    ]);
    const nextP: Types.ObjectId[] = [];
    const nextM: Types.ObjectId[] = [];
    for (const doc of [...ps, ...ms]) {
      for (const l of (Array.isArray(doc.composition) ? doc.composition : []) as Array<{ lineType?: string; refId?: unknown }>) {
        const id = oid(l.refId);
        if (!id) continue;
        if (l.lineType === 'material') materials.add(String(id));
        else if (l.lineType === 'module' && !seenM.has(String(id))) { seenM.add(String(id)); nextM.push(id); }
        else if (l.lineType === 'product' && !seenP.has(String(id))) { seenP.add(String(id)); nextP.push(id); }
      }
      for (const m of (Array.isArray(doc.materials) ? doc.materials : []) as Array<{ materialId?: unknown }>) { const id = oid(m.materialId); if (id) materials.add(String(id)); } // старый состав модуля
    }
    products = nextP;
    modules = nextM;
  }
  if (!materials.size) return [];
  const rows = await db.collection('materials').find({ _id: { $in: uniq(materials) }, materialKind: 'purchased', deletedAt: null }, { projection: { name: 1, article: 1 } }).toArray();
  return rows.map((r) => ({ id: String(r._id), name: String(r.name ?? r.article ?? r._id) })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Действующий паспорт поставщика каждого материала — последний живой файл (один запрос на все материалы). */
export async function supplierFilesOf(db: DbLike, materials: PurchasedMaterial[]): Promise<Map<string, { path: string; ext: string }>> {
  const out = new Map<string, { path: string; ext: string }>();
  if (!materials.length) return out;
  const rows = await db.collection('productattachments').find({ materialId: { $in: uniq(materials.map((m) => m.id)) }, deletedAt: null }, {}).toArray();
  rows.sort((a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime());
  for (const r of rows) if (!out.has(String(r.materialId))) out.set(String(r.materialId), { path: String(r.storedPath), ext: String(r.ext ?? '') });
  return out;
}

/** Имена в архиве: `Поставщик_<материал>.<ext>`; совпадение у разных материалов — суффикс `_2`, `_3`. */
export function supplierEntryNames(items: Array<{ name: string; ext: string }>): string[] {
  const used = new Set<string>();
  return items.map((it) => {
    const base = `Поставщик_${safeDownloadName(it.name, 'материал')}`;
    const ext = it.ext ? `.${it.ext}` : '';
    let n = 1;
    let name = `${base}${ext}`;
    while (used.has(name.toLowerCase())) name = `${base}_${++n}${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export const missingSupplierLine = (name: string) => `нет паспорта поставщика: ${name}`;
