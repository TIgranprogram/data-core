import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import { join } from 'path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types, type Connection } from 'mongoose';
import sharp, { type Metadata } from 'sharp';
import { oid } from '../../common/list-query';
import { safeUploadPath, uploadsRoot } from '../../common/uploads/safe-path';
import type { UpdatePassportLookDto } from './dto/passport-look.dto';
import { assertTextRoom, boxFromMm } from './passport-look-metrics';
import { PassportLook, type PassportLookDocument } from './passport-look.schema';
import type { PdfLook } from './passport-pdf-v2-types';

export const LOOK_MAX_BYTES = 5 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg' };
export const LOOK_MIME = /^image\/(png|jpeg)$/;
/** A5 книжная: 148 / 210. */
const A5_RATIO = 148 / 210;
const SLOTS = ['cover', 'page'] as const;
export type LookSlot = (typeof SLOTS)[number];

type Side = { top?: number | null; right?: number | null; bottom?: number | null; left?: number | null };
type LookDoc = {
  companyId: Types.ObjectId;
  color?: string | null;
  coverFile?: string | null;
  pageFile?: string | null;
  coverTop?: number | null; coverRight?: number | null; coverBottom?: number | null; coverLeft?: number | null;
  pageTop?: number | null; pageRight?: number | null; pageBottom?: number | null; pageLeft?: number | null;
};

const cleanHex = (v: unknown) => {
  const s = String(v ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
};

/** Вид паспорта фирмы: одна запись на нашу компанию, картинки в uploads/passport-look. */
@Injectable()
export class PassportLookService {
  private readonly cache = new Map<string, Buffer>();

  constructor(
    @InjectModel(PassportLook.name) private readonly model: Model<PassportLookDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Карточка для экрана. Записи нет — пустые поля, не ошибка. */
  async get(companyId: string) {
    await this.our(companyId);
    const doc = await this.model.findOne({ companyId: oid(companyId, 'компании') }).lean().exec();
    return this.present(companyId, doc as LookDoc | null);
  }

  async save(companyId: string, dto: UpdatePassportLookDto) {
    const id = await this.our(companyId);
    const cur = (await this.model.findOne({ companyId: id }).lean().exec()) as LookDoc | null;
    const pick = <T>(v: T | null | undefined, was: T | null | undefined) => (v === undefined ? was ?? null : v);
    this.room('Обложка', pick(dto.coverTop, cur?.coverTop), pick(dto.coverRight, cur?.coverRight), pick(dto.coverBottom, cur?.coverBottom), pick(dto.coverLeft, cur?.coverLeft));
    this.room('Страницы', pick(dto.pageTop, cur?.pageTop), pick(dto.pageRight, cur?.pageRight), pick(dto.pageBottom, cur?.pageBottom), pick(dto.pageLeft, cur?.pageLeft));
    const set: Record<string, unknown> = {};
    for (const k of ['color', 'coverTop', 'coverRight', 'coverBottom', 'coverLeft', 'pageTop', 'pageRight', 'pageBottom', 'pageLeft'] as const) {
      if (dto[k] !== undefined) set[k] = k === 'color' ? cleanHex(dto.color) : dto[k] ?? null;
    }
    if (!Object.keys(set).length) throw new BadRequestException('Нечего сохранять');
    const doc = await this.model.findOneAndUpdate({ companyId: id }, { $set: set, $setOnInsert: { companyId: id } }, { new: true, upsert: true, lean: true }).exec();
    return this.present(companyId, doc as LookDoc);
  }

  async upload(companyId: string, slot: string, file: { buffer: Buffer; mimetype: string; size: number } | undefined) {
    const kind = this.slot(slot);
    const id = await this.our(companyId);
    if (!file?.buffer?.length) throw new BadRequestException('Выберите файл (поле «file»), PNG или JPG до 5 МБ');
    if (!LOOK_MIME.test(file.mimetype)) throw new BadRequestException('Фон — только PNG или JPG');
    if (file.size > LOOK_MAX_BYTES) throw new BadRequestException('Файл больше 5 МБ');
    let meta: Metadata;
    try { meta = await sharp(file.buffer).metadata(); } catch { throw new BadRequestException('Файл не читается как картинка'); }
    const dir = join(uploadsRoot(), 'passport-look');
    await fs.mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${MIME_EXT[file.mimetype]}`;
    await fs.writeFile(join(dir, name), file.buffer);
    const key = kind === 'cover' ? 'coverFile' : 'pageFile';
    const prev = await this.model.findOne({ companyId: id }).lean().exec() as LookDoc | null;
    const doc = await this.model.findOneAndUpdate(
      { companyId: id },
      { $set: { [key]: `/uploads/passport-look/${name}` }, $setOnInsert: { companyId: id } },
      { new: true, upsert: true, lean: true },
    ).exec() as LookDoc;
    if (prev?.[key]) await this.unlink(prev[key]);
    this.cache.delete(String(prev?.[key] ?? ''));
    const ratio = meta.width && meta.height ? meta.width / meta.height : A5_RATIO;
    const warning = Math.abs(ratio / A5_RATIO - 1) > 0.02 ? 'Пропорции не как у листа А5 — картинка растянется на всю страницу' : null;
    return { ...this.present(companyId, doc), warning };
  }

  async remove(companyId: string, slot: string) {
    const kind = this.slot(slot);
    const id = await this.our(companyId);
    const key = kind === 'cover' ? 'coverFile' : 'pageFile';
    const prev = await this.model.findOne({ companyId: id }).lean().exec() as LookDoc | null;
    if (!prev?.[key]) return this.present(companyId, prev);
    const doc = await this.model.findOneAndUpdate({ companyId: id }, { $set: { [key]: null } }, { new: true, lean: true }).exec() as LookDoc;
    await this.unlink(prev[key]);
    this.cache.delete(String(prev[key]));
    return this.present(companyId, doc);
  }

  /**
   * Для PDF. Нет картинок — undefined: цвет и отступы не трогают прежний вид.
   * JPEG уже уменьшен (≤1654 px, q82), в файл кладётся один раз на документ.
   */
  async forPdf(companyId: unknown): Promise<PdfLook | undefined> {
    if (!companyId || !Types.ObjectId.isValid(String(companyId))) return undefined;
    const doc = await this.model.findOne({ companyId: new Types.ObjectId(String(companyId)) }).lean().exec() as LookDoc | null;
    if (!doc) return undefined;
    const cover = await this.jpeg(doc.coverFile);
    const page = await this.jpeg(doc.pageFile);
    if (!cover && !page) return undefined;
    return {
      cover, page, color: cleanHex(doc.color),
      coverBox: cover ? boxFromMm(side(doc, 'cover')) : null,
      pageBox: page ? boxFromMm(side(doc, 'page')) : null,
    };
  }

  /** Наша фирма для предпросмотра обложки. Чужая — 400. */
  async orgCard(companyId: string): Promise<Record<string, unknown>> {
    return this.ourDoc(companyId);
  }

  private present(companyId: string, doc: LookDoc | null) {
    const margins = (p: 'cover' | 'page') => ({
      top: doc?.[`${p}Top`] ?? null, right: doc?.[`${p}Right`] ?? null, bottom: doc?.[`${p}Bottom`] ?? null, left: doc?.[`${p}Left`] ?? null,
    });
    return {
      companyId,
      color: cleanHex(doc?.color),
      cover: doc?.coverFile ? { url: doc.coverFile } : null,
      page: doc?.pageFile ? { url: doc.pageFile } : null,
      margins: { cover: margins('cover'), page: margins('page') },
    };
  }

  private slot(slot: string): LookSlot {
    if (slot !== 'cover' && slot !== 'page') throw new BadRequestException('Фон — «обложка» или «страница»');
    return slot;
  }

  private room(what: string, top?: number | null, right?: number | null, bottom?: number | null, left?: number | null) {
    try { assertTextRoom(top ?? null, right ?? null, bottom ?? null, left ?? null, what); }
    catch (e) { throw new BadRequestException((e as Error).message); }
  }

  private async our(companyId: string) {
    await this.ourDoc(companyId);
    return oid(companyId, 'компании');
  }

  private async ourDoc(companyId: string) {
    const id = oid(companyId, 'компании');
    const org = await this.connection.collection('organizations').findOne({ _id: id, deletedAt: null });
    if (!org) throw new NotFoundException('Компания не найдена');
    if (org.isOurCompany !== true) throw new BadRequestException('Вид паспорта задаётся только у нашей компании');
    return org;
  }

  private async unlink(url?: string | null) {
    const p = safeUploadPath(url);
    if (p) await fs.unlink(p).catch(() => undefined);
  }

  /** PNG → JPEG q82 не шире 1654 px, чтобы PDF не раздувался. Битый или пропавший файл — без фона. */
  private async jpeg(url?: string | null): Promise<Buffer | null> {
    if (!url) return null;
    const hit = this.cache.get(url);
    if (hit) return hit;
    const path = safeUploadPath(url);
    if (!path || !existsSync(path)) return null;
    try {
      const buf = await sharp(path).rotate().flatten({ background: '#ffffff' }).resize({ width: 1654, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      this.cache.set(url, buf);
      return buf;
    } catch { return null; }
  }
}

function side(doc: LookDoc, p: 'cover' | 'page'): Side {
  return { top: doc[`${p}Top`], right: doc[`${p}Right`], bottom: doc[`${p}Bottom`], left: doc[`${p}Left`] };
}
