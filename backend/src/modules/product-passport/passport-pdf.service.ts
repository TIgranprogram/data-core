import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { promises as fs } from 'fs';
import { Types, type Connection } from 'mongoose';
import sharp from 'sharp';
import { ProductPassportService } from './product-passport.service';
import type { PdfOrg } from './passport-pdf';
import { zipStore } from './zip';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { standardSchemes } from './passport-schemes';
import { renderPassportPdfV2, renderStandPdf, resolveStyle, type PdfImageV2, type PdfV2Style, type PdfV2Text } from './passport-pdf-v2';

type Doc = Record<string, unknown>;

/** Сборка PDF паспорта и пакета ZIP: читает паспорт, организацию-поставщика, картинки (TASKS ПС.6). */
@Injectable()
export class PassportPdfService {
  private readonly log = new Logger(PassportPdfService.name);
  constructor(
    private readonly passports: ProductPassportService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Подготовленные картинки — в памяти: файлы в uploads не меняются (имя — uuid), а разбор большого PNG на сервере
   * с одним ядром — секунды на каждый PDF. Не больше 60 штук, старые вытесняются.
   */
  private readonly prepared = new Map<string, Promise<Buffer | undefined>>();
  private cached(key: string, make: () => Promise<Buffer | undefined>) {
    let p = this.prepared.get(key);
    if (!p) {
      p = make();
      this.prepared.set(key, p);
      if (this.prepared.size > 60) this.prepared.delete(this.prepared.keys().next().value!);
    }
    return p;
  }

  /** Файл картинки → JPEG для pdfkit (webp и прочее — через sharp, большие — уменьшаем; JPEG легче и быстрее PNG). */
  private async file(storageUrl?: string): Promise<Buffer | undefined> {
    const path = safeUploadPath(storageUrl);
    if (!path) return undefined; // ссылка не в папку загрузок — картинку пропускаем (М1)
    return this.cached('f:' + storageUrl, async () => {
      try {
        const raw = await fs.readFile(path);
        return await sharp(raw).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
      } catch (e) {
        this.log.warn(`картинка ${storageUrl}: ${(e as Error).message}`);
        return undefined;
      }
    });
  }

  /** Печать/подпись/логотип — PNG с прозрачностью (без flatten), не больше 800 px: в PDF они ~3–5 см. */
  private async asset(storageUrl?: string): Promise<Buffer | undefined> {
    const path = safeUploadPath(storageUrl);
    if (!path) return undefined;
    return this.cached('a:' + storageUrl, async () => {
      try { return await sharp(await fs.readFile(path)).resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).png().toBuffer(); } catch { return undefined; }
    });
  }

  async pdf(id: string, opts: { stamp?: boolean; seal?: boolean; sign?: boolean; mode?: 'pages' | 'print'; mono?: boolean } = {}) {
    const p = await this.withText((await this.passports.findById(id)).toObject() as unknown as Doc);
    const buf = await this.render(p, opts);
    await this.passports.markIssued(p._id as Types.ObjectId);
    return { buf, filename: fileName(p, opts.stamp) };
  }

  /**
   * Лист для информационного стенда A3 (БЗ-6 Э6d). Паспорт выданным не отмечается.
   */
  async stand(id: string) {
    const p = await this.withText((await this.passports.findById(id)).toObject() as unknown as Doc);
    const { orgIn, asset } = await this.orgOf(p);
    const buf = await renderStandPdf({ passport: p as never, org: orgIn, text: p.textSnapshot as PdfV2Text, style: await this.styleOf(p), logo: await this.asset(asset('logo')) });
    return { buf, filename: standFileName(p) };
  }

  /** Пакет по фильтру списка (те же параметры, что GET /passports), не больше 200 паспортов. */
  async zip(q: Record<string, unknown>, opts: { stamp?: boolean; mode?: 'pages' | 'print' }) {
    const { items } = await this.passports.list({ ...q, page: 1, limit: 200 }, { full: true });
    const files: Array<{ name: string; data: Buffer }> = [];
    for (const raw of items as Doc[]) {
      const it = await this.withText(raw).catch(() => null);
      if (!it) continue; // без категории PDF не собирается — в архив не попадает
      files.push({ name: fileName(it, opts.stamp), data: await this.render(it, opts) });
      await this.passports.markIssued(it._id as Types.ObjectId);
    }
    return zipStore(files);
  }

  private async render(p: Doc, opts: { stamp?: boolean; seal?: boolean; sign?: boolean; mode?: 'pages' | 'print'; mono?: boolean }) {
    const imgs = ((p.images as Array<{ kind: string; photoId: Types.ObjectId; order?: number; caption?: string; refCode?: string }>) || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const photos = imgs.length ? await this.connection.collection('photos').find({ _id: { $in: imgs.map((i) => i.photoId) } }, { projection: { storageUrl: 1 } }).toArray() : [];
    const url = new Map(photos.map((x) => [String(x._id), x.storageUrl as string]));
    const byKind: Record<string, PdfImageV2[]> = { overview: [], dimensions: [], safety: [], mounting: [] };
    for (const i of imgs) {
      const buf = await this.file(url.get(String(i.photoId)));
      // safety (форма, v1) = safety_zone (v2): иначе зона безопасности печаталась в «Инструкции по монтажу»; без вида — общий вид
      const k = i.kind === 'safety' ? 'safety_zone' : i.kind || 'overview';
      if (buf) (byKind[k] ||= []).push({ buf, caption: i.caption, refCode: i.refCode });
    }
    // стандартные схемы узлов способа установки — по видам, где своих нет (Э9.5)
    {
      const std = standardSchemes(p as never, (await this.passports.installs()).get(String(p.installationTypeId ?? '')) ?? null);
      const sp = std.length ? await this.connection.collection('photos').find({ _id: { $in: std.map((x) => new Types.ObjectId(x.photoId)) } }, { projection: { storageUrl: 1 } }).toArray() : [];
      const su = new Map(sp.map((x) => [String(x._id), x.storageUrl as string]));
      for (const x of std) { const buf = await this.file(su.get(x.photoId)); if (buf) (byKind[x.kind] ||= []).push({ buf }); }
    }
    const { orgIn, asset } = await this.orgOf(p);
    const stamp = !!opts.stamp;
    const mode = opts.mode === 'print' ? 'print' : 'pages';
    // «с печатью»: печать и подпись можно отключить по отдельности (seal / sign = false), по умолчанию — обе
    const seal = stamp && opts.seal !== false ? await this.asset(asset('seal')) : undefined;
    const signature = stamp && opts.sign !== false ? await this.asset(asset('signature')) : undefined;
    const text = p.textSnapshot as PdfV2Text;
    return renderPassportPdfV2({
      passport: p as never,
      org: orgIn,
      text,
      images: byKind,
      style: await this.styleOf(p),
      logo: await this.asset(asset('logo')),
      defectImages: await this.defectImages(text),
      seal, signature, withStamp: stamp, mode, mono: !!opts.mono,
    });
  }

  /**
   * Паспорт с текстом по справочникам (один вид PDF, БЗ-7 шаг 1б): текста нет, но категория есть — собрать сейчас;
   * категории нет — 400 с подсказкой.
   */
  private async withText(p: Doc): Promise<Doc> {
    if (((p.textSnapshot as { sections?: unknown[] } | undefined)?.sections ?? []).length) return p;
    if (!p.passportCategory) throw new BadRequestException('У паспорта не выбрана категория — PDF собирается по ней. «Выбрать категорию» в карточке паспорта');
    const doc = await this.passports.snapshot(String(p._id));
    if (!doc) throw new BadRequestException('Текст паспорта не собрался — проверьте категорию');
    return doc.toObject() as unknown as Doc;
  }

  /** Организация-поставщик (или имя поставщика строкой) и поиск её файлов (логотип, печать, подпись) по роли. */
  private async orgOf(p: Doc) {
    const org = p.supplierOrgId ? await this.connection.collection('organizations').findOne({ _id: p.supplierOrgId as Types.ObjectId }) : null;
    const asset = (role: string) => ((org?.assets as Array<{ role: string; storageUrl: string }>) || []).find((a) => a.role === role)?.storageUrl;
    const orgIn = (org as PdfOrg | null) ?? (p.supplier ? { name: String(p.supplier) } : null);
    return { orgIn, asset };
  }

  /** Оформление v2 из справочников: цвет категории, пиктограммы правил, название категории. */
  private async styleOf(p: Doc): Promise<PdfV2Style> {
    const cat = String(p.passportCategory || '');
    const dv = this.connection.collection('dict_values');
    const [styleRows, catDoc] = await Promise.all([
      dv.find({ dict: 'passportStyle', deletedAt: null }).toArray(),
      cat ? dv.findOne({ dict: 'passportCategories', code: cat, deletedAt: null }, { projection: { name: 1 } }) : null,
    ]);
    const st = resolveStyle(styleRows as never, cat, { maxUsers: p.maxUsers as number | undefined });
    return { ...st, categoryName: (catDoc?.name as string | undefined) || undefined };
  }

  /** Миниатюры дефектов из снимка ТО (photoId строк) → photos.storageUrl → картинка (Э6d). */
  private async defectImages(text: PdfV2Text | undefined): Promise<Record<string, Buffer>> {
    const ids = [...new Set((text?.maintenance || []).flatMap((m) => (m.rows || []).map((r) => String(r.photoId || '').trim())).filter((x) => Types.ObjectId.isValid(x) && /^[0-9a-f]{24}$/i.test(x)))];
    if (!ids.length) return {};
    const photos = await this.connection.collection('photos').find({ _id: { $in: ids.map((x) => new Types.ObjectId(x)) } }, { projection: { storageUrl: 1 } }).toArray();
    const out: Record<string, Buffer> = {};
    for (const ph of photos) {
      const buf = await this.file(ph.storageUrl as string | undefined);
      if (buf) out[String(ph._id)] = buf;
    }
    return out;
  }
}

/** «Стенд_549_Стойка баскетбольная.pdf». */
export function standFileName(p: Doc): string {
  return fileName(p, true).replace(/^Паспорт_/, 'Стенд_');
}

/** «Паспорт_549_Стойка баскетбольная….pdf» (без запрещённых в именах файлов знаков). */
export function fileName(p: Doc, stamp?: boolean): string {
  const name = String(p.name ?? '').replace(/[\\/:*?"<>|«»]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `Паспорт_${p.passportNumber ?? ''}${name ? `_${name}` : ''}${stamp ? '' : '_без печати'}.pdf`;
}
