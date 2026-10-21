import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Types, type Connection } from 'mongoose';
import type { PhotosService } from '../photos/photos.service';
import { OrgResolver, normText } from '../supply/org-resolver';

/**
 * Лист «Справочник» (2026-10-19): фото товаров и списки для подсказок.
 *  • Колонки «<Категория> фото» + «<Категория>»: в ячейке фото — =HYPERLINK("…drive…/d/<id>/view"; IMAGE(…)).
 *    Фото скачивается (файл открыт по ссылке), кладётся в photos (оригинал + превью) и привязывается к позиции
 *    склада с тем же наименованием (materials.photoIds). Повторно не качается: materials.drivePhotoIds.
 *  • Списки (Поставщики, Заказчики / Объект, Подал заявку / Ответственный, Тип счета, Услуги, Ед. изм., Категория)
 *    → settings `supply.sheetLists` (объединение, без дублей). Поставщики → organizations (без дублей, OrgResolver).
 * Значения листа читаются с valueRenderOption=FORMULA — иначе ссылка на фото не видна.
 */
export const LIST_COLUMNS: Record<string, string> = {
  'поставщики': 'suppliers',
  'заказчики': 'customers', 'объект / заказчик': 'customers',
  'подал заявку': 'people', 'ответственный / инициатор': 'people',
  'тип счета': 'invoiceTypes', 'тип счёта': 'invoiceTypes',
  'услуги': 'services',
  'ед_изм.': 'units', 'ед. изм.': 'units',
  'категория': 'categories',
};
export type SheetLists = Record<'suppliers' | 'customers' | 'people' | 'invoiceTypes' | 'services' | 'units' | 'categories', string[]>;

/** id файла Google Drive из формулы/ссылки ячейки. */
export function driveFileId(cell: unknown): string | null {
  const s = String(cell ?? '');
  const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(s);
  return m ? m[1] : null;
}

const isUrl = (s: string) => /^https?:\/\//i.test(s) || /\.(ru|com|pro|net)\/?$/i.test(s);
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Разбор листа: фото по наименованиям и списки. Чистая функция (юнит-тест). */
export function parseCatalog(values: unknown[][]) {
  const head = (values[0] ?? []).map((h) => clean(h));
  const lists: Partial<SheetLists> = {};
  const photos: Array<{ name: string; category: string; driveId: string }> = [];
  head.forEach((h, i) => {
    const key = LIST_COLUMNS[h.toLowerCase()];
    if (key) {
      const vals = values.slice(1).map((r) => clean(r?.[i])).filter((v) => v && !v.startsWith('='));
      const arr = (lists[key as keyof SheetLists] ??= []);
      for (const v of vals) if (!arr.some((x) => normText(x) === normText(v))) arr.push(v);
    }
    const pm = /^(.*\S)\s+фото$/i.exec(h);
    if (pm) {
      const nameCol = head.findIndex((x) => x.toLowerCase() === pm[1].toLowerCase());
      if (nameCol < 0) return;
      for (const r of values.slice(1)) {
        const name = clean(r?.[nameCol]); const id = driveFileId(r?.[i]);
        if (name && id) photos.push({ name, category: pm[1], driveId: id });
      }
    }
  });
  return { lists, photos };
}

type Fetch = typeof fetch;

export class SheetCatalog {
  constructor(private readonly connection: Connection, private readonly photos: PhotosService, private readonly fetchFn: Fetch, private readonly uploadDir = process.env.UPLOAD_DIR ?? './uploads') {}

  /** Скачать фото (Drive, файл открыт по ссылке). null — не картинка / нет доступа. */
  private async download(id: string): Promise<{ buf: Buffer; mime: string } | null> {
    try {
      const res = await this.fetchFn(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' });
      const mime = (res.headers.get('content-type') || '').split(';')[0];
      if (!res.ok || !mime.startsWith('image/')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length && buf.length <= 15 * 1024 * 1024 ? { buf, mime } : null;
    } catch { return null; }
  }

  /** Скачать фото с Drive и сохранить в photos (оригинал + превью). id оригинала или null. */
  private async store(p: { name: string; driveId: string }): Promise<Types.ObjectId | null> {
    const file = await this.download(p.driveId);
    if (!file) return null;
    const ext = file.mime.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
    const filename = `${randomUUID()}.${ext}`;
    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.writeFile(join(this.uploadDir, filename), file.buf);
    const up = await this.photos.upload({ filename, originalname: `${p.name.slice(0, 80)}.${ext}`, mimetype: file.mime, size: file.buf.length });
    return up.original._id as Types.ObjectId;
  }

  async sync(values: unknown[][], maxDownloads = 200): Promise<string> {
    const { lists, photos } = parseCatalog(values);
    const db = this.connection.db!;

    // Списки → settings (объединение с тем, что уже было)
    const prev = ((await db.collection('settings').findOne({ key: 'supply.sheetLists' }))?.value ?? {}) as Partial<SheetLists>;
    const merged: Partial<SheetLists> = { ...prev };
    for (const [k, vals] of Object.entries(lists) as Array<[keyof SheetLists, string[]]>) {
      const arr = [...(merged[k] ?? [])];
      for (const v of vals) if (!arr.some((x) => normText(x) === normText(v))) arr.push(v);
      merged[k] = arr;
    }
    await db.collection('settings').updateOne({ key: 'supply.sheetLists' },
      { $set: { value: merged, group: 'supply', description: 'Списки с листа «Справочник» Google-таблиц (подсказки форм)', updatedAt: new Date(), deletedAt: null }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true });

    // Поставщики → organizations (без дублей; адреса сайтов вместо названий — пропускаем)
    const orgs = new OrgResolver(this.connection);
    const before = await db.collection('organizations').countDocuments({});
    for (const s of lists.suppliers ?? []) if (!isUrl(s)) await orgs.resolve(s, 'supplier');
    const newSuppliers = (await db.collection('organizations').countDocuments({})) - before;

    // Фото → позиции склада по наименованию
    const mats = await db.collection('materials').find({ deletedAt: null }, { projection: { name: 1, drivePhotoIds: 1, photoIds: 1, mainPhotoId: 1 } }).toArray();
    const byName = new Map(mats.map((m) => [normText(m.name), m]));
    // Позиций, которых нет на складе (бывают только в заявках), — фото к заявкам с тем же наименованием
    // (supplyrequests.photoIds / drivePhotoIds — поля вне схемы CRM, kppdf их не трогает).
    const reqs = await db.collection('supplyrequests').find({ deletedAt: null }, { projection: { title: 1, drivePhotoIds: 1 } }).toArray();
    const reqByName = new Map<string, typeof reqs>();
    for (const r of reqs) { const k = normText(r.title); if (k) (reqByName.get(k) ?? reqByName.set(k, []).get(k)!).push(r); }
    const seen = (doc: Record<string, unknown>) => ((doc.drivePhotoIds as string[] | undefined) ?? (doc.drivePhotoIds = [])) as string[];

    let added = 0, toReq = 0, had = 0, noItem = 0, failed = 0, postponed = 0;
    for (const p of photos) {
      const m = byName.get(normText(p.name));
      if (!m) {
        const all = reqByName.get(normText(p.name));
        if (!all) { noItem++; continue; }
        const rs = all.filter((r) => !seen(r).includes(p.driveId));
        if (!rs.length) { had++; continue; }
        if (added + failed >= maxDownloads) { postponed++; continue; }
        const pid = await this.store(p);
        if (!pid) { failed++; continue; }
        await db.collection('supplyrequests').updateMany({ _id: { $in: rs.map((r) => r._id) } }, { $addToSet: { photoIds: pid, drivePhotoIds: p.driveId } });
        rs.forEach((r) => seen(r).push(p.driveId));
        added++; toReq++;
        continue;
      }
      if (seen(m).includes(p.driveId)) { had++; continue; }
      if (added + failed >= maxDownloads) { postponed++; continue; } // остальное — в следующий прогон
      const pid = await this.store(p);
      if (!pid) { failed++; continue; }
      await db.collection('materials').updateOne({ _id: m._id }, { $addToSet: { photoIds: pid, drivePhotoIds: p.driveId } });
      if (!m.mainPhotoId) {
        await db.collection('materials').updateOne({ _id: m._id, $or: [{ mainPhotoId: null }, { mainPhotoId: { $exists: false } }] }, { $set: { mainPhotoId: pid } });
        m.mainPhotoId = pid;
      }
      seen(m).push(p.driveId);
      added++;
    }
    const listInfo = Object.entries(lists).map(([k, v]) => `${({ suppliers: 'поставщики', customers: 'заказчики', people: 'сотрудники', invoiceTypes: 'типы счетов', services: 'услуги', units: 'ед. изм.', categories: 'категории' } as Record<string, string>)[k] ?? k} ${v!.length}`).join(', ');
    return `Справочник: списки (${listInfo || 'нет'}), новых поставщиков ${newSuppliers}; фото: новых ${added}${toReq ? ` (к заявкам ${toReq})` : ''}, уже есть ${had}` +
      (noItem ? `, нет ни на складе, ни в заявках ${noItem}` : '') + (failed ? `, не скачалось ${failed}` : '') + (postponed ? `, отложено до следующего прогона ${postponed}` : '');
  }
}
