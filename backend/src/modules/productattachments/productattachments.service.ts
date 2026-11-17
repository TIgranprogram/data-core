import { BadRequestException, HttpException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { promises as fs } from 'fs';
import { Connection, Model, Types } from 'mongoose';
import * as path from 'path';
import { Product, ProductDocument } from '../../common/catalog/product.schema';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UPLOAD_DIR } from '../photos/image-upload.options';
import { capacityError } from './attachment-capacity';
import { HEAD_BYTES, MSG_SIGNATURE, extOf, signatureOk } from './attachment-formats';
import { SUPPLIER_PASSPORT_TYPE, type AttachmentOwner } from './attachment-owner';
import { ATTACHMENTS_DIR, isObjectIdStr, resolveInside } from './attachment-paths';
import { DownloadTickets } from './download-tickets';
import { ProductAttachment, ProductAttachmentDocument } from './productattachment.schema';

export const TYPES_DICT = 'attachmentTypes';
/** Виды по умолчанию: заводятся один раз, если справочник пуст; дальше правит пользователь. */
/** Через сколько дней после «Убрать» файл стирается с диска, и в какой час (местное время сервера) идёт чистка. */
export const PURGE_DAYS = 14;
const PURGE_HOUR = 3;
export const DEFAULT_TYPES = ['Чертежи', 'Паспорта', '3D-модели']; // без «Договоры / КП» — это заказ и заказчик (владелец 15.11)

export interface UploadedAttachmentFile { path: string; originalname: string; size: number; mimetype?: string }

@Injectable()
export class ProductAttachmentsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ProductAttachments');
  private readonly tickets = new DownloadTickets();
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectModel(ProductAttachment.name) private readonly model: Model<ProductAttachmentDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private get types() { return this.connection.db!.collection('dict_values'); }

  async onModuleInit() {
    // ночная чистка: раз в час проверяем время, работаем в 03:xx (повтор в тот же час безопасен)
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => { if (new Date().getHours() === PURGE_HOUR) void this.purgeDeleted().catch((e) => this.log.warn(`Чистка вложений: ${(e as Error).message}`)); }, 3600_000);
    try {
      if (!(await this.types.countDocuments({ dict: TYPES_DICT }, { limit: 1 }))) {
        const now = new Date();
        await this.types.insertMany(DEFAULT_TYPES.map((name, i) => ({ dict: TYPES_DICT, name, order: String(i + 1), deletedAt: null, createdAt: now, updatedAt: now })));
      }
      await this.supplierTypeId();
    } catch (e) {
      this.log.warn(`Виды вложений по умолчанию не заведены: ${(e as Error).message}`);
    }
  }

  /** Вид «Паспорт поставщика» (C136): есть — берём, нет — заводим (в т. ч. на проде, где справочник уже заполнен). */
  async supplierTypeId(): Promise<string> {
    const cur = await this.types.findOne({ dict: TYPES_DICT, name: SUPPLIER_PASSPORT_TYPE, deletedAt: null });
    if (cur) return String(cur._id);
    const now = new Date();
    const n = await this.types.countDocuments({ dict: TYPES_DICT });
    const r = await this.types.insertOne({ dict: TYPES_DICT, name: SUPPLIER_PASSPORT_TYPE, order: String(n + 1), deletedAt: null, createdAt: now, updatedAt: now });
    return String(r.insertedId);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Покупной материал существует (C136). Не покупной — 400: паспорт поставщика бывает только у покупных. */
  private async assertPurchased(materialId: string): Promise<boolean> {
    if (!isObjectIdStr(materialId)) throw new NotFoundException('Материал не найден.');
    const m = await this.connection.db!.collection('materials').findOne({ _id: new Types.ObjectId(materialId), deletedAt: null }, { projection: { materialKind: 1 } });
    if (!m) throw new NotFoundException('Материал не найден.');
    if (m.materialKind !== 'purchased') throw new BadRequestException('Паспорт поставщика загружается только у покупных изделий.');
    return true;
  }

  /** Изделие (или покупной материал) и вид существуют; возвращает название вида. 404/400 по-русски. */
  async assertTarget(productId: string, typeId: string, owner: AttachmentOwner = 'productId'): Promise<string> {
    if (owner === 'productId' && !isObjectIdStr(productId)) throw new NotFoundException('Изделие не найдено.');
    if (!isObjectIdStr(typeId)) throw new BadRequestException('Выберите вид вложения.');
    const [product, type] = await Promise.all([
      owner === 'materialId' ? this.assertPurchased(productId) : this.products.exists({ _id: new Types.ObjectId(productId) }),
      this.types.findOne({ _id: new Types.ObjectId(typeId), dict: TYPES_DICT, deletedAt: null }),
    ]);
    if (!product) throw new NotFoundException('Изделие не найдено.');
    if (!type) throw new BadRequestException('Такого вида вложений нет — выберите из списка.');
    return String(type.name ?? '');
  }

  /** До приёма файла: изделие, вид, место на диске. `incoming` — Content-Length запроса (0, если неизвестен). */
  async preflight(productId: string, typeId: string, incoming: number, owner: AttachmentOwner = 'productId'): Promise<void> {
    await this.assertTarget(productId, typeId, owner);
    const root = path.resolve(UPLOAD_DIR);
    await fs.mkdir(root, { recursive: true });
    const [st, used] = await Promise.all([fs.statfs(root), this.usedBytes()]);
    const err = capacityError(used, Number(st.bavail) * Number(st.bsize), incoming);
    if (err) throw new HttpException(err, 507);
  }

  /** Сколько занимают файлы вложений (включая убранные, пока файл не стёрт). */
  async usedBytes(): Promise<number> {
    const r = await this.model.aggregate([{ $match: { fileRemovedAt: null } }, { $group: { _id: null, n: { $sum: '$size' } } }]);
    return Number(r[0]?.n ?? 0);
  }

  /**
   * Ночная чистка (ВЛ-В1): файлы вложений, убранных больше `PURGE_DAYS` (14) суток назад, стираются с диска;
   * запись остаётся с `fileRemovedAt`. Возвращает число стёртых файлов. Путь только внутри папки загрузок.
   */
  async purgeDeleted(now: Date = new Date()): Promise<number> {
    const before = new Date(now.getTime() - PURGE_DAYS * 86400_000);
    const docs = await this.model.find({ deletedAt: { $ne: null, $lt: before }, fileRemovedAt: null }).limit(500).exec();
    let n = 0;
    for (const d of docs) {
      try {
        await fs.rm(resolveInside(UPLOAD_DIR, d.storedPath), { force: true });
        await this.model.updateOne({ _id: d._id }, { $set: { fileRemovedAt: now } });
        n++;
      } catch (e) { this.log.warn(`Не стёрт файл вложения ${String(d._id)}: ${(e as Error).message}`); }
    }
    if (n) this.log.log(`Стёрто файлов убранных вложений: ${n}`);
    return n;
  }

  /** Файл уже на диске (multer): проверить содержимое и записать. Не прошёл — файл стирается, 400. `incomeId` — файл позиции заказа (папка на диске — по позиции). */
  async save(file: UploadedAttachmentFile | undefined, productId: string, typeId: string, user: AuthenticatedUser, incomeId?: string, owner: AttachmentOwner = 'productId') {
    if (!file) throw new BadRequestException('Файл не получен (поле формы — «file»).');
    const typeName = await this.assertTarget(productId, typeId, owner).catch(async (e) => { await fs.rm(file.path, { force: true }); throw e; });
    const ext = extOf(path.basename(file.path));
    const rel = path.relative(path.resolve(UPLOAD_DIR), path.resolve(file.path)).split(path.sep).join('/');
    if (!rel.startsWith(`${ATTACHMENTS_DIR}/${(incomeId ?? productId).toLowerCase()}/${typeId.toLowerCase()}/`)) {
      await fs.rm(file.path, { force: true });
      throw new BadRequestException('Файл сохранён не туда. Загрузка отменена.');
    }
    const head = Buffer.alloc(HEAD_BYTES);
    const fh = await fs.open(file.path, 'r');
    let n = 0;
    try { n = (await fh.read(head, 0, HEAD_BYTES, 0)).bytesRead; } finally { await fh.close(); }
    if (!n || !signatureOk(ext, head.subarray(0, n), file.size)) {
      await fs.rm(file.path, { force: true });
      throw new BadRequestException(MSG_SIGNATURE);
    }
    const doc = await this.model.create({
      [owner]: new Types.ObjectId(productId), typeId: new Types.ObjectId(typeId), incomeId: incomeId ? new Types.ObjectId(incomeId) : null,
      originalName: file.originalname, storedPath: rel, size: file.size, mime: file.mimetype, ext,
      uploadedBy: user?.id, uploadedByName: user?.username, uploadedAt: new Date(), deletedAt: null,
    }).catch(async (e) => { await fs.rm(file.path, { force: true }); throw e; });
    // «Заменить» (C136): старый паспорт поставщика — в корзину, действует последний
    if (owner === 'materialId') await this.model.updateMany({ materialId: doc.materialId, typeId: doc.typeId, deletedAt: null, _id: { $ne: doc._id } }, { $set: { deletedAt: new Date(), deletedBy: user?.id } });
    return this.present(doc, typeName);
  }

  /**
   * Файлы изделия — все, в т. ч. загруженные через позицию заказа (решение владельца 15.11: чертежи, 3D, паспорта относятся
   * к изделию, а не к одной позиции). `incomeId` у файла — только «откуда загружен» (scope 'line'); второй аргумент оставлен для вызовов позиции.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async list(productId: string, includeDeleted = false, _incomeId?: string, owner: AttachmentOwner = 'productId') {
    if (!isObjectIdStr(productId)) throw new NotFoundException(owner === 'materialId' ? 'Материал не найден.' : 'Изделие не найдено.');
    const q: Record<string, unknown> = { [owner]: new Types.ObjectId(productId) };
    if (owner === 'materialId') q.deletedAt = includeDeleted ? { $ne: null } : null; // паспорт поставщика: список — только живые, первый действует
    else if (includeDeleted) q.deletedAt = { $ne: null }; // «корзина» (admin)
    const [docs, types] = await Promise.all([this.model.find(q).sort({ uploadedAt: -1 }).exec(), this.typeNames()]);
    const items = docs.map((d) => this.present(d, types.get(String(d.typeId)) ?? ''));
    return { items, total: items.length, page: 1, limit: items.length };
  }

  async remove(productId: string, id: string, user: AuthenticatedUser, incomeId?: string, owner: AttachmentOwner = 'productId') {
    const doc = await this.find(productId, id, false, owner);
    if (incomeId && String(doc.incomeId ?? '') !== incomeId) throw new NotFoundException('Вложение не найдено.');
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date(), deletedBy: user?.id } });
    return this.present(doc, (await this.typeNames()).get(String(doc.typeId)) ?? '');
  }

  async restore(productId: string, id: string) {
    const doc = await this.find(productId, id, true);
    if (doc.fileRemovedAt) throw new BadRequestException(`Файл уже стёрт с сервера (прошло больше ${PURGE_DAYS} дней). Загрузите его заново.`);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: null }, $unset: { deletedBy: 1 } });
    return this.present(doc, (await this.typeNames()).get(String(doc.typeId)) ?? '');
  }

  /** Тикет на скачивание: 60 секунд, один раз. */
  async ticket(productId: string, id: string, user: AuthenticatedUser, owner: AttachmentOwner = 'productId') {
    const doc = await this.find(productId, id, false, owner);
    return this.tickets.issue(String(doc._id), user?.id ?? '');
  }

  /** Файл по тикету: путь на диске, размер и имя. Тикет гасится сразу. Нет файла/тикета — 404/403. */
  async fileByTicket(productId: string, id: string, ticket: string, owner: AttachmentOwner = 'productId') {
    const doc = await this.find(productId, id, false, owner);
    if (!this.tickets.consume(ticket, String(doc._id))) throw new HttpException('Ссылка на скачивание устарела. Нажмите «Скачать» ещё раз.', 403);
    const abs = resolveInside(UPLOAD_DIR, doc.storedPath);
    const st = await fs.stat(abs).catch(() => null);
    if (!st?.isFile()) throw new NotFoundException('Файл не найден на сервере. Сообщите администратору.');
    return { abs, size: st.size, name: doc.originalName };
  }

  private async find(productId: string, id: string, deleted = false, owner: AttachmentOwner = 'productId') {
    if (!isObjectIdStr(productId) || !isObjectIdStr(id)) throw new NotFoundException('Вложение не найдено.');
    const q: Record<string, unknown> = { _id: new Types.ObjectId(id), [owner]: new Types.ObjectId(productId) };
    if (deleted) q.deletedAt = { $ne: null };
    const doc = await this.model.findOne(q).exec();
    if (!doc) throw new NotFoundException('Вложение не найдено.');
    return doc;
  }

  private async typeNames(): Promise<Map<string, string>> {
    const rows = await this.types.find({ dict: TYPES_DICT }).project({ name: 1 }).toArray();
    return new Map(rows.map((r) => [String(r._id), String(r.name ?? '')]));
  }

  private present(d: ProductAttachmentDocument, typeName: string) {
    return {
      id: String(d._id), productId: d.productId ? String(d.productId) : null, materialId: d.materialId ? String(d.materialId) : null, typeId: String(d.typeId), typeName,
      originalName: d.originalName, size: d.size, ext: d.ext, mime: d.mime,
      incomeId: d.incomeId ? String(d.incomeId) : null, scope: d.incomeId ? 'line' : 'product',
      uploadedAt: d.uploadedAt, uploadedByName: d.uploadedByName ?? null, deletedAt: d.deletedAt ?? null,
    };
  }
}
