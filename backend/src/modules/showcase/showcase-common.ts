import type { Connection } from 'mongoose';
import type { Types } from 'mongoose';

export type Db = NonNullable<Connection['db']>;
export type Doc = Record<string, unknown> & { _id: Types.ObjectId };
export const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const LIVE = { deletedAt: null };
/** Варианты изделия (цвета, размеры): список или строка «через запятую / с новой строки» → уникальные непустые, до 50. */
export const variants = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/)).map(clean).filter(Boolean))].slice(0, 50);

export { loadPhotos } from '../../common/photos';
