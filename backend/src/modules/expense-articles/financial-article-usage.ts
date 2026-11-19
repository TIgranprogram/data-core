import { Types, type Connection, type ClientSession } from 'mongoose';
export interface ArticleUsage { total: number; sources: Record<string, number> }
/** Считаются ссылки, включая историю классификации. На источник — один агрегат, не запрос на каждую статью. */
export async function financialArticleUsage(connection: Pick<Connection, 'db'>, ids: unknown[], session?: ClientSession): Promise<Map<string, ArticleUsage>> {
  const out = new Map(ids.map(id => [String(id), { total: 0, sources: {} } as ArticleUsage]));
  if (!ids.length) return out;
  const refs = ids.flatMap(id => Types.ObjectId.isValid(String(id)) ? [new Types.ObjectId(String(id)), String(id)] : [String(id)]);
  const sources: Array<[string, string, boolean?]> = [['supplyrequests',''],['expenses',''],['incomes',''],['incomes','payments',true],['incomes','legacyPaymentMetadata'],['supplyinvoicepayments','allocations',true],['supplyinvoices','paymentSnapshot.lines',true],['payroll_payments','']];
  const paths = ['articleId','classificationOriginal.articleId','classificationOverride.articleId','classificationHistory.before.articleId','classificationHistory.after.articleId'];
  const referenceProjection = (prefix: string) => {
    const p = prefix ? prefix + '.' : '';
    return { $concatArrays: [['$' + p + 'articleId', '$' + p + 'classificationOriginal.articleId', '$' + p + 'classificationOverride.articleId'],
      { $reduce: { input: { $ifNull: ['$' + p + 'classificationHistory', []] }, initialValue: [], in: { $concatArrays: ['$$value', ['$$this.before.articleId', '$$this.after.articleId']] } } }] };
  };
  const add = (rows: Array<{ _id: unknown; n: number }>, coll: string) => { for (const row of rows) { const usage = out.get(String(row._id)); if (usage) { usage.total += row.n; usage.sources[coll] = (usage.sources[coll] || 0) + row.n; } } };
  for (const [coll, host, array] of sources) {
    const prefix = host ? host + '.' : '';
    const pipeline = [{ $match: { $or: paths.map(path => ({ [prefix + path]: { $in: refs } })) } }, ...(array ? [{ $unwind: '$' + host }] : []),
      { $project: { refs: referenceProjection(host) } }, { $unwind: '$refs' }, { $match: { refs: { $in: refs } } }, { $group: { _id: '$refs', n: { $sum: 1 } } }];
    add(await connection.db!.collection(coll).aggregate(pipeline, { session }).toArray() as Array<{ _id: unknown; n: number }>, coll);
  }
  // Динамические ключи requestId остаются в Mongo: в Node приходит максимум одна строка на статью.
  add(await connection.db!.collection('supplyinvoices').aggregate([{ $match: { legacyClassifications: { $exists: true } } },
    { $project: { entries: { $objectToArray: '$legacyClassifications' } } }, { $unwind: '$entries' }, { $project: { refs: referenceProjection('entries.v') } },
    { $unwind: '$refs' }, { $match: { refs: { $in: refs } } }, { $group: { _id: '$refs', n: { $sum: 1 } } }], { session }).toArray() as Array<{ _id: unknown; n: number }>, 'supplyinvoices');
  const payroll = await connection.db!.collection('expensearticles').findOne({ _id: { $in: ids.filter(id => Types.ObjectId.isValid(String(id))).map(id => new Types.ObjectId(String(id))) }, code: 'payroll' }, { projection: { _id: 1 }, session });
  if (payroll) { const n = await connection.db!.collection('payroll_payments').countDocuments({}, { session }), use = out.get(String(payroll._id))!; use.total += n; use.sources.payroll_payments = (use.sources.payroll_payments || 0) + n; }
  return out;
}
