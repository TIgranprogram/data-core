import { claimWritableOrders } from '../../common/order-archive/write';
import { importPassportProductFields } from '../product/product-writes';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types, type ClientSession } from 'mongoose';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import sharp from 'sharp';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { claimPassportLine, epochOf, type PassportLine } from '../../common/passport/line-source';
import { canon } from './passport-snapshot-refresh';
import { isIssued, type Doc } from './passport-consts';
import { ProductPassportService } from './product-passport.service';
import { IMPORT_KINDS, REQUIRED_IMPORT_KINDS, PassportImportDto, type PassportImportConfirmedDto, type PassportImportInstallationResponseDto } from './dto/passport-import.dto';
import { installationProfile } from './passport-variants';
import { productPassportCode } from './passport-from-product';

export interface PassportImportResult {
  status: 'applied' | 'unchanged'; updatedKinds: string[]; confirmedFields: string[];
  issued: Array<{ id: string; number: string; fromRevision: number; toRevision: number }>;
  drafts: string[]; skipped: Array<{ id: string; reason: string }>; warnings: string[];
}
const digest = (v: unknown) => createHash('sha256').update(canon(v)).digest('hex');
const same = (a: unknown, b: unknown) => canon(a ?? null) === canon(b ?? null);
const targetKind = (kind: unknown) => (IMPORT_KINDS as readonly unknown[]).includes(kind);
const CAD_KINDS = [...IMPORT_KINDS, 'mounting'];
const LIMIT = 500;

/** Legacy поле изделия имеет прежний приоритет; у экземпляра его собственный ID — снимок. */
export function importInstallationId(document: Doc): string | null {
  const value = document.installationTypeId ?? (document.passportDefaults as Doc | undefined)?.installationTypeId;
  return value == null || value === '' ? null : String(value);
}

/** В context нет нераспознанных/удалённых способов и вариантов чужой категории. */
export function importInstallations(installs: Doc[], category?: string | null): PassportImportInstallationResponseDto[] {
  return installs.flatMap(install => {
    const plan = installationProfile(install);
    const categories = String(install.categories ?? '').split(/[,;\s]+/).filter(Boolean);
    if (install.deletedAt || install.isActive === false || !plan.thirdImportKind || !Types.ObjectId.isValid(String(install._id))
      || categories.length && !categories.includes(String(category ?? ''))) return [];
    return [{ id: String(install._id), name: String(install.name || plan.code), code: plan.code, thirdImportKind: plan.thirdImportKind, depthApplicable: plan.depthApplicable }];
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id));
}

/** Третий лист Inventor — схема установки: анкеры не являются фундаментом. */
export function importInstallationKind(document: Doc, installs: Doc[]): 'foundation' | 'mounting' {
  const id = importInstallationId(document);
  const install = id ? installs.find(i => !i.deletedAt && i.isActive !== false && String(i._id) === id) : undefined;
  const plan = installationProfile(install);
  if (!plan.thirdImportKind) throw new ConflictException('Выберите способ установки в карточке изделия перед отправкой из Inventor');
  return plan.thirdImportKind;
}

/** Только одобренные числа; миллиметры паспорта совпадают с единицей изделия. */
export function importNumbers(confirmed: PassportImportConfirmedDto): { product: Doc; passport: Doc } {
  const product: Doc = {}, passport: Doc = {};
  if (confirmed.dimensions) {
    product.dimensions = { ...confirmed.dimensions };
    for (const k of ['length', 'width', 'height'] as const) passport[k] = confirmed.dimensions[k];
  }
  if (confirmed.weightKg !== undefined) { product.weightKg = confirmed.weightKg; passport.weight = confirmed.weightKg; }
  if (confirmed.foundationDepth !== undefined) { product['passportDefaults.foundationDepth'] = confirmed.foundationDepth; passport.foundationDepth = confirmed.foundationDepth; }
  return { product, passport };
}

@Injectable()
export class PassportImportService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly passports: ProductPassportService) {}

  private oid(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный идентификатор изделия или файла');
    return new Types.ObjectId(id);
  }

  private async state(productId: Types.ObjectId, session?: ClientSession) {
    const db = this.connection.db!;
    const product = await db.collection('products').findOne({ _id: productId, deletedAt: null }, { session });
    if (!product) throw new NotFoundException('Изделие не найдено');
    const links = await db.collection('productphotos').find({ productId, purpose: 'passport', kind: { $in: CAD_KINDS }, deletedAt: null }, { session }).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).limit(LIMIT + 1).toArray();
    const passports = await db.collection('productpassports').find({ productId, deletedAt: null }, { session }).sort({ _id: 1 }).limit(LIMIT + 1).toArray();
    if (links.length > LIMIT || passports.length > LIMIT) throw new BadRequestException(`Импорт поддерживает до ${LIMIT} паспортов и связей; набор превышен, изменения не внесены`);
    const ids = (values: unknown[]) => [...new Set(values.map(String))].filter(v => Types.ObjectId.isValid(v)).map(v => new Types.ObjectId(v));
    const incomes = await db.collection('incomes').find({ _id: { $in: ids(passports.map(p => p.incomeId)) } }, { session }).sort({ _id: 1 }).toArray();
    const orders = await db.collection('salesorders').find({ _id: { $in: ids([...passports.map(p => p.salesOrderId), ...incomes.map(i => i.orderId)]) } }, { session }).sort({ _id: 1 }).toArray();
    const installs = await db.collection('dict_values').find({ dict: 'passportInstall', deletedAt: null }, { session }).sort({ _id: 1 }).limit(LIMIT + 1).toArray();
    if (installs.length > LIMIT) throw new BadRequestException('Справочник способов установки превышает допустимый размер импорта');
    const category = await productPassportCode(db, product as Doc);
    return { product, links, passports, incomes, orders, installs, category, token: digest({ product, links, passports, incomes, orders, installs, category }) };
  }

  async context(id: string) {
    const current = await this.state(this.oid(id));
    return { contextToken: current.token, supportsHoles: true, supportsSupportCount: true, installationTypeId: importInstallationId(current.product), installations: importInstallations(current.installs, current.category) };
  }

  /** Общий протокол с PhotosService: запись защиты сериализуется с захватом удаления. */
  private async file(id: unknown, session: ClientSession, incoming: boolean): Promise<string | null> {
    if (!Types.ObjectId.isValid(String(id ?? ''))) {
      if (incoming) throw new BadRequestException('Некорректный файл рисунка');
      return null;
    }
    const db = this.connection.db!, _id = new Types.ObjectId(String(id));
    const photo = await db.collection('photos').findOne({ _id, ...(incoming ? { deletedAt: null } : {}) }, { session });
    if (!photo) {
      if (incoming) throw new BadRequestException(`Файл ${id} удалён или не найден`);
      return null;
    }
    const path = safeUploadPath(photo.storageUrl);
    if (!path && incoming) throw new BadRequestException('Рисунок должен быть локальным PNG');
    const aliases = await db.collection('photos').find({ storageUrl: photo.storageUrl }, { session }).toArray();
    if (aliases.some(p => p.sourceDeleting === true)) throw new ConflictException(`Файл ${id} уже удаляется`);
    const protectedFiles = await db.collection('photos').updateMany({ _id: { $in: aliases.map(p => p._id) }, sourceDeleting: { $ne: true } }, { $set: { sourceProtected: true } }, { session });
    if (protectedFiles.matchedCount !== aliases.length) throw new ConflictException(`Файл ${id} уже удаляется`);
    if (!path) return null;
    try {
      const bytes = await fs.readFile(path);
      if (incoming) {
        if (bytes.length > 30 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG');
        const image = sharp(bytes, { limitInputPixels: 40_000_000 });
        if ((await image.metadata()).format !== 'png') throw new Error('PNG');
        await image.raw().toBuffer(); // декодирование всего содержимого, не только заголовка
      }
      return createHash('sha256').update(bytes).digest('hex');
    } catch {
      if (incoming) throw new BadRequestException(`Файл ${id}: не удалось прочитать корректный PNG (до 30 МБ / 40 млн пикселей)`);
      return null;
    }
  }

  async apply(id: string, dto: PassportImportDto, actor?: { id?: string }): Promise<PassportImportResult> {
    const productId = this.oid(id);
    const kinds = new Set((Array.isArray(dto.images) ? dto.images : []).map(i => i?.kind));
    if (!Array.isArray(dto.images) || kinds.size !== dto.images.length || [...kinds].some(k => !targetKind(k))
      || REQUIRED_IMPORT_KINDS.some(k => !kinds.has(k))) throw new BadRequestException('Нужны overview, dimensions и foundation, дополнительно возможен план ям holes');
    if (dto.supportCount !== undefined && (!Number.isSafeInteger(dto.supportCount) || dto.supportCount < 1 || kinds.has('holes') !== (dto.supportCount > 1))) {
      throw new BadRequestException('Для одной опоры нужен общий лист, для нескольких — дополнительный план ям');
    }
    const single = dto.supportCount === 1;
    const session = await this.connection.startSession();
    let result!: PassportImportResult;
    try {
      await session.withTransaction(async () => {
        const db = this.connection.db!, current = await this.state(productId, session);
        const hashes = new Map<string, string | null>();
        const hash = async (photoId: unknown, incoming = false) => {
          const key = `${incoming}/${photoId}`;
          if (!hashes.has(key)) hashes.set(key, await this.file(photoId, session, incoming));
          return hashes.get(key)!;
        };
        const selected = new Map<string, { photoId: Types.ObjectId; sha: string }>();
        const requested = dto.confirmed.installationTypeId;
        if (requested !== undefined && (!Types.ObjectId.isValid(String(requested ?? '')) || typeof requested !== 'string')) {
          throw new BadRequestException('Некорректный способ установки');
        }
        const chosen = requested === undefined ? undefined : this.oid(requested).toHexString();
        if (chosen !== undefined && !importInstallations(current.installs, current.category).some(option => option.id === chosen)) {
          throw new ConflictException('Выбранный способ установки удалён, неизвестен или не применяется к типу изделия. Перечитайте контекст');
        }
        const productInstallId = chosen ?? importInstallationId(current.product);
        const productInstallationKind = importInstallationKind({ installationTypeId: productInstallId }, current.installs);
        const productPlan = installationProfile(current.installs.find(i => String(i._id) === String(productInstallId)) as Doc | undefined);
        if ((kinds.has('holes') || dto.supportCount !== undefined) && (productInstallationKind !== 'foundation' || !productPlan.allowedKinds.includes('holes'))) {
          throw new BadRequestException('План ям не применяется к выбранному способу установки');
        }
        for (const input of dto.images) {
          const kind = input.kind === 'foundation' ? productInstallationKind : input.kind;
          const sha = (await hash(input.photoId, true))!;
          const old = current.links.find(i => i.kind === kind);
          const keep = old && await hash(old.photoId) === sha;
          selected.set(kind, { photoId: keep ? old.photoId as Types.ObjectId : this.oid(input.photoId), sha });
        }
        result = { status: 'unchanged', updatedKinds: [], confirmedFields: [], issued: [], drafts: [], skipped: [], warnings: [] };
        const numbers = importNumbers(dto.confirmed);
        if (!productPlan.depthApplicable) delete numbers.product['passportDefaults.foundationDepth'];
        if (dto.confirmed.foundationDepth !== undefined && !productPlan.depthApplicable) result.warnings.push('Глубина Г не применяется к выбранному способу установки и не изменена');
        const productSet: Doc = {};
        // Старое правило с отдельной разметкой не сообщает количество опор.
        const priorHole = current.links.find(i => i.kind === 'holes');
        const changedHole = kinds.has('holes') && (!priorHole || await hash(priorHole.photoId) !== selected.get('holes')!.sha);
        const countFor = (old: unknown) => dto.supportCount ?? (kinds.has('holes') && typeof old === 'number' && (old === 1 || changedHole) ? null : old);
        const count = countFor(current.product.foundationSupportCount);
        if (count !== current.product.foundationSupportCount) productSet.foundationSupportCount = count;
        for (const [key, value] of Object.entries(numbers.product)) {
          const prev = key === 'passportDefaults.foundationDepth' ? (current.product.passportDefaults as Doc | undefined)?.foundationDepth : current.product[key];
          if (!same(prev, value)) productSet[key] = value;
        }
        if (chosen !== undefined) {
          if (String((current.product.passportDefaults as Doc | undefined)?.installationTypeId ?? '') !== chosen) productSet['passportDefaults.installationTypeId'] = this.oid(chosen);
          if (Object.prototype.hasOwnProperty.call(current.product, 'installationTypeId') && String(current.product.installationTypeId ?? '') !== chosen) productSet.installationTypeId = this.oid(chosen);
        }
        const productKinds = ['overview', 'dimensions', productInstallationKind, ...(kinds.has('holes') ? ['holes'] : [])];
        const changedLinks = productKinds.filter(kind => {
          const links = current.links.filter(i => i.kind === kind);
          return links.length !== 1 || String(links[0].photoId) !== String(selected.get(kind)!.photoId);
        });
        if (single && current.links.some(i => i.kind === 'holes')) changedLinks.push('holes');
        if (productInstallationKind === 'mounting' && current.links.some(i => i.kind === 'foundation')) changedLinks.push('foundation');
        const priorInstall = current.installs.find(i => String(i._id) === importInstallationId(current.product));
        if (chosen !== undefined && productInstallationKind === 'foundation' && installationProfile(priorInstall as Doc | undefined).thirdImportKind !== 'foundation'
          && current.links.some(i => i.kind === 'mounting')) changedLinks.push('mounting');
        const changes: Array<{ current: Doc; patch: Doc; line?: PassportLine; order?: Doc }> = [];
        for (const passport of current.passports) {
          const pid = String(passport._id);
          const line = passport.incomeId ? current.incomes.find(i => String(i._id) === String(passport.incomeId)) : undefined;
          const orderId = passport.salesOrderId ?? line?.orderId;
          const order = orderId ? current.orders.find(o => String(o._id) === String(orderId)) : undefined;
          const reason = passport.status === 'annulled' ? 'annulled' : passport.printFile ? 'printFile'
            : passport.incomeId && (!line || line.deletedAt || line.cancelledAt) ? 'line_missing'
            : line && (String(line.productId) !== String(productId) || !line.orderId || passport.salesOrderId && String(passport.salesOrderId) !== String(line.orderId)) ? 'order_mismatch'
            : orderId && (!order || order.deletedAt || order.cancelledAt || order.stage === 'cancelled') ? 'order_missing'
            : order?.activeArchiveVersion != null || order?.stage === 'closed' ? 'order_closed'
            : (line?.passportSelection as { mode?: string } | undefined)?.mode === 'attachment' ? 'source_attachment'
            : !passport.installationTypeId || !current.installs.some(i => !i.deletedAt && i.isActive !== false && String(i._id) === String(passport.installationTypeId) && installationProfile(i as Doc).thirdImportKind) ? 'installation_unknown'
            : String(passport.installationTypeId) !== productInstallId ? 'installation_mismatch' : null;
          if (reason) {
            const messages: Record<string, string> = { annulled: 'аннулирован', printFile: 'прикреплён готовый PDF', line_missing: 'позиция удалена, отменена или не найдена', order_mismatch: 'связи изделия и заказа противоречат друг другу', order_missing: 'договор удалён, отменён или не найден', order_closed: 'договор закрыт', source_attachment: 'для позиции выбран вложенный паспорт', installation_unknown: 'собственный способ установки не задан, удалён или неизвестен', installation_mismatch: 'собственный способ установки отличается от подтверждённого в Inventor' };
            result.skipped.push({ id: pid, reason }); result.warnings.push(`Паспорт ${passport.passportNumber ?? pid}: ${messages[reason]}, оставлен без изменений`); continue;
          }
          if (!orderId) result.warnings.push(`Паспорт ${passport.passportNumber ?? pid}: без заказа`);
          const own = (passport.images ?? []) as Array<Doc>;
          const passportInstallationKind = importInstallationKind(passport, current.installs);
          const passportKinds = productKinds;
          const patch: Doc = {};
          const count = countFor(passport.foundationSupportCount);
          if (count !== passport.foundationSupportCount) patch.foundationSupportCount = count;
          const obsolete = (kind: unknown) => single && kind === 'holes' || passportInstallationKind === 'mounting' && kind === 'foundation';
          let imageChanged = own.some(i => obsolete(i.kind));
          const images = own.filter(i => !passportKinds.includes(String(i.kind)) && !obsolete(i.kind));
          for (const kind of passportKinds) {
            const old = own.filter(i => i.kind === kind);
            const incoming = selected.get(kind === passportInstallationKind ? productInstallationKind : kind)!;
            const keep = old.length === 1 && await hash(old[0].photoId) === incoming.sha;
            if (!keep) imageChanged = true;
            images.push(keep ? old[0] : { ...(old[0] ?? {}), kind, photoId: incoming.photoId, order: old[0]?.order ?? passportKinds.indexOf(kind) });
          }
          if (imageChanged) patch.images = images;
          // В историю переходят все прежние managed-рисунки: не только первый,
          // использованный для дедупликации, но и дубли/legacy foundation анкеров.
          if (imageChanged) for (const old of own) {
            if (passportKinds.includes(String(old.kind)) || obsolete(old.kind)) await hash(old.photoId);
          }
          for (const [key, value] of Object.entries(numbers.passport)) if ((key !== 'foundationDepth' || installationProfile(current.installs.find(i => String(i._id) === String(passport.installationTypeId)) as Doc | undefined).depthApplicable) && !same(passport[key], value)) patch[key] = value;
          if (Object.keys(patch).length) changes.push({ current: passport, patch, line: line as PassportLine | undefined, order });
        }
        if (!changedLinks.length && !Object.keys(productSet).length && !changes.length) return;
        if (current.token !== dto.contextToken) throw new ConflictException('Изделие или паспорта изменились после начала отправки. Перечитайте контекст и повторите импорт');
        for (const old of current.links) if (changedLinks.includes(String(old.kind))) await hash(old.photoId);
        // Запись общей точки изделия исключает незаметное пересечение двух импортов.
        await claimWritableOrders(db, session, changes.map(change => change.order?._id));
        await importPassportProductFields(db, productId, productSet, session);
        for (const kind of changedLinks) {
          await db.collection('productphotos').updateMany({ productId, purpose: 'passport', kind, deletedAt: null }, { $set: { deletedAt: new Date(), updatedAt: new Date() } }, { session });
          if (!selected.has(kind)) continue; // legacy foundation у анкерного изделия только убирается из актуальных связей
          const old = current.links.find(i => i.kind === kind);
          await db.collection('productphotos').insertOne({ productId, purpose: 'passport', kind, photoId: selected.get(kind)!.photoId, isMain: false, sortOrder: old?.sortOrder ?? productKinds.indexOf(kind), ...(old?.caption ? { caption: old.caption } : {}), createdAt: new Date(), updatedAt: new Date() }, { session });
        }
        const claimedLines = new Set<string>();
        for (const change of changes) {
          const passport = change.current, pid = String(passport._id);
          try {
            if (change.line && !claimedLines.has(String(change.line._id))) {
              await claimPassportLine(db, session, change.line, epochOf(change.line), 'site');
              claimedLines.add(String(change.line._id));
            }
            const prepared = await this.passports.prepareImportedPassport(passport, change.patch, session);
            const set: Doc = { ...prepared, updatedAt: new Date() };
            if (isIssued(passport)) {
              const fromRevision = Number(passport.revision ?? 1);
              const keep = Object.fromEntries([...new Set([...Object.keys(prepared), 'installationTypeId', 'images', 'textSnapshot', 'printSnapshot'])].map(k => [k, passport[k] ?? null]));
              set.revisions = [...((passport.revisions as unknown[]) ?? []), { revision: fromRevision, at: new Date(), by: actor?.id ?? null, data: keep }];
              set.revision = fromRevision + 1;
              result.issued.push({ id: pid, number: String(passport.passportNumber ?? ''), fromRevision, toRevision: fromRevision + 1 });
            } else result.drafts.push(pid);
            const saved = await db.collection('productpassports').updateOne({ _id: passport._id as Types.ObjectId, deletedAt: null, ...(passport.updatedAt ? { updatedAt: passport.updatedAt } : { updatedAt: { $exists: false } }) }, { $set: set, $inc: { __v: 1 } }, { session });
            if (!saved.matchedCount) throw new ConflictException('Паспорт изменён другим действием');
          } catch (error) {
            if (error && typeof error === 'object' && 'hasErrorLabel' in error) throw error;
            throw new ConflictException(`Паспорт ${passport.passportNumber ?? pid}: ${error instanceof Error ? error.message : 'не удалось подготовить редакцию'}. Весь импорт отменён`);
          }
        }
        result.status = 'applied'; result.updatedKinds = [...changedLinks]; result.confirmedFields = [...Object.keys(numbers.product), ...(chosen !== undefined ? ['passportDefaults.installationTypeId'] : [])];
      });
      return result;
    } finally { await session.endSession(); }
  }
}
