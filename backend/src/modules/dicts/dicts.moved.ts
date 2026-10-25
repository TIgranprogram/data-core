import type { mongo } from 'mongoose';

type Db = mongo.Db;

/** Сколько id переносимых записей кладём в журнал (аудит не должен раздуваться). */
export const MOVED_IDS_MAX = 500;

export type MovedLog = { ids: string[]; truncated: boolean };

/**
 * Обёртка над базой для `reassign` при объединении: перед каждым `updateMany` / `updateOne` запоминает id записей,
 * которые под него попадут (до `MOVED_IDS_MAX`). Так в журнал уходит, что именно перенесено, — вручную это не вернуть.
 */
export function trackMoved(db: Db, log: MovedLog): Db {
  const wrap = (name: string) => {
    const coll = db.collection(name);
    const remember = async (filter: unknown, limit: number) => {
      const room = MOVED_IDS_MAX - log.ids.length;
      if (room <= 0) { log.truncated = true; return; }
      const rows = await coll.find(filter as never, { projection: { _id: 1 } }).limit(Math.min(limit, room + 1)).toArray();
      if (rows.length > room) log.truncated = true;
      for (const r of rows.slice(0, room)) log.ids.push(String(r._id));
    };
    return new Proxy(coll, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target) as unknown;
        if (prop === 'updateMany') return async (f: unknown, ...a: unknown[]) => { await remember(f, MOVED_IDS_MAX + 1); return (v as (...x: unknown[]) => unknown).call(target, f, ...a); };
        if (prop === 'updateOne') return async (f: unknown, ...a: unknown[]) => { await remember(f, 1); return (v as (...x: unknown[]) => unknown).call(target, f, ...a); };
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
