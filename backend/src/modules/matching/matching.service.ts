import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { escapeRe, oid } from '../../common/list-query';
import { AuditService } from '../audit/audit.service';
import { aliasKey, isConfident, lineState, suggest, type MatchProduct, type Suggestion } from './matching-rules';
import { ProductAlias, ProductAliasDocument } from './product-alias.schema';

type Doc = Record<string, unknown>;
type Pick = { lineId: string; productId: string | null };
type Photo = { url: string; thumb: string };
const NO_ORDER = '-'; // значение фильтра «заказ без №»

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
    const lines = await db.collection('incomes').find({ orderId: id, deletedAt: null, cancelledAt: null }).sort({ lineNo: 1, _id: 1 }).toArray() as Doc[];
    const products = await this.loadProducts();
    const byId = new Map(products.map((p) => [p.id, p]));
    const aliasOf = await this.loadAliases(lines);
    let matched = 0;
    const items = lines.map((l) => {
      const state = lineState(l);
      const ok = state === 'confirmed' || state === 'none' || state === 'legacy';
      if (ok) matched++;
      const sg = ok ? [] : suggest(String(l.title ?? ''), products, aliasOf.get(aliasKey(l.title)));
      const p = l.productId ? byId.get(String(l.productId)) : undefined;
      return {
        lineId: String(l._id), lineNo: (l.lineNo as number | undefined) ?? null, title: String(l.title ?? ''), qty: (l.qty as number | undefined) ?? null, unit: (l.unit as string | undefined) ?? null,
        state, matched: ok, productId: l.productId ? String(l.productId) : null, productName: p ? (p.name || p.orderName || p.sku) : null, productSku: p?.sku ?? null,
        suggestions: sg, confident: isConfident(sg[0]),
      };
    });
    return { orderId, orderNo: (order.orderNo as string | undefined) ?? '', customer: (order.customer as string | undefined) ?? '', total: items.length, matched, unmatched: items.length - matched, items: await this.withPhotos(lines, items) };
  }

  /** Картинки для сравнения: у позиции — первое фото (Excel «Вид» или загруженное), у предложений — первое фото изделия. Одним запросом на страницу. */
  private async withPhotos<T extends { suggestions: Suggestion[] }>(lines: Doc[], items: T[]) {
    const db = this.connection.db!;
    const first = (d?: Doc) => ((d?.photoIds as Types.ObjectId[] | undefined) ?? [])[0];
    const pids = [...new Set(items.flatMap((it) => it.suggestions.map((s) => s.productId)))].map((x) => new Types.ObjectId(x));
    const prods = pids.length ? await db.collection('products').find({ _id: { $in: pids } }, { projection: { photoIds: 1 } }).toArray() : [];
    const prodPhoto = new Map(prods.map((p) => [String(p._id), first(p)]));
    const ids = [...lines.map(first), ...prodPhoto.values()].filter(Boolean) as Types.ObjectId[];
    const [ph, th] = ids.length ? await Promise.all([
      db.collection('photos').find({ _id: { $in: ids } }, { projection: { storageUrl: 1 } }).toArray(),
      db.collection('photos').find({ parentPhotoId: { $in: ids }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    ]) : [[], []];
    const thumb = new Map(th.map((p) => [String(p.parentPhotoId), String(p.storageUrl)]));
    const photos = new Map<string, Photo>(ph.map((p) => [String(p._id), { url: String(p.storageUrl), thumb: thumb.get(String(p._id)) ?? String(p.storageUrl) }]));
    const at = (id?: Types.ObjectId) => (id ? photos.get(String(id)) ?? null : null);
    return items.map((it, i) => ({ ...it, photo: at(first(lines[i])), suggestions: it.suggestions.map((s) => ({ ...s, photo: at(prodPhoto.get(s.productId)) })) }));
  }

  /** Справочник соответствий одним запросом: ключ названия → изделие. */
  private async loadAliases(lines: Doc[]): Promise<Map<string, string>> {
    const keys = [...new Set(lines.map((l) => aliasKey(l.title)).filter(Boolean))];
    const al = keys.length ? await this.aliases.find({ key: { $in: keys } }).lean().exec() as unknown as Doc[] : [];
    return new Map(al.map((a) => [String(a.key), String(a.productId)]));
  }

  /** Несопоставленные позиции (unmatched/auto) живых договоров: сначала «в производстве», затем по сроку. Подбор — только для строк страницы, пачкой. */
  async unmatched(q: { page?: number; limit?: number; q?: string; orderId?: string; inProduction?: string; productionNo?: string; orderNo?: string; stage?: string }) {
    const db = this.connection.db!;
    const limit = Math.min(Math.max(Math.trunc(Number(q.limit)) || 50, 1), 200);
    const page = Math.max(Math.trunc(Number(q.page)) || 1, 1);
    const orderFilter: Doc = { deletedAt: null };
    if (q.orderId) orderFilter._id = oid(q.orderId, 'договора');
    if (q.inProduction === '1') orderFilter.productionNo = { $nin: [null, ''] };
    else if (q.inProduction === '0') orderFilter.productionNo = { $in: [null, ''] };
    const orders = await db.collection('salesorders').find(orderFilter, { projection: { orderNo: 1, customer: 1, productionNo: 1, productionDeadline: 1, shipDate: 1, stage: 1 } }).toArray() as Doc[];
    const orderBy = new Map(orders.map((o) => [String(o._id), o]));
    const lines = orders.length ? await db.collection('incomes').find({
      deletedAt: null, cancelledAt: null, orderId: { $in: orders.map((o) => o._id) },
      $or: [{ matchStatus: 'auto' }, { matchStatus: { $nin: ['none', 'auto'] }, productId: null }],
    }, { projection: { orderId: 1, lineNo: 1, title: 1, qty: 1, unit: 1, productId: 1, matchStatus: 1, photoIds: 1 } }).toArray() as Doc[] : [];
    const needle = (q.q ?? '').trim();
    const re = needle ? new RegExp(escapeRe(needle), 'i') : null;
    const found = lines.map((l) => ({ l, o: orderBy.get(String(l.orderId))! })).filter((r) => r.o && (!re || [r.l.title, r.o.orderNo, r.o.customer, r.o.productionNo].some((v) => re.test(String(v ?? '')))));
    // Варианты фильтров считаются до самих фильтров: выбор заказа не убирает остальные пункты списка
    const prodOf = (o: Doc) => String(o.productionNo || NO_ORDER), contractOf = (o: Doc) => String(o.orderNo ?? ''), stageOf = (o: Doc) => String(o.stage || 'new');
    const tally = (of: (o: Doc) => string) => {
      const n = new Map<string, number>();
      for (const r of found) { const k = of(r.o); if (k) n.set(k, (n.get(k) ?? 0) + 1); }
      return [...n].map(([value, count]) => ({ value, n: count })).sort((a, b) => a.value.localeCompare(b.value, 'ru', { numeric: true }));
    };
    const facets = { orders: tally(prodOf), contracts: tally(contractOf), stages: tally(stageOf) };
    const rows = found.filter(({ o }) => (!q.productionNo || prodOf(o) === q.productionNo) && (!q.orderNo || contractOf(o) === q.orderNo) && (!q.stage || stageOf(o) === q.stage));
    const due = (o: Doc) => ((o.productionDeadline ?? o.shipDate) as Date | undefined)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    rows.sort((a, b) => Number(!!b.o.productionNo) - Number(!!a.o.productionNo) || due(a.o) - due(b.o)
      || String(a.o.orderNo ?? '').localeCompare(String(b.o.orderNo ?? ''), 'ru', { numeric: true }) || Number(a.l.lineNo ?? 0) - Number(b.l.lineNo ?? 0));
    const slice = rows.slice((page - 1) * limit, page * limit);
    const [products, aliasOf] = slice.length ? await Promise.all([this.loadProducts(), this.loadAliases(slice.map((r) => r.l))]) : [[] as MatchProduct[], new Map<string, string>()];
    const items = slice.map(({ l, o }) => {
      const sg = suggest(String(l.title ?? ''), products, aliasOf.get(aliasKey(l.title)));
      return {
        lineId: String(l._id), orderId: String(o._id), orderNo: (o.orderNo as string | undefined) ?? '', customer: (o.customer as string | undefined) ?? '',
        productionNo: (o.productionNo as string | undefined) || null, stage: stageOf(o), title: String(l.title ?? ''), qty: (l.qty as number | undefined) ?? null, unit: (l.unit as string | undefined) ?? null,
        suggestions: sg, confident: isConfident(sg[0]),
      };
    });
    return { items: await this.withPhotos(slice.map((r) => r.l), items), total: rows.length, page, limit, facets };
  }

  /** Счётчик для меню: всего несопоставленных и из них в производстве. */
  async unmatchedCount() {
    // Только подсчёт: без подбора изделий и фото (раньше — два полных unmatched, ~5 с)
    const db = this.connection.db!;
    const orders = await db.collection('salesorders').find({ deletedAt: null }, { projection: { productionNo: 1 } }).toArray() as Doc[];
    if (!orders.length) return { total: 0, inProduction: 0 };
    const inProdIds = new Set(orders.filter((o) => o.productionNo).map((o) => String(o._id)));
    const lines = await db.collection('incomes').find({
      deletedAt: null, cancelledAt: null, orderId: { $in: orders.map((o) => o._id) },
      $or: [{ matchStatus: 'auto' }, { matchStatus: { $nin: ['none', 'auto'] }, productId: null }],
    }, { projection: { orderId: 1 } }).toArray() as Doc[];
    return { total: lines.length, inProduction: lines.filter((l) => inProdIds.has(String(l.orderId))).length };
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
