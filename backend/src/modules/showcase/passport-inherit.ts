import type { mongo, Types } from 'mongoose';
import { passportCategoryFor, type PpCat, type PpFound } from './form-values';

/** Категория паспорта, которую изделие получает от своей группы/раздела (без ручной категории изделия). */
export async function inheritedPassportCategory(db: mongo.Db, categoryId: Types.ObjectId | null | undefined): Promise<PpFound | null> {
  if (!categoryId) return null;
  const c = await db.collection('categories').findOne({ _id: categoryId }, { projection: { name: 1, parentId: 1, passportCategory: 1 } });
  if (!c) return null;
  const p = c.parentId ? await db.collection('categories').findOne({ _id: c.parentId }, { projection: { name: 1, passportCategory: 1 } }) : null;
  const cats = (await db.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1, name: 1, catalogNames: 1 } }).toArray()) as unknown as PpCat[];
  const group = p ? String(c.name) : null, type = p ? String(p.name) : String(c.name);
  return passportCategoryFor({ group, type }, cats, { group: p ? String(c.passportCategory ?? '') : '', type: String((p ?? c).passportCategory ?? '') });
}
