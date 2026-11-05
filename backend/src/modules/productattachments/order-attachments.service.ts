import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import archiver from 'archiver';
import { promises as fs } from 'fs';
import { Connection, Types } from 'mongoose';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UPLOAD_DIR } from '../photos/image-upload.options';
import { isObjectIdStr, resolveInside } from './attachment-paths';
import { DownloadTickets } from './download-tickets';
import { TYPES_DICT } from './productattachments.service';
import { ZipSlots, skippedText, zipEntryNames, zipMaxBytes, zipPart, type ZipItem } from './order-zip';

const mb = (n: number) => (Math.round((n / 1024 ** 2) * 10) / 10).toLocaleString('ru-RU');

export interface OrderZipPlan { orderNo: string; items: ZipItem[]; missing: string[]; files: number; bytes: number }

/** ZIP вложений по заказу: заказ → позиции (`incomes`) → изделия → `productattachments`. Архив без сжатия, потоком. */
@Injectable()
export class OrderAttachmentsService {
  private readonly tickets = new DownloadTickets();
  private readonly slots = new ZipSlots();

  constructor(@InjectConnection() private readonly connection: Connection) {}

  private col(name: string) { return this.connection.db!.collection(name); }

  /** Виды из строки `a,b,c` (или массива): только корректные id, без повторов; пусто — 400. */
  parseTypes(raw: string | string[] | undefined): string[] {
    const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    const ids = [...new Set(list)];
    if (!ids.length) throw new BadRequestException('Отметьте хотя бы один вид вложений.');
    if (ids.some((i) => !isObjectIdStr(i))) throw new BadRequestException('Неверный вид вложений.');
    return ids;
  }

  /** Состав архива: что войдёт, что пропадёт с диска, итог «N файлов, X МБ». */
  async plan(orderId: string, types: string[]): Promise<OrderZipPlan> {
    if (!isObjectIdStr(orderId)) throw new NotFoundException('Заказ не найден.');
    const order = await this.col('salesorders').findOne({ _id: new Types.ObjectId(orderId) }, { projection: { orderNo: 1 } });
    if (!order) throw new NotFoundException('Заказ не найден.');
    const lines = await this.col('incomes').find({ orderId: new Types.ObjectId(orderId), deletedAt: null, productId: { $ne: null }, lineType: { $ne: 'service' } }, { projection: { productId: 1 } }).toArray();
    const productIds = [...new Map(lines.map((l) => [String(l.productId), l.productId as Types.ObjectId])).values()];
    const [products, typeRows, atts] = await Promise.all([
      this.col('products').find({ _id: { $in: productIds } }, { projection: { sku: 1, name: 1 } }).toArray(),
      this.col('dict_values').find({ dict: TYPES_DICT }, { projection: { name: 1 } }).toArray(),
      this.col('productattachments').find({ productId: { $in: productIds }, typeId: { $in: types.map((t) => new Types.ObjectId(t)) }, deletedAt: null }).sort({ uploadedAt: 1 }).toArray(),
    ]);
    const label = new Map(products.map((p) => [String(p._id), [p.sku, p.name].filter(Boolean).join(' — ')]));
    const typeName = new Map(typeRows.map((t) => [String(t._id), String(t.name ?? '')]));
    const pos = new Map(productIds.map((p, i) => [String(p), i]));
    atts.sort((a, b) => (pos.get(String(a.productId)) ?? 0) - (pos.get(String(b.productId)) ?? 0));
    const items: ZipItem[] = [];
    const missing: string[] = [];
    let bytes = 0;
    for (const a of atts) {
      let abs = '';
      try { abs = resolveInside(UPLOAD_DIR, String(a.storedPath)); } catch { /* путь вне папки — как отсутствующий */ }
      const st = abs ? await fs.stat(abs).catch(() => null) : null;
      const pk = String(a.productId);
      if (!st?.isFile()) { missing.push(`${label.get(pk) ?? pk} / ${typeName.get(String(a.typeId)) ?? ''} / ${a.originalName}`); continue; }
      bytes += st.size;
      items.push({ productKey: pk, productLabel: label.get(pk) ?? pk, typeName: typeName.get(String(a.typeId)) ?? '', originalName: String(a.originalName), abs });
    }
    return { orderNo: String(order.orderNo ?? orderId), items, missing, files: items.length, bytes };
  }

  /** Итог для окна «N файлов, X МБ». */
  async summary(orderId: string, rawTypes: string | string[] | undefined) {
    const p = await this.plan(orderId, this.parseTypes(rawTypes));
    return { orderNo: p.orderNo, files: p.files, bytes: p.bytes, skipped: p.missing.length, tooBig: p.bytes > zipMaxBytes() };
  }

  /** Тикет на скачивание архива: 60 секунд, один раз. Привязан к заказу и набору видов. */
  async ticket(orderId: string, rawTypes: string | string[] | undefined, user: AuthenticatedUser) {
    const types = this.parseTypes(rawTypes);
    const p = await this.plan(orderId, types);
    if (!p.files) throw new BadRequestException('У изделий этого заказа нет вложений выбранных видов.');
    this.assertSize(p.bytes);
    const t = this.tickets.issue(this.key(orderId, types), user?.id ?? '');
    return { ...t, files: p.files, bytes: p.bytes, skipped: p.missing.length, orderNo: p.orderNo, url: `/api/salesorders/${orderId}/attachments.zip?types=${[...new Set(types)].sort().join(',')}&t=${t.ticket}` };
  }

  /** Отдать архив потоком: тикет гасится, не больше двух сборок сразу, обрыв клиента останавливает сборку. */
  async stream(orderId: string, rawTypes: string | undefined, ticket: string, res: Response) {
    const types = this.parseTypes(rawTypes);
    if (!this.tickets.consume(ticket, this.key(orderId, types))) throw new HttpException('Ссылка на скачивание устарела. Нажмите «Скачать» ещё раз.', 403);
    const release = this.slots.take();
    if (!release) throw new HttpException('Сейчас собираются другие архивы. Повторите через минуту.', 429);
    try {
      const p = await this.plan(orderId, types);
      if (!p.files) throw new BadRequestException('Файлов для архива нет.');
      this.assertSize(p.bytes);
      const names = zipEntryNames(p.orderNo, p.items);
      const fname = `${zipPart(p.orderNo, 'заказ')} — вложения.zip`;
      const ascii = fname.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
      res.set({
        'Content-Type': 'application/zip', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
      });
      const zip = archiver('zip', { store: true });
      p.items.forEach((it, i) => zip.file(it.abs, { name: names[i] })); // файлы открываются по очереди (lazystream), не все сразу
      if (p.missing.length) zip.append(skippedText(p.missing), { name: `${zipPart(p.orderNo, 'заказ')}/_ПРОПУЩЕНО.txt` });
      res.on('close', () => { zip.abort(); release(); });
      zip.on('error', () => { res.destroy(); release(); });
      zip.on('end', release);
      zip.pipe(res);
      void zip.finalize();
    } catch (e) { release(); throw e; }
  }

  private key(orderId: string, types: string[]) { return `zip:${orderId.toLowerCase()}:${[...new Set(types)].sort().join(',')}`; }

  private assertSize(bytes: number) {
    const max = zipMaxBytes();
    if (bytes > max) throw new HttpException(`Архив получается слишком большим (${mb(bytes)} МБ при пределе ${mb(max)} МБ). Отметьте меньше видов.`, 413);
  }
}
