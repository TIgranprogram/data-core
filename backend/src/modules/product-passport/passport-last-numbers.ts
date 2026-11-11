import type { Connection, Model } from 'mongoose';
import type { ProductPassportDocument } from './product-passport.schema';

export type FirmLast = { orgId: string; name: string; last: number | null; count: number };

/**
 * C072: последний № паспорта по каждой нашей фирме (аннулированные считаются — номер занят; черновики без номера нет).
 * Ряд общий; «по фирмам» — только показ. Нет паспортов у фирмы — `last: null`, `count: 0`.
 */
export async function lastByFirm(model: Model<ProductPassportDocument>, connection: Connection): Promise<FirmLast[]> {
  const [orgs, rows] = await Promise.all([
    connection.collection('organizations').find({ isOurCompany: true, deletedAt: null }, { projection: { name: 1, shortName: 1 } }).sort({ name: 1 }).toArray(),
    model.aggregate([
      { $match: { deletedAt: null, supplierOrgId: { $ne: null } } },
      { $project: { supplierOrgId: 1, n: { $convert: { input: '$passportNumber', to: 'int', onError: null, onNull: null } } } },
      { $match: { n: { $ne: null } } },
      { $group: { _id: '$supplierOrgId', last: { $max: '$n' }, count: { $sum: 1 } } },
    ]).exec(),
  ]);
  const by = new Map(rows.map((r) => [String(r._id), r as { last: number; count: number }]));
  return orgs.map((o) => {
    const r = by.get(String(o._id));
    return { orgId: String(o._id), name: String(o.shortName || o.name || ''), last: r ? r.last : null, count: r ? r.count : 0 };
  });
}
