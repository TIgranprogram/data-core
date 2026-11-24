import { Types, type Connection } from 'mongoose';
import { offersOnlyIds } from './offers-only';

/**
 * Наши компании (`organizations.isOurCompany`): короткое имя и полное.
 * Список фирм, не правила доходов и оплат. Новые фирмы здесь не создаются.
 */
export async function ourCompanies(connection: Connection, opts: { withOffersOnly?: boolean } = {}) {
  // фирмы «только для КП» в «Деньгах» не показываем (настройка offers.onlyCompanyIds); КП берут полный список
  const hide = opts.withOffersOnly ? [] : (await offersOnlyIds(connection.db!)).map((x) => new Types.ObjectId(x));
  const docs = await connection.db!.collection('organizations').find({ deletedAt: null, isOurCompany: true, ...(hide.length ? { _id: { $nin: hide } } : {}) }, { projection: { name: 1, shortName: 1 } }).toArray();
  return docs.map((d) => ({ id: d._id as Types.ObjectId, name: String(d.shortName || d.name), full: String(d.name) }));
}
