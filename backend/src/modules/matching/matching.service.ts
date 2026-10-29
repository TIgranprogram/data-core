import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { AuditService } from '../audit/audit.service';
import { aliasKey, isConfident, lineState, suggest, type MatchProduct } from './matching-rules';
import { ProductAlias, ProductAliasDocument } from './product-alias.schema';

type Doc = Record<string, unknown>;
type Pick = { lineId: string; productId: string | null };

/**
 * Сопоставление позиций договора с изделиями (КМ2–КМ3): подбор, подтверждение, «не изделие», пачкой.
 * Пишет только `incomes.productId/matchStatus/matchedAt/matchedBy` (необязательные поля) и `productaliases`.
 */
@Injectable()
export class MatchingService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ProductAlias.name) private readonly aliases: Model<ProductAliasDocument>,
    private readonly audit: AuditService,
  ) {}

  /** Позиции договора с состоянием и предложениями (топ-3 для ещё не сопоставленных). */
  async suggest(orderId: string) {
    const id = oid(orderId, 'договора');
    const db = this.connection.db!;
    const order = await db.collection('salesorders').findOne({ _id: id, deletedAt: null }, { projection: { orderNo: 1, customer: 1 } });
    if (!order) throw new NotFoundException('Договор не найден');
    const lines = await db.collection('incomes').find({ orderId: id, deletedAt: null }).sort({ lineNo: 1, _id: 1 }).toArray() as Doc[];
    const products = await this.loadProducts();
    const byId = new Map(products.map((p) => [p.id, p]));
    const keys = [...new Set(lines.map((l) => aliasKey(l.title)).filter(Boolean))];
    const al = keys.length ? await this.aliases.find({ key: { $in: keys } }).lean().exec() as unknown as Doc[] : [];
    const aliasOf = new Map(al.map((a) => [String(a.key), String(a.productId)]));
    let matched = 0;
    const items = lines.map((l) => {
      const state = lineState(l);
      const ok = state === 'confirmed' || state === 'none' || state === 'legacy';
      if (ok) matched++;
      const sg = ok ? [] : suggest(String(l.title ?? ''), products, aliasOf.get(aliasKey(l.title)));
      const p = l.productId ? byId.get(String(l.productId)) : undefined;
      return {
        lineId: String(l._id), lineNo: (l.lineNo as number | undefined) ?? null, title: String(l.title ?? ''), qty: (l.qty as number | undefined) ?? null, unit: (l.unit as string | undefined) ?? null,
        state, matched: ok, productId: l.productId ? String(l.productId) : null, productName: p ? (p.name || p.orderName || p.sku) : null,
        suggestions: sg, confident: isConfident(sg[0]),
      };
    });
    return { orderId, orderNo: (order.orderNo as string | undefined) ?? '', customer: (order.customer as string | undefined) ?? '', total: items.length, matched, unmatched: items.length - matched, items };
  }

  private async loadProducts(): Promise<MatchProduct[]> {
    const rows = await this.connection.db!.collection('products').find({ deletedAt: null }, { projection: { name: 1, sku: 1, orderName: 1, fullName: 1 } }).toArray();
    return rows.map((p) => ({ id: String(p._id), name: p.name as string | undefined, sku: p.sku as string | undefined, orderName: p.orderName as string | undefined, fullName: p.fullName as string | undefined }));
  }

  async confirm(lineId: string, productId: string, userId?: string) {
    return (await this.bulk([{ lineId, productId }], userId)).items[0];
  }

  async none(lineId: string, userId?: string) {
    return (await this.bulk([{ lineId, productId: null }], userId)).items[0];
  }

  /** Пачка: сначала проверка всех (позиции и изделия существуют), потом запись. `productId: null` = «не изделие». */
  async bulk(picks: Pick[], userId?: string) {
    const db = this.connection.db!;
    const lineIds = [...new Set(picks.map((p) => p.lineId))];
    if (lineIds.length !== picks.length) throw new BadRequestException('Одна позиция указана дважды');
    const lines = await db.collection('incomes').find({ _id: { $in: lineIds.map((i) => oid(i, 'позиции')) }, deletedAt: null }).toArray() as Doc[];
    const lineBy = new Map(lines.map((l) => [String(l._id), l]));
    if (lineIds.some((i) => !lineBy.has(i))) throw new NotFoundException('Позиция не найдена — обновите список');
    const pids = [...new Set(picks.map((p) => p.productId).filter(Boolean) as string[])];
    const prods = pids.length ? await db.collection('products').find({ _id: { $in: pids.map((i) => oid(i, 'изделия')) }, deletedAt: null }, { projection: { name: 1 } }).toArray() : [];
    if (prods.length !== pids.length) throw new NotFoundException('Изделие не найдено — выберите из списка');
    const by = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const now = new Date();
    const items: Array<{ lineId: string; state: string; productId: string | null }> = [];
    for (const p of picks) {
      const cur = lineBy.get(p.lineId)!;
      const set: Doc = { matchStatus: p.productId ? 'confirmed' : 'none', matchedAt: now, editedInApp: true, ...(by ? { matchedBy: by } : {}) };
      if (p.productId) set.productId = new Types.ObjectId(p.productId);
      await db.collection('incomes').updateOne({ _id: cur._id as Types.ObjectId }, { $set: set, ...(p.productId ? {} : { $unset: { productId: '' } }) });
      if (p.productId) await this.remember(String(cur.title ?? ''), p.productId, now);
      await this.audit.log({ action: 'income.updated', entityType: 'Income', entityId: p.lineId, details: { partial: true, before: { productId: cur.productId ? String(cur.productId) : null, matchStatus: cur.matchStatus ?? null }, after: { productId: p.productId, matchStatus: set.matchStatus }, meta: { via: 'matching' } } as never });
      items.push({ lineId: p.lineId, state: p.productId ? 'confirmed' : 'none', productId: p.productId });
    }
    return { done: items.length, items };
  }

  /** Запомнить «такая формулировка = это изделие» (повтор — счётчик +1, изделие обновляется). */
  private async remember(title: string, productId: string, at: Date) {
    const key = aliasKey(title);
    if (!key) return;
    await this.aliases.updateOne({ key }, { $set: { productId: new Types.ObjectId(productId), lastAt: at }, $inc: { count: 1 } }, { upsert: true }).exec();
  }
}
