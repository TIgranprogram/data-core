import { Types, type Connection } from 'mongoose';

type Db = NonNullable<Connection['db']>;

/** Ключ настройки: наши фирмы «только для КП» (например, «Приват-деал») — в «Деньгах» их нет. Не поле `organizations` (общая с CRM). */
export const OFFERS_ONLY_KEY = 'offers.onlyCompanyIds';

/** id фирм «только для КП» (строки); нет настройки — пусто. */
export async function offersOnlyIds(db: Db): Promise<string[]> {
  const s = await db.collection('settings').findOne({ key: OFFERS_ONLY_KEY }, { projection: { value: 1 } });
  return Array.isArray(s?.value) ? (s!.value as unknown[]).map(String).filter((x) => Types.ObjectId.isValid(x)) : [];
}

/** Записать список целиком (создаёт настройку при первом разе). */
export async function saveOffersOnlyIds(db: Db, ids: string[]): Promise<void> {
  const now = new Date();
  await db.collection('settings').updateOne(
    { key: OFFERS_ONLY_KEY },
    { $set: { value: ids, group: 'offers', description: 'Фирмы «только для КП»: в «Деньгах» не показываются', updatedAt: now, deletedAt: null }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
}
