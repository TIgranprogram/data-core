import { randomUUID } from 'crypto';
import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import sharp, { type Metadata } from 'sharp';
import { oid } from '../../common/list-query';
import { safeUploadPath, uploadsRoot } from '../../common/uploads/safe-path';
import type { UploadBackgroundDto } from './dto';
import { OfferBackground, type OfferBackgroundDocument } from './offer.schema';

export const BG_MAX_BYTES = 5 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg' };
export const BG_MIME = /^image\/(png|jpeg)$/;
/** A4: отношение сторон; фон другой пропорции растянется — предупреждаем. */
const A4_RATIO = 210 / 297;

/** Встроенные фоны: `backend/assets/offers/` (стр. 1 и стр. 2+). */
export function assetsDir(): string {
  const c = [join(process.cwd(), 'assets', 'offers'), join(__dirname, '..', '..', '..', 'assets', 'offers'), join(__dirname, '..', '..', '..', '..', 'assets', 'offers')];
  return c.find((p) => existsSync(join(p, 'kp-1str.png'))) ?? c[0];
}
const BUILTIN: Record<1 | 2, { id: string; name: string; file: string }> = {
  1: { id: 'builtin-1', name: 'Стандартный фон, страница 1', file: 'kp-1str.png' },
  2: { id: 'builtin-2', name: 'Стандартный фон, страницы 2+', file: 'kp-2str.png' },
};

export interface BgItem { id: string; name: string; page: number; url: string | null; isDefault: boolean; builtin: boolean }

/** Фоны КП: загруженные (`offerbackgrounds`) и встроенные; перекодирование в лёгкий JPEG с кэшем в памяти. */
@Injectable()
export class OfferBackgroundsService {
  private readonly cache = new Map<string, Buffer>();

  constructor(@InjectModel(OfferBackground.name) private readonly model: Model<OfferBackgroundDocument>) {}

  private present(b: { _id: unknown; name: string; page: number; file: string; isDefault?: boolean }): BgItem {
    return { id: String(b._id), name: b.name, page: b.page, url: b.file, isDefault: !!b.isDefault, builtin: false };
  }

  /** `{ items, total }`: загруженные + встроенные для страниц, где нет загруженного «по умолчанию». */
  async list() {
    const docs = (await this.model.find().sort({ page: 1, createdAt: 1 }).lean().exec()) as unknown as Array<Parameters<OfferBackgroundsService['present']>[0]>;
    const items = docs.map((d) => this.present(d));
    for (const p of [1, 2] as const) {
      const hasDefault = items.some((x) => x.page === p && x.isDefault);
      items.push({ id: BUILTIN[p].id, name: BUILTIN[p].name, page: p, url: null, isDefault: !hasDefault, builtin: true });
    }
    items.sort((a, b) => a.page - b.page || Number(a.builtin) - Number(b.builtin));
    return { items, total: items.length };
  }

  async upload(file: { buffer: Buffer; mimetype: string; size: number } | undefined, dto: UploadBackgroundDto) {
    if (!file) throw new BadRequestException('Выберите файл (поле «file»), PNG или JPG до 5 МБ');
    if (!BG_MIME.test(file.mimetype)) throw new BadRequestException('Фон — только PNG или JPG');
    if (file.size > BG_MAX_BYTES) throw new BadRequestException('Файл больше 5 МБ');
    let meta: Metadata;
    try { meta = await sharp(file.buffer).metadata(); } catch { throw new BadRequestException('Файл не читается как картинка'); }
    const dir = join(uploadsRoot(), 'offers');
    await fs.mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${MIME_EXT[file.mimetype]}`;
    await fs.writeFile(join(dir, name), file.buffer);
    const page = dto.page as 1 | 2;
    if (dto.isDefault) await this.model.updateMany({ page, isDefault: true }, { $set: { isDefault: false } }).exec();
    const doc = await this.model.create({ name: dto.name.trim(), page, file: `/uploads/offers/${name}`, isDefault: !!dto.isDefault });
    const ratio = meta.width && meta.height ? meta.width / meta.height : A4_RATIO;
    const warning = Math.abs(ratio / A4_RATIO - 1) > 0.02 ? 'Пропорции фона не А4 — картинка растянется на всю страницу' : null;
    return { ...this.present(doc.toObject()), warning };
  }

  async remove(id: string) {
    if (/^builtin-/.test(id)) throw new BadRequestException('Встроенный фон удалить нельзя');
    const doc = await this.model.findOneAndDelete({ _id: oid(id, 'фона') }).exec();
    if (!doc) throw new NotFoundException('Фон не найден');
    this.cache.delete(id);
    const p = safeUploadPath(doc.file);
    if (p) await fs.unlink(p).catch(() => undefined);
    return { id, deleted: true };
  }

  /** JPEG фона для страницы (1 / 2+): выбранный → «по умолчанию» → встроенный; `none` у стр. 2 — белая (null). */
  async resolve(page: 1 | 2, id?: string | null): Promise<Buffer | null> {
    if (page === 2 && id === 'none') return null;
    if (id && /^[a-f\d]{24}$/i.test(id)) {
      const b = await this.model.findById(id).lean().exec();
      if (b) { const buf = await this.jpeg(String(b._id), safeUploadPath(b.file)); if (buf) return buf; }
    }
    if (id !== `builtin-${page}`) {
      const def = await this.model.findOne({ page, isDefault: true }).lean().exec();
      if (def) { const buf = await this.jpeg(String(def._id), safeUploadPath(def.file)); if (buf) return buf; }
    }
    return this.jpeg(BUILTIN[page].id, join(assetsDir(), BUILTIN[page].file));
  }

  /** PNG 2.6 МБ → JPEG q82 не шире 1654 px (≈200 dpi): PDF остаётся лёгким. */
  private async jpeg(key: string, path: string | null): Promise<Buffer | null> {
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!path || !existsSync(path)) return null;
    try {
      const buf = await sharp(path).flatten({ background: '#ffffff' }).resize({ width: 1654, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      this.cache.set(key, buf);
      return buf;
    } catch { return null; }
  }
}
