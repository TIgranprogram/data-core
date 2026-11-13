import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { printableText, type PrintGap } from './passport-blanks';
import { has as hasNum } from './passport-pdf-v2-common';
import { InjectConnection } from '@nestjs/mongoose';
import { promises as fs } from 'fs';
import { Types, type Connection } from 'mongoose';
import sharp from 'sharp';
import { prepareDimensionImage } from './passport-dimension-image';
import { presentMaterialsSpec } from '../../common/catalog/materials-table';
import { appendTechSheet, renderTechSheetPdf, type TechSheetInput } from '../../common/print/tech-sheet-pdf';
import { techSheetRows } from '../../common/print/tech-sheet-rows';
import { ProductPassportService } from './product-passport.service';
import { isDraftNumber, isIssued } from './passport-consts';
import type { PdfOrg } from './passport-pdf';
import { zipStore } from './zip';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { filterImagesByKind, installKindOf, variantOf, type PassportVariant } from './passport-variants';
import { standardSchemes } from './passport-schemes';
import { renderPassportCoverPreview, renderPassportPdfV2, renderPassportsPdfV2, renderStandPdf, resolveStyle, type PdfImageV2, type PdfV2Style, type PdfV2Text } from './passport-pdf-v2';
import { PassportLookService } from './passport-look.service';
import { packOf, type PrintPack } from './print-pack';
import { readPrintFile } from './passport-print-file';
import { IMAGE_KIND_LABELS, imageRules } from './passport-rules';
import { readPassportImage } from './passport-image-files';

type Doc = Record<string, unknown>;
type PdfOpts = { stamp?: boolean; seal?: boolean; sign?: boolean; mode?: 'pages' | 'print'; mono?: boolean; variant?: PassportVariant };

/** Сборка PDF паспорта и пакета ZIP: читает паспорт, организацию-поставщика, картинки (TASKS ПС.6). */
/** НМ: служебная метка черновика вместо номера — в PDF не печатается (номера, талона, номера изделия у черновика нет). */
const noDraftNumber = <T extends Record<string, unknown>>(p: T): T => (isDraftNumber(p.passportNumber) ? { ...p, passportNumber: '', warrantyCode: '', productCode: '' } : p);

@Injectable()
export class PassportPdfService {
  private readonly log = new Logger(PassportPdfService.name);
  constructor(
    private readonly passports: ProductPassportService,
    private readonly looks: PassportLookService,
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
      p = make().then((value) => { if (!value) this.prepared.delete(key); return value; });
      this.prepared.set(key, p);
      if (this.prepared.size > 60) this.prepared.delete(this.prepared.keys().next().value!);
    }
    return p;
  }

  /** Файл картинки → JPEG для pdfkit (webp и прочее — через sharp, большие — уменьшаем; JPEG легче и быстрее PNG). */
  private async file(storageUrl?: string): Promise<Buffer | undefined> {
    const path = safeUploadPath(storageUrl);
    if (!path) return undefined; // ссылка не в папку загрузок — картинку пропускаем (М1)
    try {
      return await readPassportImage(storageUrl);
    } catch (e) {
      this.log.warn(`картинка ${storageUrl}: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** Печать/подпись/логотип — PNG с прозрачностью (без flatten), не больше 800 px: в PDF они ~3–5 см. */
  private async asset(storageUrl?: string): Promise<Buffer | undefined> {
    const path = safeUploadPath(storageUrl);
    if (!path) return undefined;
    return this.cached('a:' + storageUrl, async () => {
      try { return await sharp(await fs.readFile(path)).resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).png().toBuffer(); } catch { return undefined; }
    });
  }

  /** НМ: черновик — PDF с пометкой «ЧЕРНОВИК» и без номера; аннулированный — «АННУЛИРОВАН». Выпущенный — как есть. */
  private watermark(raw: Doc): string | undefined { return raw.status === 'draft' ? 'ЧЕРНОВИК' : raw.status === 'annulled' ? 'АННУЛИРОВАН' : undefined; }

  async pdf(id: string, opts: { stamp?: boolean; seal?: boolean; sign?: boolean; mode?: 'pages' | 'print'; mono?: boolean; variant?: PassportVariant; pack?: PrintPack } = {}) {
    const pack = packOf(opts.pack);
    await this.passports.syncFromProduct(id, true); // конфликт ручного текста запрещает печать устаревшего черновика
    const raw = (await this.passports.findById(id)).toObject() as unknown as Doc;
    if (pack === 'tech') {
      const tech = await this.sheetOf(raw, raw.productId);
      return { buf: await renderTechSheetPdf(tech), filename: packFileName(raw, 'tech') };
    }
    // C062: свой PDF номера. Техописание и комплект собираются как раньше — файл это паспорт, не состав.
    if (pack === 'passport') {
      const attached = await readPrintFile(raw);
      if (attached) {
        if (isIssued(raw)) await this.passports.markIssued(raw._id as Types.ObjectId);
        return attached;
      }
    }
    const p = noDraftNumber(await this.withText(raw));
    const tech = pack === 'combined' ? await this.sheetOf(p, p.productId) : null;
    const buf = await this.render(p, opts, tech);
    if (isIssued(raw)) await this.passports.markIssued(p._id as Types.ObjectId); // «PDF скачан» — только у выпущенного; одно техописание выпуск не отмечает
    return { buf, filename: packFileName(p, pack, opts.stamp) };
  }

  /** Предпросмотр по изделию: тот же рендер, «ЧЕРНОВИК», без номера; в базу ничего не пишется и «выдан» не отмечается. pack=tech — только состав, тип паспорта не нужна. */
  async preview(productId: string, opts: { mode?: 'pages' | 'print'; mono?: boolean; variant?: PassportVariant; pack?: PrintPack } = {}) {
    const pack = packOf(opts.pack);
    if (pack === 'tech') {
      const prod = await this.productDoc(productId);
      const tech = await this.sheetOf(prod, prod._id);
      return { buf: await renderTechSheetPdf(tech), filename: packFileName(prod, 'tech') };
    }
    const p = noDraftNumber(await this.passports.previewDoc(productId) as Doc);
    const tech = pack === 'combined' ? await this.sheetOf(p, productId) : null;
    const buf = await this.render(p, opts, tech);
    return { buf, filename: pack === 'combined' ? packFileName(p, 'combined') : `Предпросмотр_${fileName(p).replace(/^Паспорт_/, '')}` };
  }

  /**
   * Лист для информационного стенда A3 (БЗ-6 Э6d). Паспорт выданным не отмечается.
   */
  async stand(id: string) {
    await this.passports.syncFromProduct(id, true);
    const raw = (await this.passports.findById(id)).toObject() as unknown as Doc;
    const p = noDraftNumber(await this.withText(raw));
    const { orgIn, asset } = await this.orgOf(p);
    const buf = await renderStandPdf({ passport: p as never, org: orgIn, text: printableText(p.textSnapshot as PdfV2Text, { draft: p.status === 'draft' }), style: await this.styleOf(p), logo: await this.asset(asset('logo')) });
    return { buf, filename: standFileName(p) };
  }

  /** Пакет по фильтру списка (те же параметры, что GET /passports), не больше 200 паспортов. */
  async zip(q: Record<string, unknown>, opts: { stamp?: boolean; mode?: 'pages' | 'print' }) {
    const { items } = await this.passports.list({ ...q, page: 1, limit: 200 }, { full: true });
    const files: Array<{ name: string; data: Buffer }> = [];
    for (const raw of items as Doc[]) {
      if (!isIssued(raw)) continue; // НМ: в пакет — только выпущенные (черновики и аннулированные — нет)
      // C072: свой PDF номера кладём в архив как есть (склеивать PDF нечем); собирать вместо него с сайта нельзя
      const attached = await readPrintFile(raw).catch(() => null);
      if (attached) { files.push({ name: fileName(raw, opts.stamp), data: attached.buf }); await this.passports.markIssued(raw._id as Types.ObjectId); continue; }
      const it = await this.withText(raw).catch(() => null);
      if (!it) continue; // без категории PDF не собирается — в архив не попадает
      files.push({ name: fileName(it, opts.stamp), data: await this.render(it, opts) });
      await this.passports.markIssued(it._id as Types.ObjectId);
    }
    return zipStore(files);
  }

  private async render(p: Doc, opts: PdfOpts, tech?: TechSheetInput | null) {
    const input = await this.input(p, opts);
    if (!tech) return renderPassportPdfV2(input);
    const title = `Паспорт и техническое описание${p.name ? `: ${p.name}` : ''}`;
    return renderPassportsPdfV2([input], title, (doc) => appendTechSheet(doc, tech));
  }

  /** Изделие для техописания без паспорта. Нет или в корзине — 404. */
  private async productDoc(id: string): Promise<Doc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Изделие ${id} не найдено`);
    const prod = await this.connection.collection('products').findOne({ _id: new Types.ObjectId(id), deletedAt: null });
    if (!prod) throw new NotFoundException(`Изделие ${id} не найдено`);
    return prod as Doc;
  }

  /**
   * Техническое описание из состава. У паспорта — снимок `materialsSpec` и поля паспорта;
   * у изделия — `dimensions` / `weightKg` / `installation`. Пусто — 400.
   * Фото — главное фото изделия (2 чтения: изделие, фото).
   */
  private async sheetOf(src: Doc, productId: unknown): Promise<TechSheetInput> {
    const spec = presentMaterialsSpec(src.materialsSpec);
    const matIds = [...(spec?.rows ?? []).map((r) => r.materialId), ...(spec?.coatingIds ?? [])].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const partIds = (spec?.rows ?? []).flatMap((r) => r.partIds).filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const dv = this.connection.collection('dict_values');
    const [mats, parts] = await Promise.all([
      matIds.length ? dv.find({ dict: 'passportMaterials', _id: { $in: matIds } }, { projection: { name: 1 } }).toArray() : [],
      partIds.length ? dv.find({ dict: 'passportParts', _id: { $in: partIds } }, { projection: { name: 1 } }).toArray() : [],
    ]);
    const dm = (src.dimensions && typeof src.dimensions === 'object' ? src.dimensions : {}) as Doc;
    const num = (v: unknown) => { const n = Number(v); return n > 0 ? n : undefined; };
    const rows = techSheetRows({
      spec,
      mats: mats.map((x) => ({ id: String(x._id), name: String(x.name ?? '') })),
      parts: parts.map((x) => ({ id: String(x._id), name: String(x.name ?? '') })),
      length: num(src.length ?? dm.length),
      width: num(src.width ?? dm.width),
      height: num(src.height ?? dm.height),
      unit: String(dm.unit || 'мм'),
      weight: num(src.weight ?? src.weightKg),
      purpose: String(src.purpose ?? ''),
      installation: String(src.installationMethod ?? src.installation ?? ''),
    });
    if (!rows.length) throw new BadRequestException('Нет состава для технического описания — заполните материалы изделия');
    const title = String(src.name || 'Изделие').slice(0, 300);
    return { title, rows, photo: await this.sheetPhoto(productId) };
  }

  /** Главное фото изделия → JPEG для листа техописания. Нет фото — null, PDF без картинки. */
  private async sheetPhoto(productId: unknown): Promise<Buffer | null> {
    const id = productId instanceof Types.ObjectId ? productId : (Types.ObjectId.isValid(String(productId ?? '')) ? new Types.ObjectId(String(productId)) : null);
    if (!id) return null;
    const prod = await this.connection.collection('products').findOne({ _id: id }, { projection: { mainPhotoId: 1, photoIds: 1 } });
    const pid = (prod?.mainPhotoId ?? (Array.isArray(prod?.photoIds) ? prod.photoIds[0] : null)) as Types.ObjectId | undefined;
    if (!pid) return null;
    const ph = await this.connection.collection('photos').findOne({ _id: pid }, { projection: { storageUrl: 1 } });
    return (await this.file(ph?.storageUrl as string | undefined)) ?? null;
  }

  /** ПНЗ: один PDF со всеми выпущенными паспортами заказа (тот же рендер, подряд). Нет выпущенных — 404 от вызывающего. */
  async orderPdf(orderId: string, opts: PdfOpts = {}, only: string[] = []) {
    const all = await this.passports.issuedOfOrder(orderId);
    const orderNo = all.orderNo;
    // C104: выбранные паспорта (только выпущенные этого заказа, порядок — по позициям); пусто — все
    const want = new Set(only);
    const items = want.size ? all.items.filter((it) => want.has(String((it as Doc)._id))) : all.items;
    if (want.size && !items.length) throw new BadRequestException('Выбранные паспорта не найдены среди выпущенных паспортов этого заказа');
    const inputs = [];
    // C072: паспорт со своим PDF в общий файл не склеить — отдаём списком, экран покажет ссылки на `GET /passports/:id/pdf`
    const skipped: Array<{ id: string; passportNumber: string; name: string }> = [];
    for (const raw of items) {
      const r = raw as Doc;
      if ((r.printFile as { path?: string } | undefined)?.path) { skipped.push({ id: String(r._id), passportNumber: String(r.passportNumber ?? ''), name: String(r.name ?? '') }); continue; }
      const p = await this.withText(r).catch(() => null);
      if (p) inputs.push(await this.input(p, opts));
    }
    if (!inputs.length) {
      if (skipped.length) throw new BadRequestException({ message: `Все паспорта заказа — готовые файлы, отдельным файлом: № ${skipped.map((x) => x.passportNumber).join(', ')}`, skipped });
      throw new BadRequestException('По заказу нет выпущенных паспортов, которые можно напечатать');
    }
    for (const it of items) await this.passports.markIssued((it as Doc)._id as Types.ObjectId);
    return { skipped, buf: await renderPassportsPdfV2(inputs, `Паспорта заказа ${orderNo ?? ''}`.trim()), filename: `Паспорта_заказа_${String(orderNo ?? orderId).replace(/[\/:*?"<>|«»]/g, '').replace(/s+/g, ' ').trim()}.pdf`, count: inputs.length };
  }

  private async input(p: Doc, opts: PdfOpts) {
    // черновик/предпросмотр: рисунки изделия по видам, остальные из паспорта; выпущенный — как раньше (его images[])
    const imgs = ((await this.passports.effectiveImages(p) as unknown as Array<{ kind: string; photoId: Types.ObjectId; order?: number; caption?: string; refCode?: string }>) || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const photos = imgs.length ? await this.connection.collection('photos').find({ _id: { $in: imgs.map((i) => i.photoId) }, deletedAt: null }, { projection: { storageUrl: 1 } }).toArray() : [];
    const url = new Map(photos.map((x) => [String(x._id), x.storageUrl as string]));
    const byKind: Record<string, PdfImageV2[]> = { overview: [], dimensions: [], safety: [], mounting: [] };
    for (const i of imgs) {
      const buf = await this.file(url.get(String(i.photoId)));
      // safety (форма, v1) = safety_zone (v2): иначе зона безопасности печаталась в «Инструкции по монтажу»; без вида — общий вид
      const k = i.kind === 'safety' ? 'safety_zone' : i.kind || 'overview';
      if (buf) {
        // Габаритный PNG часто содержит поля целого листа САПР. Убираем их только в копии для PDF.
        const image = k === 'dimensions'
          ? p.status !== 'draft' && (p.textSnapshot as { drawingLayout?: number } | undefined)?.drawingLayout !== 2
            ? await sharp(buf).trim({ background: '#ffffff', threshold: 24 }).jpeg({ quality: 90 }).toBuffer().catch(() => buf)
            : await prepareDimensionImage(buf)
          : buf;
        (byKind[k] ||= []).push({ buf: image, caption: i.caption, refCode: i.refCode });
      }
    }
    // стандартные схемы узлов способа установки — по видам, где своих нет (Э9.5)
    {
      const std = standardSchemes(p as never, (await this.passports.installs()).get(String(p.installationTypeId ?? '')) ?? null);
      const sp = std.length ? await this.connection.collection('photos').find({ _id: { $in: std.map((x) => new Types.ObjectId(x.photoId)) }, deletedAt: null }, { projection: { storageUrl: 1 } }).toArray() : [];
      const su = new Map(sp.map((x) => [String(x._id), x.storageUrl as string]));
      for (const x of std) { const buf = await this.file(su.get(x.photoId)); if (buf) (byKind[x.kind] ||= []).push({ buf }); }
    }
    // вариант паспорта, категория и способ установки решают, какие рисунки печатать (passport-variants.ts)
    const ctx = { category: String(p.passportCategory ?? ''), install: installKindOf((await this.passports.installs()).get(String(p.installationTypeId ?? ''))), variant: variantOf(opts.variant) };
    const images = filterImagesByKind(byKind, ctx);
    const cat = (await this.passports.categoryRules()).get(ctx.category);
    const absent = imageRules(p, cat, ctx).required.map((kind) => kind === 'safety' ? 'safety_zone' : kind).filter((kind) => !images[kind]?.length);
    if (absent.length && p.status !== 'draft') throw new BadRequestException(`PDF не сформирован: обязательные рисунки отсутствуют или не читаются — ${absent.map((kind) => IMAGE_KIND_LABELS[kind] ?? kind).join(', ')}. Загрузите изображения заново в соответствующие поля паспорта.`);
    const { orgIn, asset } = await this.orgOf(p);
    const stamp = !!opts.stamp;
    const mode: 'pages' | 'print' = opts.mode === 'print' ? 'print' : 'pages';
    // «с печатью»: печать и подпись можно отключить по отдельности (seal / sign = false), по умолчанию — обе
    const seal = stamp && opts.seal !== false ? await this.asset(asset('seal')) : undefined;
    const signature = stamp && opts.sign !== false ? await this.asset(asset('signature')) : undefined;
    const draft = p.status === 'draft';
    // материалы — метка в description (describeProduct); конструкция — needJoints в снимке
    const gaps: PrintGap[] = [];
    if (!hasNum(p.height) && !hasNum(p.length) && !hasNum(p.width) && !hasNum(p.weight)) gaps.push('dimensions');
    if (!Object.values(images).some((list) => (list?.length ?? 0) > 0)) gaps.push('images');
    const text = printableText(p.textSnapshot as PdfV2Text, {
      variant: variantOf(opts.variant),
      certificate: p.certificate as { number?: string } | undefined,
      category: String(p.passportCategory ?? ''),
      draft,
      gaps: draft ? gaps : undefined,
    }); // выпуск: пустые фразы выпадают; черновик: «не заполнено» (passport-blanks.ts)
    return {
      watermark: this.watermark(p),
      passport: p as never,
      org: orgIn,
      text,
      images,
      missingImages: p.status === 'draft' ? absent.map((kind) => ({ kind, label: IMAGE_KIND_LABELS[kind] ?? kind })) : [],
      style: await this.styleOf(p),
      logo: await this.asset(asset('logo')),
      defectImages: await this.defectImages(text),
      moduleImages: await this.photosById(((p.modules as Array<{ photoId?: string }> | undefined) || []).map((m) => String(m.photoId || ""))),
      seal, signature, withStamp: stamp, mode, mono: !!opts.mono,
      look: await this.looks.forPdf(p.supplierOrgId),
    };
  }

  /**
   * Обложка-образец фирмы (экран «Вид паспорта»). Паспорт не создаёт и выданные не отмечает.
   * Фона нет — та же обложка, что печатается сейчас.
   */
  async previewLook(companyId: string) {
    const org = await this.looks.orgCard(companyId) as Doc;
    const assets = (org.assets as Array<{ role: string; storageUrl: string }> | undefined) || [];
    const name = String(org.shortName || org.name || 'Фирма');
    const buf = await renderPassportCoverPreview({
      passport: { passportNumber: '—', name: 'Образец паспорта', productCode: 'ОБР-1' },
      org: {
        name: String(org.name || ''),
        shortName: org.shortName ? String(org.shortName) : undefined,
        fullName: org.fullName ? String(org.fullName) : undefined,
        inn: org.inn ? String(org.inn) : undefined,
        kpp: org.kpp ? String(org.kpp) : undefined,
        phone: org.phone ? String(org.phone) : undefined,
        email: org.email ? String(org.email) : undefined,
        trademark: org.trademark ? String(org.trademark) : undefined,
      },
      text: { sections: [] },
      images: {},
      style: { categoryName: 'Образец' },
      withStamp: false,
      mode: 'pages',
      look: await this.looks.forPdf(org._id),
      logo: await this.asset(assets.find((a) => a.role === 'logo')?.storageUrl),
    });
    const safe = name.replace(/[\\/:*?"<>|«»]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return { buf, filename: `Вид паспорта ${safe || 'фирма'}.pdf` };
  }

  /**
   * Паспорт с текстом по справочникам (один вид PDF, БЗ-7 шаг 1б): текста нет, но категория есть — собрать сейчас;
   * категории нет — 400 с подсказкой.
   */
  private async withText(p: Doc): Promise<Doc> {
    if (((p.textSnapshot as { sections?: unknown[] } | undefined)?.sections ?? []).length) return p;
    if (!p.passportCategory) throw new BadRequestException('У паспорта не выбран тип паспорта — PDF собирается по нему. Тип паспорта задаётся в группе или виде изделия');
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
    const snap = p.textSnapshot as { traits?: string[]; unknownTraits?: string[] } | undefined;
    // условия пиктограмм (when) — по признакам из снимка; в старых снимках признаков нет — пиктограммы с when не выводятся
    const st = resolveStyle(styleRows as never, cat, { maxUsers: p.maxUsers as number | undefined, traits: snap?.traits ?? [], unknownTraits: snap?.unknownTraits ?? [] });
    return { ...st, categoryName: (catDoc?.name as string | undefined) || undefined };
  }

  /** Миниатюры дефектов из снимка ТО (photoId строк) → photos.storageUrl → картинка (Э6d). */
  /** C095: картинки по id фото (рисунки модулей). */
  private async photosById(raw: string[]): Promise<Record<string, Buffer>> {
    const ids = [...new Set(raw.filter((x) => /^[0-9a-f]{24}$/i.test(x)))];
    if (!ids.length) return {};
    const photos = await this.connection.collection('photos').find({ _id: { $in: ids.map((x) => new Types.ObjectId(x)) } }, { projection: { storageUrl: 1 } }).toArray();
    const out: Record<string, Buffer> = {};
    for (const ph of photos) { const buf = await this.file(ph.storageUrl as string | undefined); if (buf) out[String(ph._id)] = buf; }
    return out;
  }

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
  return `Паспорт_${p.passportNumber || 'черновик'}${name ? `_${name}` : ''}${stamp ? '' : '_без печати'}.pdf`;
}

/** Имя файла режима pack. passport — как раньше; tech и combined — свои, чтобы не путать с «ТО» (техобслуживание). */
export function packFileName(p: Doc, pack: 'passport' | 'tech' | 'combined', stamp?: boolean): string {
  if (pack === 'tech') {
    const name = String(p.name ?? '').replace(/[\\/:*?"<>|«»]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return `Техническое описание${name ? ` ${name}` : ''}.pdf`;
  }
  if (pack === 'combined') return fileName(p, stamp).replace(/^Паспорт_/, 'Паспорт_и_описание_');
  return fileName(p, stamp);
}
