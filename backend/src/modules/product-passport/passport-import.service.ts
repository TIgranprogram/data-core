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
import { IMPORT_KINDS, PassportImportDto, type PassportImportConfirmedDto } from './dto/passport-import.dto';
import { installKindOf } from './passport-variants';
import { DEFAULT_INSTALL } from './passport-gaps';

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

/** Третий лист Inventor — схема установки: анкеры не являются фундаментом. */
export function importInstallationKind(document: Doc, installs: Doc[]): 'foundation' | 'mounting' {
  const defaults = (document.passportDefaults ?? {}) as Doc;
  const id = document.installationTypeId ?? defaults.installationTypeId;
  const category = String(document.passportCategory ?? defaults.passportCategory ?? '');
  const install = id ? installs.find(i => String(i._id) === String(id)) : installs.find(i => i.code === DEFAULT_INSTALL[category]);
  return installKindOf(install) === 'anchor' ? 'mounting' : 'foundation';
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
    return { product, links, passports, incomes, orders, installs, token: digest({ product, links, passports, incomes, orders, installs }) };
  }

  async context(id: string) { return { contextToken: (await this.state(this.oid(id))).token }; }

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
    if (!Array.isArray(dto.images) || dto.images.length !== 3 || new Set(dto.images.map(i => i.kind)).size !== 3 || dto.images.some(i => !targetKind(i.kind))) throw new BadRequestException('Нужны три уникальных рисунка: overview, dimensions, foundation');
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
        const productInstallationKind = importInstallationKind(current.product, current.installs);
        for (const input of dto.images) {
          const kind = input.kind === 'foundation' ? productInstallationKind : input.kind;
          const sha = (await hash(input.photoId, true))!;
          const old = current.links.find(i => i.kind === kind);
          const keep = old && await hash(old.photoId) === sha;
          selected.set(kind, { photoId: keep ? old.photoId as Types.ObjectId : this.oid(input.photoId), sha });
        }
        result = { status: 'unchanged', updatedKinds: [], confirmedFields: [], issued: [], drafts: [], skipped: [], warnings: [] };
        const numbers = importNumbers(dto.confirmed);
        const productSet: Doc = {};
        for (const [key, value] of Object.entries(numbers.product)) {
          const prev = key === 'passportDefaults.foundationDepth' ? (current.product.passportDefaults as Doc | undefined)?.foundationDepth : current.product[key];
          if (!same(prev, value)) productSet[key] = value;
        }
        const productKinds = ['overview', 'dimensions', productInstallationKind];
        const changedLinks = productKinds.filter(kind => {
          const links = current.links.filter(i => i.kind === kind);
          return links.length !== 1 || String(links[0].photoId) !== String(selected.get(kind)!.photoId);
        });
        if (productInstallationKind === 'mounting' && current.links.some(i => i.kind === 'foundation')) changedLinks.push('foundation');
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
            : order?.stage === 'closed' ? 'order_closed'
            : (line?.passportSelection as { mode?: string } | undefined)?.mode === 'attachment' ? 'source_attachment' : null;
          if (reason) {
            const messages: Record<string, string> = { annulled: 'аннулирован', printFile: 'прикреплён готовый PDF', line_missing: 'позиция удалена, отменена или не найдена', order_mismatch: 'связи изделия и заказа противоречат друг другу', order_missing: 'договор удалён, отменён или не найден', order_closed: 'договор закрыт', source_attachment: 'для позиции выбран вложенный паспорт' };
            result.skipped.push({ id: pid, reason }); result.warnings.push(`Паспорт ${passport.passportNumber ?? pid}: ${messages[reason]}, оставлен без изменений`); continue;
          }
          if (!orderId) result.warnings.push(`Паспорт ${passport.passportNumber ?? pid}: без заказа`);
          const own = (passport.images ?? []) as Array<Doc>;
          const passportInstallationKind = importInstallationKind(passport, current.installs);
          const passportKinds = ['overview', 'dimensions', passportInstallationKind];
          const patch: Doc = {};
          let imageChanged = passportInstallationKind === 'mounting' && own.some(i => i.kind === 'foundation');
          const images = own.filter(i => !passportKinds.includes(String(i.kind)) && !(passportInstallationKind === 'mounting' && i.kind === 'foundation'));
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
            if (passportKinds.includes(String(old.kind)) || passportInstallationKind === 'mounting' && old.kind === 'foundation') await hash(old.photoId);
          }
          for (const [key, value] of Object.entries(numbers.passport)) if (!same(passport[key], value)) patch[key] = value;
          if (Object.keys(patch).length) changes.push({ current: passport, patch, line: line as PassportLine | undefined, order });
        }
        if (!changedLinks.length && !Object.keys(productSet).length && !changes.length) return;
        if (current.token !== dto.contextToken) throw new ConflictException('Изделие или паспорта изменились после начала отправки. Перечитайте контекст и повторите импорт');
        for (const old of current.links) if (changedLinks.includes(String(old.kind))) await hash(old.photoId);
        // Запись общей точки изделия исключает незаметное пересечение двух импортов.
        const productWrite = await db.collection('products').updateOne({ _id: productId, deletedAt: null }, { $set: { ...productSet, updatedAt: new Date() }, $inc: { __v: 1 } }, { session });
        if (!productWrite.matchedCount) throw new ConflictException('Изделие изменено или удалено');
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
            else if (change.order) {
              const claimed = await db.collection('salesorders').updateOne({ _id: change.order._id as Types.ObjectId, deletedAt: null, cancelledAt: null, stage: { $nin: ['cancelled', 'closed'] } }, { $inc: { passportGuard: 1 } }, { session });
              if (!claimed.matchedCount) throw new ConflictException('Договор закрыт или изменён');
            }
            const prepared = await this.passports.prepareImportedPassport(passport, change.patch, session);
            const set: Doc = { ...prepared, updatedAt: new Date() };
            if (isIssued(passport)) {
              const fromRevision = Number(passport.revision ?? 1);
              const keep = Object.fromEntries([...new Set([...Object.keys(prepared), 'images', 'textSnapshot', 'printSnapshot'])].map(k => [k, passport[k] ?? null]));
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
        result.status = 'applied'; result.updatedKinds = [...changedLinks]; result.confirmedFields = Object.keys(numbers.product);
      });
      return result;
    } finally { await session.endSession(); }
  }
}

