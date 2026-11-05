import { BadRequestException, HttpException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { promises as fs } from 'fs';
import { Connection, Model, Types } from 'mongoose';
import * as path from 'path';
import { Product, ProductDocument } from '../../common/catalog/product.schema';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UPLOAD_DIR } from '../photos/image-upload.options';
import { capacityError } from './attachment-capacity';
import { HEAD_BYTES, MSG_SIGNATURE, extOf, signatureOk } from './attachment-formats';
import { ATTACHMENTS_DIR, isObjectIdStr, resolveInside } from './attachment-paths';
import { DownloadTickets } from './download-tickets';
import { ProductAttachment, ProductAttachmentDocument } from './productattachment.schema';

export const TYPES_DICT = 'attachmentTypes';
/** Виды по умолчанию: заводятся один раз, если справочник пуст; дальше правит пользователь. */
export const DEFAULT_TYPES = ['Чертежи', 'Паспорта', 'Договоры / КП', '3D-модели'];

export interface UploadedAttachmentFile { path: string; originalname: string; size: number; mimetype?: string }

@Injectable()
export class ProductAttachmentsService implements OnModuleInit {
  private readonly log = new Logger('ProductAttachments');
  private readonly tickets = new DownloadTickets();

  constructor(
    @InjectModel(ProductAttachment.name) private readonly model: Model<ProductAttachmentDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private get types() { return this.connection.db!.collection('dict_values'); }

  async onModuleInit() {
    try {
      if (await this.types.countDocuments({ dict: TYPES_DICT }, { limit: 1 })) return;
      const now = new Date();
      await this.types.insertMany(DEFAULT_TYPES.map((name, i) => ({ dict: TYPES_DICT, name, order: String(i + 1), deletedAt: null, createdAt: now, updatedAt: now })));
    } catch (e) {
      this.log.warn(`Виды вложений по умолчанию не заведены: ${(e as Error).message}`);
    }
  }

  /** Изделие и вид существуют; возвращает название вида. 404/400 по-русски. */
  async assertTarget(productId: string, typeId: string): Promise<string> {
    if (!isObjectIdStr(productId)) throw new NotFoundException('Изделие не найдено.');
    if (!isObjectIdStr(typeId)) throw new BadRequestException('Выберите вид вложения.');
    const [product, type] = await Promise.all([
      this.products.exists({ _id: new Types.ObjectId(productId) }),
      this.types.findOne({ _id: new Types.ObjectId(typeId), dict: TYPES_DICT, deletedAt: null }),
    ]);
    if (!product) throw new NotFoundException('Изделие не найдено.');
    if (!type) throw new BadRequestException('Такого вида вложений нет — выберите из списка.');
    return String(type.name ?? '');
  }

  /** До приёма файла: изделие, вид, место на диске. `incoming` — Content-Length запроса (0, если неизвестен). */
  async preflight(productId: string, typeId: string, incoming: number): Promise<void> {
    await this.assertTarget(productId, typeId);
    const root = path.resolve(UPLOAD_DIR);
    await fs.mkdir(root, { recursive: true });
    const [st, used] = await Promise.all([fs.statfs(root), this.usedBytes()]);
    const err = capacityError(used, Number(st.bavail) * Number(st.bsize), incoming);
    if (err) throw new HttpException(err, 507);
  }

  /** Сколько занимают файлы вложений (включая убранные, пока файл не стёрт). */
  async usedBytes(): Promise<number> {
    const r = await this.model.aggregate([{ $group: { _id: null, n: { $sum: '$size' } } }]);
    return Number(r[0]?.n ?? 0);
  }

  /** Файл уже на диске (multer): проверить содержимое и записать. Не прошёл — файл стирается, 400. */
  async save(file: UploadedAttachmentFile | undefined, productId: string, typeId: string, user: AuthenticatedUser) {
    if (!file) throw new BadRequestException('Файл не получен (поле формы — «file»).');
    const typeName = await this.assertTarget(productId, typeId).catch(async (e) => { await fs.rm(file.path, { force: true }); throw e; });
    const ext = extOf(path.basename(file.path));
    const rel = path.relative(path.resolve(UPLOAD_DIR), path.resolve(file.path)).split(path.sep).join('/');
    if (!rel.startsWith(`${ATTACHMENTS_DIR}/${productId.toLowerCase()}/${typeId.toLowerCase()}/`)) {
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
      productId: new Types.ObjectId(productId), typeId: new Types.ObjectId(typeId),
      originalName: file.originalname, storedPath: rel, size: file.size, mime: file.mimetype, ext,
      uploadedBy: user?.id, uploadedByName: user?.username, uploadedAt: new Date(), deletedAt: null,
    }).catch(async (e) => { await fs.rm(file.path, { force: true }); throw e; });
    return this.present(doc, typeName);
  }

  async list(productId: string, includeDeleted = false) {
    if (!isObjectIdStr(productId)) throw new NotFoundException('Изделие не найдено.');
    const q: Record<string, unknown> = { productId: new Types.ObjectId(productId) };
    if (includeDeleted) q.deletedAt = { $ne: null }; // «корзина» (admin)
    const [docs, types] = await Promise.all([this.model.find(q).sort({ uploadedAt: -1 }).exec(), this.typeNames()]);
    const items = docs.map((d) => this.present(d, types.get(String(d.typeId)) ?? ''));
    return { items, total: items.length, page: 1, limit: items.length };
  }

  async remove(productId: string, id: string, user: AuthenticatedUser) {
    const doc = await this.find(productId, id);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date(), deletedBy: user?.id } });
    return this.present(doc, (await this.typeNames()).get(String(doc.typeId)) ?? '');
  }

  async restore(productId: string, id: string) {
    const doc = await this.find(productId, id, true);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: null }, $unset: { deletedBy: 1 } });
    return this.present(doc, (await this.typeNames()).get(String(doc.typeId)) ?? '');
  }

  /** Тикет на скачивание: 60 секунд, один раз. */
  async ticket(productId: string, id: string, user: AuthenticatedUser) {
    const doc = await this.find(productId, id);
    return this.tickets.issue(String(doc._id), user?.id ?? '');
  }

  /** Файл по тикету: путь на диске, размер и имя. Тикет гасится сразу. Нет файла/тикета — 404/403. */
  async fileByTicket(productId: string, id: string, ticket: string) {
    const doc = await this.find(productId, id);
    if (!this.tickets.consume(ticket, String(doc._id))) throw new HttpException('Ссылка на скачивание устарела. Нажмите «Скачать» ещё раз.', 403);
    const abs = resolveInside(UPLOAD_DIR, doc.storedPath);
    const st = await fs.stat(abs).catch(() => null);
    if (!st?.isFile()) throw new NotFoundException('Файл не найден на сервере. Сообщите администратору.');
    return { abs, size: st.size, name: doc.originalName };
  }

  private async find(productId: string, id: string, deleted = false) {
    if (!isObjectIdStr(productId) || !isObjectIdStr(id)) throw new NotFoundException('Вложение не найдено.');
    const q: Record<string, unknown> = { _id: new Types.ObjectId(id), productId: new Types.ObjectId(productId) };
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
      id: String(d._id), productId: String(d.productId), typeId: String(d.typeId), typeName,
      originalName: d.originalName, size: d.size, ext: d.ext, mime: d.mime,
      uploadedAt: d.uploadedAt, uploadedByName: d.uploadedByName ?? null, deletedAt: d.deletedAt ?? null,
    };
  }
}
