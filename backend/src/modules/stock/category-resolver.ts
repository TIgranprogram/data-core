import { Types, type Connection } from 'mongoose';
import { normText } from '../supply/org-resolver';

const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const translit = (s: string) => s.toLowerCase().split('').map((c) => TR[c] ?? c).join('');

/**
 * Категория материала по названию — найти или создать (общая коллекция `categories`, тип `material`).
 * Новой категории нужны `slug` и уникальный `skuPrefix` (по нему CRM выдаёт внутренние коды материалов).
 */
export class CategoryResolver {
  private cache = new Map<string, Types.ObjectId>();

  constructor(private readonly connection: Connection) {}

  async resolve(name: unknown): Promise<Types.ObjectId | undefined> {
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) return undefined;
    const key = normText(clean);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const coll = this.connection.db!.collection('categories');
    const all = await coll.find({ deletedAt: null }, { projection: { name: 1, type: 1, skuPrefix: 1 } }).toArray();
    const found = all.find((c) => normText(c.name) === key && c.type === 'material') ?? all.find((c) => normText(c.name) === key);
    let id: Types.ObjectId;
    if (found) {
      id = found._id as Types.ObjectId;
    } else {
      const base = translit(clean).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
      const used = new Set((await coll.find({}, { projection: { skuPrefix: 1, slug: 1 } }).toArray()).flatMap((c) => [c.skuPrefix, c.slug]));
      const letters = translit(clean).replace(/[^a-z]/g, '').toUpperCase();
      let prefix = (letters.slice(0, 3) || 'CAT').padEnd(3, 'X');
      for (let i = 2; used.has(prefix); i++) prefix = `${letters.slice(0, 3) || 'CAT'}${i}`;
      let slug = base;
      for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
      id = new Types.ObjectId();
      const now = new Date();
      await coll.insertOne({
        _id: id, name: clean, slug, type: 'material', fullPath: clean, skuPrefix: prefix, sortOrder: 100, isActive: true,
        source: 'data-core', deletedAt: null, createdAt: now, updatedAt: now,
      });
    }
    this.cache.set(key, id);
    return id;
  }
}
