import type { mongo } from 'mongoose';

/** Замена ссылки в упорядоченном списке. Если значение уже есть, оставляем первое вхождение. */
export function moveOrderedRef(path: string, from: mongo.ObjectId, to: mongo.ObjectId): mongo.Document[] {
  return [{ $set: { [path]: { $reduce: {
    input: `$${path}`, initialValue: [],
    in: { $let: { vars: { next: { $cond: [{ $eq: ['$$this', from] }, to, '$$this'] } },
      in: { $cond: [{ $in: ['$$next', '$$value'] }, '$$value', { $concatArrays: ['$$value', ['$$next']] }] } } },
  } } } }];
}
