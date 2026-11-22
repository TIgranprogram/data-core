import type { ClientSession, mongo } from 'mongoose';
import { ORDER_CASCADE_COLLECTIONS, writableCascadeRows } from '../../common/order-archive/cascade';

type Db = mongo.Db;

/** Сколько id переносимых записей кладём в журнал (аудит не должен раздуваться). */
export const MOVED_IDS_MAX = 500;

export type MovedLog = { ids: string[]; truncated: boolean; archiveSkipped?: number };

/**
 * Обёртка над базой для `reassign` при объединении: перед каждым `updateMany` / `updateOne` запоминает id записей,
 * которые под него попадут (до `MOVED_IDS_MAX`). Так в журнал уходит, что именно перенесено, — вручную это не вернуть.
 */
export function trackMoved(db: Db, log: MovedLog, session?: ClientSession): Db {
  let pending: Promise<unknown> = Promise.resolve();
  const wrap = (name: string) => {
    const coll = db.collection(name);
    const remember = async (filter: unknown, limit: number) => {
      const room = MOVED_IDS_MAX - log.ids.length;
      if (room <= 0) { log.truncated = true; return; }
      const rows = await coll.find(filter as never, { session, projection: { _id: 1 } }).limit(Math.min(limit, room + 1)).toArray();
      if (rows.length > room) log.truncated = true;
      for (const r of rows.slice(0, room)) log.ids.push(String(r._id));
    };
    return new Proxy(coll, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target) as unknown;
        if (prop === 'updateMany' || prop === 'updateOne') return (filter: mongo.Filter<mongo.Document>, update: unknown, options?: mongo.UpdateOptions) => {
          const run = async () => {
            let q = filter;
            if (session && ORDER_CASCADE_COLLECTIONS.has(name)) {
              const targets = await writableCascadeRows(db, session, name, filter);
              log.archiveSkipped = (log.archiveSkipped ?? 0) + targets.skipped;
              q = { $and: [filter, { _id: { $in: targets.ids } }] };
            }
            await remember(q, prop === 'updateOne' ? 1 : MOVED_IDS_MAX + 1);
            return (v as (...x: unknown[]) => unknown).call(target, q, update, { ...options, ...(session ? { session } : {}) });
          };
          if (!session) return run();
          // Некоторые каскады вызывают Promise.all. Внутри одной транзакции операции последовательны.
          const result = pending.then(run);
          pending = result;
          return result;
        };
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
      },
    });
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'collection') return wrap;
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
    },
  });
}
