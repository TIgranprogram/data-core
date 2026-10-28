import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid } from '../../common/list-query';
import type { OrderStage } from '../../common/text/order-key';
import { remaining, stageAfterShipments, type RemainRow } from '../../common/text/shipment-calc';
import { CounterService } from '../counter/counter.service';
import type { CreateShipmentDto, UpdateShipmentDto } from './dto';
import { Shipment, type ShipmentDocument } from './shipment.schema';
import { renderShipmentPdf } from './shipment-pdf';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Дата ГГГГ-ММ-ДД → полночь UTC; пусто — сегодня по Москве. */
const day = (v?: string) => new Date(`${v ? String(v).slice(0, 10) : new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)}T00:00:00.000Z`);
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const isOid = (v: unknown) => Types.ObjectId.isValid(String(v));

/**
 * Отгрузки заказов (ОТГ): запись, остаток по позициям, автоматический этап заказа
 * (первая отгрузка — «Частично отгружен», остаток 0 везде — «Отгружен», отмена — назад), печатная форма.
 * `salesorders.stage` правится напрямую, `incomes` только читаются.
 */
@Injectable()
export class ShipmentsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Shipment.name) private readonly model: Model<ShipmentDocument>,
    private readonly counters: CounterService,
  ) {}

  private db() { return this.connection.db!; }

  private async order(orderId: string | Types.ObjectId): Promise<Doc> {
    const o = await this.db().collection('salesorders').findOne({ _id: typeof orderId === 'string' ? oid(orderId, 'заказа') : orderId, deletedAt: null });
    if (!o) throw new NotFoundException('Заказ не найден');
    return o;
  }

  private incomes(orderId: Types.ObjectId) {
    return this.db().collection('incomes').find({ orderId, deletedAt: null }, { projection: { title: 1, unit: 1, qty: 1, lineNo: 1, productId: 1 } }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray() as Promise<Doc[]>;
  }

  private live(orderId: Types.ObjectId) { return this.model.find({ orderId, deletedAt: null }).sort({ date: -1, seq: -1 }).lean().exec() as unknown as Promise<Doc[]>; }

  private rem(lines: Doc[], ships: Doc[]): RemainRow[] {
    return remaining(lines.map((l) => ({ id: String(l._id), qty: l.qty })), ships.map((s) => ({ lines: (s.lines as Doc[]).map((x) => ({ incomeId: String(x.incomeId), qty: x.qty })) })));
  }

  private present(s: Doc) {
    const lines = (s.lines as Doc[]).map((l) => ({ incomeId: String(l.incomeId), title: l.title ?? '', unit: l.unit ?? '', qty: l.qty }));
    return {
      id: String(s._id), orderId: String(s.orderId), number: s.number, seq: s.seq, date: s.date, lines,
      lineCount: lines.length, qtyTotal: Math.round(lines.reduce((a, l) => a + Number(l.qty || 0), 0) * 1000) / 1000,
      who: { id: s.whoId ? String(s.whoId) : null, name: s.whoName ?? null },
      reason: s.reason ?? null, note: s.note ?? null, docNo: s.docNo ?? null, receiver: s.receiver ?? null,
      createdAt: s.createdAt ?? null, deletedAt: s.deletedAt ?? null,
    };
  }

  /** Список отгрузок заказа + остаток по позициям; `deleted` — отменённые (для восстановления). */
  async list(orderId: string, deleted = false) {
    const o = await this.order(orderId);
    const _id = o._id as Types.ObjectId;
    const [lines, ships] = await Promise.all([this.incomes(_id), this.live(_id)]);
    const items = deleted
      ? (await this.model.find({ orderId: _id, deletedAt: { $ne: null } }).sort({ deletedAt: -1 }).lean().exec() as unknown as Doc[]).map((s) => ({ ...this.present(s), deletedByName: s.deletedByName ?? null }))
      : ships.map((s) => this.present(s));
    return {
      items, total: items.length, remaining: this.rem(lines, ships),
      stage: o.stage ?? 'new',
      // этап «отгружен» стоял до учёта отгрузок — остаток по такому заказу не считаем «к отгрузке»
      legacyShipped: o.stage === 'shipped' && ships.length === 0,
    };
  }

  /** Пересчёт этапа заказа по живым отгрузкам. */
  private async recalcStage(orderId: Types.ObjectId): Promise<OrderStage> {
    const cur = await this.db().collection('salesorders').findOne({ _id: orderId }, { projection: { stage: 1 } });
    const [lines, ships] = await Promise.all([this.incomes(orderId), this.live(orderId)]);
    const stage = stageAfterShipments((cur?.stage as OrderStage) || 'new', this.rem(lines, ships), ships.length);
    if (stage !== (cur?.stage ?? 'new')) await this.db().collection('salesorders').updateOne({ _id: orderId }, { $set: { stage, updatedAt: new Date() } });
    return stage;
  }

  private async userName(user?: AuthenticatedUser) {
    if (!user?.id || !isOid(user.id)) return user?.username;
    const u = await this.db().collection('users').findOne({ _id: new Types.ObjectId(user.id) }, { projection: { displayName: 1, username: 1 } });
    return String(u?.displayName || u?.username || user.username || '') || undefined;
  }

  async create(orderId: string, dto: CreateShipmentDto, user: AuthenticatedUser) {
    const o = await this.order(orderId);
    const _id = o._id as Types.ObjectId;
    if (o.stage === 'closed' || o.stage === 'cancelled') throw new BadRequestException('Заказ закрыт или отменён — отгрузить нельзя');
    const [lines, ships] = await Promise.all([this.incomes(_id), this.live(_id)]);
    if (o.stage === 'shipped' && ships.length === 0) throw new BadRequestException('Заказ отмечен «Отгружен» до учёта отгрузок — смените этап вручную, если нужна новая отгрузка');
    const rem = new Map(this.rem(lines, ships).map((r) => [r.incomeId, r]));
    const byId = new Map(lines.map((l) => [String(l._id), l]));
    const seen = new Set<string>();
    const outLines = dto.lines.map((dl) => {
      const l = byId.get(dl.incomeId);
      if (!l) throw new BadRequestException('Позиция не из этого заказа');
      if (seen.has(dl.incomeId)) throw new BadRequestException(`Позиция «${l.title}» указана дважды`);
      seen.add(dl.incomeId);
      const r = rem.get(dl.incomeId)!;
      if (!(r.qty > 0)) throw new BadRequestException(`Позиция «${l.title}»: укажите количество в заказе — без него отгрузить нельзя`);
      if (r.left <= 0) throw new BadRequestException(`Позиция «${l.title}» уже отгружена полностью`);
      if (dl.qty > r.left + 1e-9) throw new BadRequestException(`Позиция «${l.title}»: осталось ${fmt(r.left)}${l.unit ? ' ' + l.unit : ''}`);
      return { incomeId: l._id as Types.ObjectId, title: l.title as string, unit: (l.unit as string | undefined) ?? undefined, qty: dl.qty };
    });
    // отгружается не весь остаток по заказу → нужна причина
    const sent = new Map(outLines.map((x) => [String(x.incomeId), x.qty]));
    const leftAfter = [...rem.values()].some((r) => r.left - (sent.get(r.incomeId) ?? 0) > 1e-9);
    if (leftAfter && !String(dto.reason ?? '').trim()) throw new BadRequestException('Укажите причину: отгружается не весь остаток');
    const seq = await this.counters.nextSeq('Shipment', String(_id));
    let doc: ShipmentDocument;
    try {
      doc = await this.model.create({
        orderId: _id, seq, number: `ОТГ-${String(o.orderNo ?? '').trim() || '—'}-${seq}`, date: day(dto.date), lines: outLines,
        whoId: user?.id && isOid(user.id) ? new Types.ObjectId(user.id) : undefined, whoName: await this.userName(user),
        reason: dto.reason?.trim() || undefined, note: dto.note?.trim() || undefined, docNo: dto.docNo?.trim() || undefined, receiver: dto.receiver?.trim() || undefined,
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('Номер отгрузки занят — повторите');
      throw e;
    }
    return { ...this.present(doc.toObject() as unknown as Doc), orderStage: await this.recalcStage(_id) };
  }

  private async find(id: string, deleted = false): Promise<Doc> {
    const s = await this.model.findOne({ _id: oid(id, 'отгрузки'), deletedAt: deleted ? { $ne: null } : null }).setOptions({ includeSoftDeleted: true }).lean().exec() as unknown as Doc | null;
    if (!s) throw new NotFoundException(deleted ? 'Отгрузки нет среди отменённых' : 'Отгрузка не найдена');
    return s;
  }

  async update(id: string, dto: UpdateShipmentDto) {
    const s = await this.find(id);
    const set: Doc = {};
    if (dto.date !== undefined) set.date = day(dto.date);
    for (const k of ['note', 'docNo', 'receiver'] as const) if (dto[k] !== undefined) set[k] = String(dto[k]).trim() || null;
    if (!Object.keys(set).length) throw new BadRequestException('Нечего менять: допустимы date, note, docNo, receiver');
    await this.model.updateOne({ _id: s._id }, { $set: set }).exec();
    return this.present(await this.find(id));
  }

  /** Отмена = корзина; остаток возвращается, этап заказа пересчитывается. */
  async remove(id: string, user: AuthenticatedUser) {
    const s = await this.find(id);
    const at = new Date();
    await this.model.updateOne({ _id: s._id }, { $set: { deletedAt: at, deletedById: user?.id && isOid(user.id) ? new Types.ObjectId(user.id) : undefined, deletedByName: await this.userName(user) } }).exec();
    return { ...this.present(s), deletedAt: at, orderStage: await this.recalcStage(s.orderId) };
  }

  async restore(id: string) {
    const s = await this.find(id, true);
    const o = await this.order(s.orderId);
    if (o.stage === 'closed' || o.stage === 'cancelled') throw new BadRequestException('Заказ закрыт или отменён — восстановить отгрузку нельзя');
    const [lines, ships] = await Promise.all([this.incomes(o._id), this.live(o._id)]);
    const rem = new Map(this.rem(lines, ships).map((r) => [r.incomeId, r]));
    for (const l of s.lines as Doc[]) {
      const r = rem.get(String(l.incomeId));
      if (!r) throw new BadRequestException(`Позиции «${l.title}» уже нет в заказе — восстановить нельзя`);
      if (l.qty > r.left + 1e-9) throw new BadRequestException(`Позиция «${l.title}»: осталось ${fmt(r.left)}${l.unit ? ' ' + l.unit : ''}, в отгрузке ${fmt(l.qty)}`);
    }
    await this.model.updateOne({ _id: s._id }, { $set: { deletedAt: null }, $unset: { deletedById: '', deletedByName: '' } }).setOptions({ includeSoftDeleted: true }).exec();
    return { ...this.present(await this.find(id)), orderStage: await this.recalcStage(o._id) };
  }

  /** Печатная форма: А4, чёрно-белая. «Остаток после» — по отгрузкам до этой включительно. */
  async pdf(id: string) {
    const s = await this.find(id);
    const o = await this.order(s.orderId);
    const db = this.db();
    const [lines, ships] = await Promise.all([this.incomes(o._id), this.live(o._id)]);
    const upto = this.rem(lines, ships.filter((x) => (x.seq as number) <= (s.seq as number)));
    const left = new Map(upto.map((r) => [r.incomeId, r.left]));
    const byId = new Map(lines.map((l) => [String(l._id), l]));
    const org = o.companyId ? await db.collection('organizations').findOne({ _id: o.companyId }, { projection: { name: 1, fullName: 1, inn: 1, legalAddress: 1, phone: 1 } }) : null;
    const cust = o.customer ? await db.collection('organizations').findOne({ name: String(o.customer), deletedAt: null }, { projection: { inn: 1, legalAddress: 1 } }) : null;
    const prodIds = (s.lines as Doc[]).map((l) => byId.get(String(l.incomeId))?.productId).filter(Boolean);
    const prods = prodIds.length ? await db.collection('products').find({ _id: { $in: prodIds } }, { projection: { sku: 1 } }).toArray() : [];
    const sku = new Map(prods.map((p) => [String(p._id), String(p.sku ?? '')]));
    const rows = (s.lines as Doc[]).map((l, i) => {
      const inc = byId.get(String(l.incomeId));
      return { n: i + 1, title: String(l.title ?? inc?.title ?? ''), article: inc?.productId ? sku.get(String(inc.productId)) ?? '' : '', unit: String(l.unit ?? inc?.unit ?? ''), ordered: Number(inc?.qty) || 0, now: l.qty as number, after: left.get(String(l.incomeId)) ?? 0 };
    });
    const buf = await renderShipmentPdf({
      number: s.number, date: s.date, orderNo: String(o.orderNo ?? ''), orderDate: (o.contractDate ?? o.createdAt) as Date | undefined,
      org: org ? { name: String(org.fullName || org.name || ''), inn: org.inn, address: org.legalAddress, phone: org.phone } : { name: '' },
      customer: { name: String(o.customer ?? ''), inn: cust?.inn, address: cust?.legalAddress },
      rows, reason: s.reason, note: s.note, docNo: s.docNo, receiver: s.receiver, whoName: s.whoName,
    });
    return { buf, filename: `${String(s.number).replace(/[^\p{L}\p{N}._-]+/gu, '_')}.pdf` };
  }
}
