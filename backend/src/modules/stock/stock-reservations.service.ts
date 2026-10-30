import { BadRequestException, ConflictException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { Material, MaterialDocument } from '../material/material.schema';
import { Reservation, ReservationDocument } from './schemas/reservation.schema';
import { StockMovement, StockMovementDocument } from './schemas/stock-movement.schema';
import { StorageItemDocument } from './schemas/storage-item.schema';
import { StockCoreService } from './stock-core.service';
import { StockMovementsService } from './stock-movements.service';
import { hangingReason } from './stock-hanging';
import { resolveTarget } from './stock-target';

/** Брони: по списку, список, снятие, «выдать по брони», карточка брони. */
@Injectable()
export class StockReservationsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    @InjectModel(Reservation.name) private readonly reservations: Model<ReservationDocument>,
    @InjectModel(Material.name) private readonly materials: Model<MaterialDocument>,
    private readonly core: StockCoreService,
    private readonly moves: StockMovementsService,
  ) {}

  /**
   * Бронь по списку (TASKS МВ.4): спецификация конструктора → бронь на складе под названием (и заказом).
   * Каждая строка бронирует min(нужно, свободно); чего не хватает — в ответе `short` (для «Заказать недостающее»).
   * Все брони списка — с общим `batchId` и `groupName`: снимаются строкой или целиком (releaseReservation / releaseGroup).
   */
  async reserveList(dto: { groupName: string; lines: { materialId: string; qty: number }[]; salesOrderId?: string; salesOrderLineId?: string; clientUid?: string }, userId?: string) {
    const groupName = String(dto.groupName || '').trim();
    if (!groupName) throw new BadRequestException('Назовите бронь: для чего (конструкция, заказ)');
    if (dto.clientUid) {
      const prev = await this.reservations.findOne({ clientUid: dto.clientUid }).lean().exec();
      if (prev) return this.reservationGroup(String((prev as { batchId?: Types.ObjectId }).batchId));
    }
    const merged = new Map<string, number>();
    for (const l of dto.lines) { const n = Number(l.qty); if (!(n > 0)) throw new BadRequestException('Количество в каждой строке — больше нуля'); merged.set(l.materialId, (merged.get(l.materialId) ?? 0) + n); }
    const wh = await this.core.defaultWarehouse();
    const batchId = new Types.ObjectId();
    // под позицию заказа (SK-6): позиция без заказа — заказ берёт сервер; чужая позиция — 400
    const line = dto.salesOrderLineId ? await resolveTarget(this.connection.db!, { salesOrderId: dto.salesOrderId, salesOrderLineId: dto.salesOrderLineId }) : undefined;
    const so = line ? (line.salesOrderId as Types.ObjectId) : dto.salesOrderId && Types.ObjectId.isValid(dto.salesOrderId) ? new Types.ObjectId(dto.salesOrderId) : undefined;
    const short: { materialId: string; need: number; reserved: number }[] = [];
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        short.length = 0;
        let first = true;
        for (const [id, need] of merged) {
          const matId = oid(id, 'позиции');
          const item = await this.core.loadStorage(wh._id as Types.ObjectId, matId, session);
          const free = Math.max(0, (item.quantity ?? 0) - (item.reservedQty ?? 0));
          const take = Math.min(need, free);
          if (take < need) short.push({ materialId: id, need, reserved: take });
          if (take <= 0) continue;
          item.reservedQty = (item.reservedQty ?? 0) + take;
          await item.save({ session });
          await this.reservations.create([{ orderId: groupName, materialId: matId, warehouseId: wh._id, qty: take, isActive: true, status: 'active', notes: groupName,
            batchId, groupName, createdBy, ...(so ? { salesOrderId: so } : {}), ...(line ? { salesOrderLineId: line.salesOrderLineId } : {}), ...(first && dto.clientUid ? { clientUid: dto.clientUid } : {}) }], { session });
          first = false;
        }
      });
    } finally { await session.endSession(); }
    return { ...(await this.reservationGroup(String(batchId))), short };
  }

  /** Активные брони, сгруппированные по названию (для «Бронь по списку»). */
  /** СМ.4: брони — из категорий роли, иначе 403. Нет списка, но есть заказ — все активные брони заказа. */
  async assertReservationsInScope(q: { ids?: string[]; salesOrderId?: string }, scope: string[]) {
    const filter = q.ids?.length ? { _id: { $in: q.ids.map((x) => new Types.ObjectId(x)) } } : { salesOrderId: new Types.ObjectId(q.salesOrderId), status: 'active', deletedAt: null };
    const list = await this.reservations.find(filter, { materialId: 1 }).lean().exec();
    const mats = await this.materials.find({ _id: { $in: list.map((d) => d.materialId).filter(Boolean) } }, { categoryId: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (mats.some((m) => !scope.includes(String(m.categoryId)))) throw new ForbiddenException('Эта бронь не из вашего раздела склада');
  }

  async listReservations(scope?: string[] | null) {
    const found = await this.reservations.find({ status: 'active', isActive: true, deletedAt: null }).sort({ createdAt: -1 }).limit(2000).lean().exec();
    const mats = await this.materials.find({ _id: { $in: found.map((d) => d.materialId).filter(Boolean) } }, { name: 1, unit: 1, categoryId: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
    const nm = new Map(mats.map((m) => [String(m._id), m]));
    // СМ.4: роль видит брони только своих категорий
    const docs = scope ? found.filter((d) => scope.includes(String(nm.get(String(d.materialId))?.categoryId))) : found;
    // Кто поставил и под какой заказ — чтобы на «Сегодня» было видно, чья бронь и для чего
    type Extra = { batchId?: Types.ObjectId; groupName?: string; createdAt?: Date; createdBy?: Types.ObjectId; salesOrderId?: Types.ObjectId; salesOrderLineId?: Types.ObjectId };
    const ex = docs as (typeof docs[number] & Extra)[];
    const [users, sos] = await Promise.all([
      this.connection.db!.collection('users').find({ _id: { $in: ex.map((d) => d.createdBy).filter(Boolean) as Types.ObjectId[] } }, { projection: { displayName: 1, username: 1 } }).toArray(),
      this.connection.db!.collection('salesorders').find({ _id: { $in: ex.map((d) => d.salesOrderId).filter(Boolean) as Types.ObjectId[] } }, { projection: { orderNo: 1, title: 1, stage: 1, deletedAt: 1 } }).toArray(),
    ]);
    const soDoc = new Map(sos.map((o) => [String(o._id), o]));
    const un = new Map(users.map((u) => [String(u._id), String(u.displayName || u.username || '')]));
    const so = new Map(sos.map((o) => [String(o._id), [o.orderNo, o.title].filter(Boolean).join(' · ')]));
    const groups = new Map<string, { key: string; name: string; batchId: string | null; createdAt?: Date; createdBy: string | null; salesOrder: string | null; salesOrderId: string | null; hanging: string | null; lines: unknown[] }>();
    for (const d of docs) {
      const x = d as typeof d & Extra;
      const k = x.batchId ? String(x.batchId) : 'one:' + String(d._id);
      const g = groups.get(k) ?? { key: k, name: x.groupName || d.orderId || 'Бронь', batchId: x.batchId ? String(x.batchId) : null, createdAt: x.createdAt,
        createdBy: x.createdBy ? un.get(String(x.createdBy)) ?? null : null, salesOrder: x.salesOrderId ? so.get(String(x.salesOrderId)) ?? null : null, salesOrderId: x.salesOrderId ? String(x.salesOrderId) : null, hanging: null, lines: [] };
      const m = nm.get(String(d.materialId));
      // «висящая» бронь (СК-6): заказ отгружен / закрыт / аннулирован / удалён — подсвечиваем, снимает человек
      const hanging = hangingReason(x.salesOrderId ? soDoc.get(String(x.salesOrderId)) : null, x.salesOrderId);
      if (hanging) g.hanging = hanging;
      g.lines.push({ id: String(d._id), materialId: String(d.materialId), name: m?.name ?? '(позиция удалена)', unit: m?.unit ?? '', qty: d.qty, issued: (d as { issuedQty?: number }).issuedQty ?? 0,
        salesOrderId: x.salesOrderId ? String(x.salesOrderId) : null, salesOrderLineId: x.salesOrderLineId ? String(x.salesOrderLineId) : null, hanging });
      groups.set(k, g);
    }
    const items = [...groups.values()];
    return { items, total: items.length, page: 1, limit: items.length };
  }

  private async reservationGroup(batchId: string) {
    const all = await this.listReservations();
    return all.items.find((g) => g.batchId === batchId) ?? { key: batchId, batchId, name: '', lines: [] };
  }

  /** Снять одну бронь (строку): «свободно» на складе снова увеличится. */
  async releaseReservation(id: string) {
    const r = await this.reservations.findOne({ _id: oid(id, 'брони'), status: 'active', deletedAt: null }).exec();
    if (!r) throw new NotFoundException('Бронь не найдена или уже снята');
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(() => this.releaseWithin(r, session));
    } finally { await session.endSession(); }
    return { id, released: true };
  }

  /** Снять бронь внутри чужой транзакции (спецификация «заменить»): «свободно» увеличивается. */
  async releaseWithin(r: ReservationDocument, session: ClientSession) {
    const item = await this.core.loadStorage(r.warehouseId as Types.ObjectId, r.materialId as Types.ObjectId, session);
    item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - r.qty);
    await item.save({ session });
    r.status = 'released'; r.isActive = false;
    await r.save({ session });
  }

  /** Снять всю бронь списка. */
  async releaseGroup(batchId: string) {
    const list = await this.reservations.find({ batchId: oid(batchId, 'брони'), status: 'active', deletedAt: null }, { _id: 1 }).lean().exec();
    if (!list.length) throw new NotFoundException('Бронь не найдена или уже снята');
    for (const r of list) await this.releaseReservation(String(r._id));
    return { batchId, released: list.length };
  }
  /**
   * «Выдать по брони» (TASKS Б.2): списание (out, `reservationId`) по броням одной операцией — всё или ничего.
   * Целиком — бронь «выдана» (fulfilled, qty = выдано); частично — бронь остаётся с остатком, `issuedQty` копит выданное.
   * Движения пакета с общим `batchId`: «Отменить» возвращает и остаток, и бронь (cancelBatch).
   */
  async issueReservations(dto: { lines: { reservationId: string; qty?: number }[]; personId?: string; issuedTo?: string; note?: string; clientUid?: string }, userId?: string) {
    if (dto.clientUid) {
      const prev = await this.movements.findOne({ clientUid: dto.clientUid, batchId: { $ne: null } }).lean().exec();
      if (prev) return { ...(await this.moves.batchResult(String((prev as { batchId?: Types.ObjectId }).batchId), 'issue')), issued: 0 };
    }
    const want = new Map<string, number | undefined>();
    for (const l of dto.lines) {
      if (l.qty !== undefined && !(Number(l.qty) > 0)) throw new BadRequestException('Укажите, сколько выдать (больше нуля)');
      want.set(String(oid(l.reservationId, 'брони')), l.qty === undefined ? undefined : Number(l.qty));
    }
    const target = await resolveTarget(this.connection.db!, { personId: dto.personId, issuedTo: dto.issuedTo });
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const batchId = new Types.ObjectId();
    const now = new Date();
    const matIds: Types.ObjectId[] = [];
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        matIds.length = 0;
        const list = await this.reservations.find({ _id: { $in: [...want.keys()].map((id) => new Types.ObjectId(id)) }, status: 'active', deletedAt: null }).session(session).exec();
        if (list.length !== want.size) throw new ConflictException('Часть броней уже выдана или снята — обновите страницу');
        const mats = await this.materials.find({ _id: { $in: list.map((r) => r.materialId) } }, { name: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
        const nameOf = new Map(mats.map((m) => [String(m._id), String(m.name)]));
        const plan: { r: ReservationDocument; n: number; item: StorageItemDocument }[] = [];
        // Одна строка склада на пару «склад + материал»: несколько броней одного материала (разные позиции заказа)
        // списываются с одной копии, а нехватка считается по сумме выдачи на пару — иначе остаток перезаписывался.
        const items = new Map<string, { item: StorageItemDocument; need: number; name: string }>();
        for (const r of list) {
          const n = want.get(String(r._id)) ?? r.qty;
          if (n > r.qty) throw new BadRequestException(`«${nameOf.get(String(r.materialId))}»: в брони ${r.qty}, выдать ${n} нельзя`);
          const key = `${String(r.warehouseId ?? '')}:${String(r.materialId)}`;
          let slot = items.get(key);
          if (!slot) { slot = { item: await this.core.loadStorage(r.warehouseId, r.materialId as Types.ObjectId, session), need: 0, name: String(nameOf.get(String(r.materialId))) }; items.set(key, slot); }
          slot.need = Math.round((slot.need + n) * 1000) / 1000;
          plan.push({ r, n, item: slot.item });
        }
        const short = [...items.values()].filter((x) => (x.item.quantity ?? 0) < x.need).map((x) => `«${x.name}»: есть ${x.item.quantity ?? 0}, нужно ${x.need}`);
        if (short.length) throw new BadRequestException(`Недостаточно на складе — ${short.join('; ')}`);
        let first = true;
        for (const { r, n, item } of plan) {
          item.quantity = Math.round(((item.quantity ?? 0) - n) * 1000) / 1000;
          item.reservedQty = Math.max(0, Math.round(((item.reservedQty ?? 0) - n) * 1000) / 1000);
          await item.save({ session });
          const x = r as ReservationDocument & { groupName?: string; salesOrderId?: Types.ObjectId; salesOrderLineId?: Types.ObjectId };
          await this.movements.create([{ type: 'out', date: now, materialId: r.materialId, warehouseId: r.warehouseId, qty: n, delta: -n,
            notes: dto.note?.trim() || `Выдано по брони «${x.groupName || r.orderId}»`, clientUid: first ? dto.clientUid : undefined, createdBy, batchId, reservationId: r._id,
            ...(x.salesOrderId ? { salesOrderId: x.salesOrderId, orderId: String(x.salesOrderId) } : {}), ...(x.salesOrderLineId ? { salesOrderLineId: x.salesOrderLineId } : {}), ...target }], { session });
          first = false;
          const left = Math.round((r.qty - n) * 1000) / 1000;
          r.issuedQty = Math.round(((r.issuedQty ?? 0) + n) * 1000) / 1000;
          if (left <= 0) { r.qty = r.issuedQty; r.status = 'fulfilled'; r.isActive = false; } else r.qty = left;
          await r.save({ session });
          matIds.push(r.materialId as Types.ObjectId);
        }
      });
    } finally {
      await session.endSession();
    }
    await this.connection.db!.collection('materials').updateMany({ _id: { $in: matIds } }, { $set: { editedInApp: true } });
    return { ...(await this.moves.batchResult(String(batchId), 'issue', matIds)), issued: matIds.length };
  }

  /**
   * Правка брони (SK-6): количество (остаток брони), заказ, позиция заказа, примечание. Только активная бронь.
   * Количество больше прежнего — в пределах свободного; позиция чужого заказа — 400; null — снять привязку.
   * Заказ сменился, а позиция не названа — позиция снимается (она была от прежнего заказа).
   */
  async updateReservation(id: string, dto: { qty?: number; salesOrderId?: string | null; salesOrderLineId?: string | null; note?: string }) {
    const r = await this.reservations.findOne({ _id: oid(id, 'брони'), status: 'active', deletedAt: null }).exec();
    if (!r) throw new NotFoundException('Бронь не найдена или уже снята');
    const x = r as ReservationDocument & { salesOrderId?: Types.ObjectId; salesOrderLineId?: Types.ObjectId };
    const qty = dto.qty === undefined ? undefined : Number(dto.qty);
    if (qty !== undefined && !(qty > 0)) throw new BadRequestException('Количество в брони — больше нуля; чтобы убрать бронь, снимите её');
    let order = x.salesOrderId, line = x.salesOrderLineId;
    const db = this.connection.db!;
    if (dto.salesOrderId === null) {
      if (dto.salesOrderLineId) throw new BadRequestException('Нельзя убрать заказ и оставить позицию');
      order = undefined; line = undefined;
    } else if (dto.salesOrderLineId) {
      const t = await resolveTarget(db, { salesOrderId: dto.salesOrderId ?? (order ? String(order) : undefined), salesOrderLineId: dto.salesOrderLineId });
      order = t.salesOrderId as Types.ObjectId; line = t.salesOrderLineId as Types.ObjectId;
    } else if (dto.salesOrderId) {
      const t = await resolveTarget(db, { salesOrderId: dto.salesOrderId });
      if (!order || !order.equals(t.salesOrderId as Types.ObjectId)) line = undefined;
      order = t.salesOrderId as Types.ObjectId;
    } else if (dto.salesOrderLineId === null) line = undefined;
    const delta = qty === undefined ? 0 : Math.round((qty - r.qty) * 1000) / 1000;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        if (delta !== 0) {
          const item = await this.core.loadStorage(r.warehouseId as Types.ObjectId, r.materialId as Types.ObjectId, session);
          const free = Math.round(((item.quantity ?? 0) - (item.reservedQty ?? 0)) * 1000) / 1000;
          if (delta > 0 && free < delta) throw new BadRequestException(`Недостаточно свободного остатка: свободно ${Math.max(0, free)}, нужно ещё ${delta}`);
          item.reservedQty = Math.max(0, Math.round(((item.reservedQty ?? 0) + delta) * 1000) / 1000);
          await item.save({ session });
          r.qty = qty as number;
        }
        r.set('salesOrderId', order); r.set('salesOrderLineId', line);
        if (dto.note !== undefined) r.notes = dto.note.trim();
        await r.save({ session });
      });
    } finally { await session.endSession(); }
    return { id, qty: r.qty, salesOrderId: order ? String(order) : null, salesOrderLineId: line ? String(line) : null, notes: r.notes ?? null };
  }

  /**
   * Брони заказа для «Выдать по заказу» (SK-6): активные брони, сколько на складе (хватит ли выдать) и «висящий» ли заказ.
   * Без цен. Позиция заказа — `lineNo` и название из incomes.
   */
  async reservationsByOrder(salesOrderId: string) {
    const id = oid(salesOrderId, 'заказа');
    const db = this.connection.db!;
    const [order, docs, wh] = await Promise.all([
      db.collection('salesorders').findOne({ _id: id }, { projection: { orderNo: 1, title: 1, customer: 1, stage: 1, deletedAt: 1 } }),
      this.reservations.find({ salesOrderId: id, status: 'active', deletedAt: null }).sort({ createdAt: 1 }).lean().exec(),
      this.core.defaultWarehouse(),
    ]);
    if (!order) throw new NotFoundException('Заказ не найден');
    type Extra = { batchId?: Types.ObjectId; groupName?: string; salesOrderLineId?: Types.ObjectId };
    const ex = docs as (typeof docs[number] & Extra)[];
    const matIds = [...new Set(ex.map((d) => String(d.materialId)))].map((m) => new Types.ObjectId(m));
    const lineIds = ex.map((d) => d.salesOrderLineId).filter(Boolean) as Types.ObjectId[];
    const [mats, stocks, lines] = await Promise.all([
      this.materials.find({ _id: { $in: matIds } }, { name: 1, unit: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec(),
      db.collection('storageitems').find({ warehouseId: wh._id, materialId: { $in: matIds }, deletedAt: null }, { projection: { materialId: 1, quantity: 1 } }).toArray(),
      lineIds.length ? db.collection('incomes').find({ _id: { $in: lineIds } }, { projection: { lineNo: 1, title: 1 } }).toArray() : [],
    ]);
    const nm = new Map(mats.map((m) => [String(m._id), m]));
    const onHand = new Map<string, number>();
    for (const s of stocks) onHand.set(String(s.materialId), (onHand.get(String(s.materialId)) ?? 0) + (Number(s.quantity) || 0));
    const ln = new Map(lines.map((l) => [String(l._id), l]));
    const items = ex.map((d) => {
      const m = nm.get(String(d.materialId)), have = onHand.get(String(d.materialId)) ?? 0, l = d.salesOrderLineId ? ln.get(String(d.salesOrderLineId)) : undefined;
      return { id: String(d._id), materialId: String(d.materialId), name: m?.name ?? '(позиция удалена)', unit: m?.unit ?? '', qty: d.qty, issued: (d as { issuedQty?: number }).issuedQty ?? 0,
        onHand: have, canIssue: d.qty > 0 && have >= d.qty, groupName: d.groupName ?? d.orderId ?? '', batchId: d.batchId ? String(d.batchId) : null,
        salesOrderLineId: d.salesOrderLineId ? String(d.salesOrderLineId) : null, lineNo: l ? (l.lineNo as number) ?? null : null, lineTitle: l ? String(l.title ?? '') : null };
    });
    return { order: { id: String(order._id), label: [order.orderNo, order.title].filter(Boolean).join(' · '), customer: order.customer ?? null, stage: order.stage ?? null },
      hanging: hangingReason(order, order._id), items, total: items.length };
  }

  /**
   * «Выдать по заказу» (SK-6): все активные брони заказа или выбранные — одной операцией (пачка, общий batchId, всё или ничего).
   * Выдача по брони с позицией пишет `salesOrderLineId` в движение. Повтор с тем же clientUid ничего не меняет.
   * `lines` (SK-6c) — выбранные брони с количеством (меньше брони — частичная выдача, остаток брони активен).
   */
  async issueOrder(dto: { salesOrderId: string; reservationIds?: string[]; lines?: { reservationId: string; qty?: number }[]; personId?: string; issuedTo?: string; note?: string; clientUid?: string }, userId?: string) {
    const rest = { personId: dto.personId, issuedTo: dto.issuedTo, note: dto.note, clientUid: dto.clientUid };
    if (dto.clientUid && (await this.movements.exists({ clientUid: dto.clientUid, batchId: { $ne: null } }))) return this.issueReservations({ lines: [], ...rest }, userId);
    const qty = new Map((dto.lines ?? []).map((l) => [l.reservationId, l.qty]));
    const ids = dto.lines ? [...qty.keys()] : dto.reservationIds;
    if (ids && !ids.length) throw new BadRequestException('Выберите, что выдать');
    const list = await this.reservations.find({ salesOrderId: oid(dto.salesOrderId, 'заказа'), status: 'active', deletedAt: null, ...(ids ? { _id: { $in: ids.map((i) => oid(i, 'брони')) } } : {}) }, { _id: 1 }).lean().exec();
    if (ids && list.length !== new Set(ids).size) throw new ConflictException('Часть броней уже выдана или снята — обновите страницу');
    if (!list.length) throw new BadRequestException('По заказу нет активных броней');
    if (list.length > 500) throw new BadRequestException('За один раз — не больше 500 броней: выберите часть');
    return { ...(await this.issueReservations({ lines: list.map((r) => ({ reservationId: String(r._id), qty: qty.get(String(r._id)) })), ...rest }, userId)), salesOrderId: dto.salesOrderId };
  }

  /**
   * Карточка брони (TASKS Б.3): путь целиком — кто поставил, под какой заказ, что забронировано и сколько уже выдано,
   * кому выдавали, и заявки снабжения на то, чего не хватило («Заказать недостающее», clientUid `short-<batchId>-…`).
   * key — batchId списка или id одиночной брони.
   */
  async reservationDetail(key: string) {
    const id = oid(key, 'брони');
    let docs = await this.reservations.find({ batchId: id, deletedAt: null }).sort({ createdAt: 1 }).lean().exec();
    if (!docs.length) docs = await this.reservations.find({ _id: id, deletedAt: null }).lean().exec();
    if (!docs.length) throw new NotFoundException('Бронь не найдена');
    type Extra = { batchId?: Types.ObjectId; groupName?: string; createdAt?: Date; createdBy?: Types.ObjectId; salesOrderId?: Types.ObjectId; salesOrderLineId?: Types.ObjectId; issuedQty?: number };
    const head = docs[0] as typeof docs[number] & Extra;
    const db = this.connection.db!;
    const [mats, issues, so, author, requests] = await Promise.all([
      this.materials.find({ _id: { $in: docs.map((d) => d.materialId) } }, { name: 1, unit: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec(),
      this.movements.find({ reservationId: { $in: docs.map((d) => d._id) }, deletedAt: null, cancelledAt: null }).sort({ date: -1 }).lean().exec(),
      head.salesOrderId ? db.collection('salesorders').findOne({ _id: head.salesOrderId }, { projection: { orderNo: 1, title: 1, customer: 1, stage: 1, deletedAt: 1 } }) : null,
      head.createdBy ? db.collection('users').findOne({ _id: head.createdBy }, { projection: { displayName: 1, username: 1 } }) : null,
      head.batchId ? db.collection('supplyrequests').find({ clientUid: { $regex: '^short-' + String(head.batchId) + '-' }, deletedAt: null }, { projection: { num: 1, title: 1, status: 1, qty: 1, unit: 1 } }).toArray() : [],
    ]);
    const nm = new Map(mats.map((m) => [String(m._id), m]));
    const who = await this.core.issuedNames(issues);
    const lines = docs.map((d) => {
      const x = d as typeof d & Extra; const m = nm.get(String(d.materialId));
      const active = d.status === 'active';
      return { id: String(d._id), materialId: String(d.materialId), name: m?.name ?? '(позиция удалена)', unit: m?.unit ?? '', status: d.status,
        left: active ? d.qty : 0, issued: x.issuedQty ?? (d.status === 'fulfilled' ? d.qty : 0), canIssue: active && d.qty > 0,
        salesOrderLineId: x.salesOrderLineId ? String(x.salesOrderLineId) : null };
    });
    return {
      key, batchId: head.batchId ? String(head.batchId) : null, name: head.groupName || head.orderId || 'Бронь', createdAt: head.createdAt ?? null,
      createdBy: author ? String(author.displayName || author.username || '') : null,
      salesOrder: so ? { id: String(so._id), label: [so.orderNo, so.title].filter(Boolean).join(' · '), customer: so.customer ?? null } : null,
      hanging: hangingReason(so, head.salesOrderId),
      lines,
      issues: issues.map((mv) => ({ id: String(mv._id), date: mv.date, qty: mv.qty, name: nm.get(String(mv.materialId))?.name ?? '', unit: nm.get(String(mv.materialId))?.unit ?? '',
        to: who.get(String(mv._id)) ?? null, batchId: (mv as { batchId?: Types.ObjectId }).batchId ? String((mv as { batchId?: Types.ObjectId }).batchId) : null })),
      requests: (requests as { _id: Types.ObjectId; num?: number; title?: string; status?: string; qty?: number; unit?: string }[])
        .map((r) => ({ id: String(r._id), num: r.num ?? null, title: r.title ?? '', status: r.status ?? '', qty: r.qty ?? null, unit: r.unit ?? '' })),
    };
  }

}
