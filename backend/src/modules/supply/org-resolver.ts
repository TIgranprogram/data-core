import { createHash } from 'crypto';
import { Types, type Connection } from 'mongoose';

export const normText = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Организация по названию — найти или создать (поставщик из таблицы / формы заявки, «наша компания»).
 * ИНН в схеме обязателен и уникален, а в таблицах его нет: ставится заглушка `БЕЗ-ИНН-<хэш имени>`,
 * настоящий ИНН вносится потом в CRM. Работает напрямую с коллекцией `organizations` (общая с kppdf).
 */
export class OrgResolver {
  private cache = new Map<string, Types.ObjectId>();

  constructor(private readonly connection: Connection) {}

  async resolve(name: unknown, kind: 'supplier' | 'own'): Promise<Types.ObjectId | undefined> {
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) return undefined;
    const key = `${kind}:${normText(clean)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const coll = this.connection.db!.collection('organizations');
    const re = new RegExp(`^\\s*${escapeRe(clean).replace(/ /g, '\\s+')}\\s*$`, 'i');
    const found = await coll.findOne({ deletedAt: null, $or: [{ name: re }, { shortName: re }] });
    let id: Types.ObjectId;
    if (found) {
      id = found._id as Types.ObjectId;
      // Поставщик должен попадать в список поставщиков CRM (organizations?type=supplier)
      if (kind === 'supplier' && !(found.type as string[] | undefined)?.includes('supplier')) {
        await coll.updateOne({ _id: id }, { $addToSet: { type: 'supplier' } });
      }
      if (kind === 'own' && !found.isOurCompany) await coll.updateOne({ _id: id }, { $set: { isOurCompany: true } });
    } else {
      id = new Types.ObjectId();
      const now = new Date();
      await coll.insertOne({
        _id: id,
        name: clean,
        shortName: clean,
        inn: `БЕЗ-ИНН-${createHash('md5').update(normText(clean)).digest('hex').slice(0, 8)}`,
        type: kind === 'supplier' ? ['supplier'] : [],
        isOurCompany: kind === 'own',
        source: 'data-core',
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.cache.set(key, id);
    return id;
  }
}
