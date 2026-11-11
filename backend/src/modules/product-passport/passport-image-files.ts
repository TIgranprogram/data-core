import { promises as fs } from 'fs';
import { Types, type mongo } from 'mongoose';
import sharp from 'sharp';
import { safeUploadPath } from '../../common/uploads/safe-path';

const prepared = new Map<string, { signature: string; value: Promise<Buffer> }>();

/** Один способ проверки/декодирования рисунка для выпуска и PDF. Чужие пути не читаются. */
export async function readPassportImage(storageUrl?: string): Promise<Buffer | undefined> {
  const path = safeUploadPath(storageUrl);
  if (!path) return undefined;
  // stat дешевле декодирования; удалённый/заменённый файл не может остаться «готовым» из кэша.
  let stat;
  try { stat = await fs.stat(path); } catch (e) { prepared.delete(path); throw e; }
  const signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const hit = prepared.get(path);
  if (hit?.signature === signature) return hit.value;
  const entry = { signature, value: fs.readFile(path).then((raw) => sharp(raw).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer()) };
  prepared.delete(path);
  prepared.set(path, entry);
  if (prepared.size > 60) prepared.delete(prepared.keys().next().value!);
  try { return await entry.value; } catch (e) { if (prepared.get(path) === entry) prepared.delete(path); throw e; }
}

const kindOf = (kind: unknown) => kind === 'safety' ? 'safety_zone' : String(kind || 'overview');

/** Недостаточно ссылки с нужным kind: хотя бы один файл обязательного вида должен читаться. */
export async function unreadableRequiredImages(db: mongo.Db, images: Array<{ kind?: unknown; photoId?: unknown }>, required: string[]): Promise<string[]> {
  const kinds = [...new Set(required.map(kindOf))];
  if (!kinds.length) return [];
  const relevant = images.filter((i) => kinds.includes(kindOf(i.kind)));
  const ids = [...new Set(relevant.map((i) => String(i.photoId ?? '')).filter((id) => Types.ObjectId.isValid(id)))];
  const photos = ids.length ? await db.collection('photos').find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, deletedAt: null }, { projection: { storageUrl: 1 } }).toArray() : [];
  const urls = new Map(photos.map((p) => [String(p._id), String(p.storageUrl ?? '')]));
  const checked = new Map<string, Promise<boolean>>();
  const readable = (id: string) => {
    if (!checked.has(id)) checked.set(id, readPassportImage(urls.get(id)).then(Boolean).catch(() => false));
    return checked.get(id)!;
  };
  const missing: string[] = [];
  for (const kind of kinds) {
    let found = false;
    for (const image of relevant.filter((i) => kindOf(i.kind) === kind)) {
      if (await readable(String(image.photoId))) { found = true; break; }
    }
    if (!found) missing.push(kind);
  }
  return missing;
}
