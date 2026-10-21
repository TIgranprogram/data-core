import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { Connection, Types } from 'mongoose';
import sharp from 'sharp';
import { ProductPassportService } from './product-passport.service';
import { renderPassportPdf, type PdfImage, type PdfOrg } from './passport-pdf';
import { zipStore } from './zip';

const uploadDir = () => process.env.UPLOAD_DIR ?? './uploads';
type Doc = Record<string, unknown>;

/** Сборка PDF паспорта и пакета ZIP: читает паспорт, организацию-поставщика, картинки (TASKS ПС.6). */
@Injectable()
export class PassportPdfService {
  private readonly log = new Logger(PassportPdfService.name);
  constructor(
    private readonly passports: ProductPassportService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Файл картинки → PNG/JPEG для pdfkit (webp и прочее — через sharp, большие — уменьшаем). */
  private async file(storageUrl?: string): Promise<Buffer | undefined> {
    if (!storageUrl?.startsWith('/uploads/')) return undefined;
    try {
      const raw = await fs.readFile(join(uploadDir(), storageUrl.slice('/uploads/'.length)));
      return await sharp(raw).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).png().toBuffer();
    } catch (e) {
      this.log.warn(`картинка ${storageUrl}: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** Печать/подпись — с прозрачностью (без flatten). */
  private async asset(storageUrl?: string): Promise<Buffer | undefined> {
    if (!storageUrl?.startsWith('/uploads/')) return undefined;
    try { return await sharp(await fs.readFile(join(uploadDir(), storageUrl.slice('/uploads/'.length)))).png().toBuffer(); } catch { return undefined; }
  }

  async pdf(id: string, opts: { stamp?: boolean; mode?: 'pages' | 'print' } = {}) {
    const p = (await this.passports.findById(id)).toObject() as unknown as Doc;
    const buf = await this.render(p, opts);
    await this.passports.markIssued(p._id as Types.ObjectId);
    return { buf, filename: fileName(p, opts.stamp) };
  }

  /** Пакет по фильтру списка (те же параметры, что GET /passports), не больше 200 паспортов. */
  async zip(q: Record<string, unknown>, opts: { stamp?: boolean; mode?: 'pages' | 'print' }) {
    const { items } = await this.passports.list({ ...q, page: 1, limit: 200 });
    const files: Array<{ name: string; data: Buffer }> = [];
    for (const it of items as Doc[]) {
      files.push({ name: fileName(it, opts.stamp), data: await this.render(it, opts) });
      await this.passports.markIssued(it._id as Types.ObjectId);
    }
    return zipStore(files);
  }

  private async render(p: Doc, opts: { stamp?: boolean; mode?: 'pages' | 'print' }) {
    const imgs = ((p.images as Array<{ kind: string; photoId: Types.ObjectId; order?: number; caption?: string }>) || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const photos = imgs.length ? await this.connection.collection('photos').find({ _id: { $in: imgs.map((i) => i.photoId) } }, { projection: { storageUrl: 1 } }).toArray() : [];
    const url = new Map(photos.map((x) => [String(x._id), x.storageUrl as string]));
    const byKind: Record<string, PdfImage[]> = { overview: [], dimensions: [], safety: [], mounting: [] };
    for (const i of imgs) { const buf = await this.file(url.get(String(i.photoId))); if (buf) byKind[i.kind]?.push({ buf, caption: i.caption }); }
    const org = p.supplierOrgId ? await this.connection.collection('organizations').findOne({ _id: p.supplierOrgId as Types.ObjectId }) : null;
    const asset = (role: string) => ((org?.assets as Array<{ role: string; storageUrl: string }>) || []).find((a) => a.role === role)?.storageUrl;
    const stamp = !!opts.stamp;
    return renderPassportPdf({
      passport: p as never,
      org: (org as PdfOrg | null) ?? (p.supplier ? { name: String(p.supplier) } : null),
      template: await this.passports.template(),
      images: { overview: byKind.overview[0], dimensions: byKind.dimensions, safety: byKind.safety, mounting: byKind.mounting },
      seal: stamp ? await this.asset(asset('seal')) : undefined,
      signature: stamp ? await this.asset(asset('signature')) : undefined,
      withStamp: stamp,
      mode: opts.mode === 'print' ? 'print' : 'pages',
    });
  }
}

/** «Паспорт_549_Стойка баскетбольная….pdf» (без запрещённых в именах файлов знаков). */
export function fileName(p: Doc, stamp?: boolean): string {
  const name = String(p.name ?? '').replace(/[\\/:*?"<>|«»]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `Паспорт_${p.passportNumber ?? ''}${name ? `_${name}` : ''}${stamp ? '' : '_без печати'}.pdf`;
}
