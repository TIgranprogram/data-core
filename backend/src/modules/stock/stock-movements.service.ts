import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { dateRange, oid, oids, parseList } from '../../common/list-query';
import { Material, MaterialDocument } from '../material/material.schema';
import { offcutName } from './metal';
import { Reservation, ReservationDocument } from './schemas/reservation.schema';
import { StockMovement, StockMovementDocument } from './schemas/stock-movement.schema';
import { StorageItemDocument } from './schemas/storage-item.schema';
import { StockCatalogService } from './stock-catalog.service';
import { StockCoreService } from './stock-core.service';
import { StockSearchService } from './stock-search.service';
import { prepareTarget, resolveTarget } from './stock-target';
import { type MoveInput, MOVE_LABEL, countGuard } from './stock.types';
import { type ByWeight, weightCount, weightGOf, weightNote } from './weight';

/** Движения остатка: приход / списание / пересчёт / корректировка / бронь, пакеты, отмена, журнал, обрезки. */
@Injectable()
export class StockMovementsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    @InjectModel(Reservation.name) private readonly reservations: Model<ReservationDocument>,
    @InjectModel(Material.name) private readonly materials: Model<MaterialDocument>,
    private readonly core: StockCoreService,
    private readonly search: StockSearchService,
    private readonly catalog: StockCatalogService,
  ) {}

  /**
   * Движение по позиции. in/out/adjust — как в CRM (остаток в storageitems + запись в stockmovements);
   * reserve/unreserve — reservedQty + reservations. Повтор с тем же clientUid ничего не меняет.
   */
  async move(materialId: string, dto: MoveInput, userId?: string, first?: (session: ClientSession) => Promise<void>) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    if (dto.byWeight) dto = await this.applyWeight(materialId, dto);
    const qty = Number(dto.qty);
    if (!Number.isFinite(qty) || (!['adjust', 'count'].includes(dto.type) && qty <= 0) || (dto.type === 'adjust' && qty === 0) || (dto.type === 'count' && qty < 0)) {
      throw new BadRequestException('Укажите количество');
    }
    if (dto.clientUid) {
      const done = (await this.movements.exists({ clientUid: dto.clientUid })) || (await this.reservations.exists({ clientUid: dto.clientUid }));
      if (done) return this.search.getItem(materialId);
    }
    const matId = new Types.ObjectId(materialId);
    if (!(await this.materials.exists({ _id: matId, deletedAt: null }))) throw new NotFoundException('Позиция не найдена');
    const wh = await this.core.defaultWarehouse();
    const note = dto.note?.trim() || undefined;
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    // кому / под что, причина списания, возврат (SK-5): проверки до транзакции
    const target = await prepareTarget(this.connection.db!, dto);
    // бронь под заказ / позицию заказа (SK-6): позиция без заказа — заказ берёт сервер; чужая позиция — 400
    const resTarget = dto.type === 'reserve' && (dto.salesOrderId || dto.salesOrderLineId) ? await resolveTarget(this.connection.db!, dto) : {};

    let repeat = false;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        repeat = false;
        // повтор проверяется внутри транзакции первой строкой: параллельный двойной вызов не проведёт движение дважды (HARDEN-1 п.5)
        if (dto.clientUid) {
          const done = (await this.movements.findOne({ clientUid: dto.clientUid }, { _id: 1 }).session(session).lean().exec()) || (await this.reservations.findOne({ clientUid: dto.clientUid }, { _id: 1 }).session(session).lean().exec());
          if (done) { repeat = true; return; }
        }
        if (first) await first(session);
        const item = await this.core.loadStorage(wh._id as Types.ObjectId, matId, session);
        const before = item.quantity ?? 0;
        // «было → стало» у каждого движения (ФИ.5)
        const movement = (type: 'in' | 'out' | 'adjust', q: number, ref: string | undefined, delta: number) =>
          this.movements.create([{ type, date: new Date(), materialId: matId, warehouseId: wh._id, qty: q, delta, documentRef: ref, notes: note, clientUid: dto.clientUid, createdBy,
            qtyBefore: before, qtyAfter: Math.round((before + delta) * 1000) / 1000, ...(dto.cancelOf ? { cancelOf: dto.cancelOf } : {}), ...(type === 'out' || (type === 'in' && dto.isReturn) ? target : {}) }], { session });

        if (dto.type === 'in') {
          item.quantity = (item.quantity ?? 0) + qty;
          await item.save({ session });
          await movement('in', qty, dto.documentRef, qty);
        } else if (dto.type === 'out') {
          if ((item.quantity ?? 0) < qty) throw new BadRequestException(`Недостаточно на складе: есть ${item.quantity ?? 0}, нужно ${qty}`);
          item.quantity = (item.quantity ?? 0) - qty;
          if ((item.reservedQty ?? 0) > 0) item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - qty);
          await item.save({ session });
          await movement('out', qty, dto.documentRef, -qty);
        } else if (dto.type === 'count') {
          // ФИ.4: человек ввёл, сколько лежит ВСЕГО; разницу считает сервер от своего остатка (не от числа на экране)
          if (dto.expected !== undefined && Math.abs(Number(dto.expected) - before) > 1e-9) {
            throw new ConflictException(`Остаток изменился, пока была открыта карточка: было ${dto.expected}, сейчас ${before}. Обновите карточку и пересчитайте ещё раз`);
          }
          const why = countGuard(qty, before, item.reservedQty ?? 0, dto.force);
          if (why) throw qty < 0 ? new BadRequestException(why) : new ConflictException(why);
          const delta = Math.round((qty - before) * 1000) / 1000;
          if (delta !== 0) {
            item.quantity = qty;
            item.reservedQty = Math.min(item.reservedQty ?? 0, qty);
            await item.save({ session });
            await movement('adjust', Math.abs(delta), `ADJUST:${note ?? 'пересчёт'}`, delta);
          }
          await this.connection.db!.collection('storageitems').updateOne({ _id: item._id }, { $set: { lastCountedAt: new Date() } }, { session });
        } else if (dto.type === 'adjust') {
          const next = (item.quantity ?? 0) + qty;
          if (next < 0) throw new BadRequestException(`Остаток не может стать отрицательным (${next})`);
          const why = countGuard(next, before, item.reservedQty ?? 0, dto.force);
          if (why) throw new ConflictException(why);
          item.quantity = next;
          item.reservedQty = Math.min(item.reservedQty ?? 0, next); // бронь не больше остатка (HARDEN-1 п.7)
          await item.save({ session });
          await movement('adjust', Math.abs(qty), `ADJUST:${note ?? 'корректировка'}`, qty);
        } else if (dto.type === 'reserve') {
          const free = (item.quantity ?? 0) - (item.reservedQty ?? 0);
          if (free < qty) throw new BadRequestException(`Недостаточно свободного остатка: ${free}, нужно ${qty}`);
          item.reservedQty = (item.reservedQty ?? 0) + qty;
          await item.save({ session });
          await this.reservations.create([{ orderId: note ?? 'Бронь', materialId: matId, warehouseId: wh._id, qty, isActive: true, status: 'active', notes: note, clientUid: dto.clientUid,
            ...(resTarget.salesOrderId ? { salesOrderId: resTarget.salesOrderId } : {}), ...(resTarget.salesOrderLineId ? { salesOrderLineId: resTarget.salesOrderLineId } : {}) }], { session });
        } else if (dto.type === 'unreserve') {
          let left = Math.min(qty, item.reservedQty ?? 0);
          if (left <= 0) throw new BadRequestException('Брони по позиции нет');
          item.reservedQty = (item.reservedQty ?? 0) - left;
          await item.save({ session });
          const active = await this.reservations.find({ materialId: matId, warehouseId: wh._id, status: 'active', deletedAt: null }).sort({ createdAt: 1 }).session(session).exec();
          for (const r of active) {
            if (left <= 0) break;
            if (r.qty <= left) { left -= r.qty; r.status = 'released'; r.isActive = false; }
            else { r.qty -= left; left = 0; }
            await r.save({ session });
          }
          // Запись-след снятия брони (история + защита от повтора по clientUid)
          await this.reservations.create([{ orderId: note ?? 'Снятие брони', materialId: matId, warehouseId: wh._id, qty, isActive: false, status: 'released', notes: note ?? 'снятие брони', clientUid: dto.clientUid }], { session });
        } else {
          throw new BadRequestException('Неизвестный тип движения');
        }
      });
    } finally {
      await session.endSession();
    }
    if (!repeat) await this.core.markEdited(matId);
    return this.search.getItem(materialId);
  }

  /**
   * Пакет операций (экран «Операции»): несколько позиций одной транзакцией — всё или ничего.
   * out — проверяет все позиции заранее и называет каждую, где не хватает; count — qty = сколько лежит
   * фактически: проводит корректировку на разницу и ставит дату пересчёта (`lastCountedAt`, поле вне схемы CRM).
   * Все движения пакета помечены `batchId` — отменяются одной кнопкой.
   */
  async batch(dto: { type: 'in' | 'out' | 'count'; lines: { materialId: string; qty: number; note?: string; expected?: number }[]; note?: string; documentRef?: string; clientUid?: string; salesOrderId?: string; salesOrderLineId?: string; personId?: string; issuedTo?: string; reason?: string; writeOff?: boolean; isReturn?: boolean; force?: boolean }, userId?: string) {
    if (dto.clientUid) {
      const prev = await this.movements.findOne({ clientUid: dto.clientUid, batchId: { $ne: null } }).lean().exec();
      if (prev) return this.batchResult(String((prev as { batchId?: Types.ObjectId }).batchId), dto.type);
    }
    // Одна позиция дважды — складываем (приход/списание) или берём последнюю (пересчёт)
    const merged = new Map<string, number>();
    const lineNote = new Map<string, string>(); // расчёт по весу у строки (НО)
    for (const l of dto.lines) {
      if (l.note?.trim()) lineNote.set(l.materialId, l.note.trim());
      const n = Number(l.qty);
      if (!Number.isFinite(n) || n < 0 || (dto.type !== 'count' && n === 0)) throw new BadRequestException('Укажите количество больше нуля в каждой строке');
      merged.set(l.materialId, dto.type === 'count' ? n : (merged.get(l.materialId) ?? 0) + n);
    }
    const matIds = [...merged.keys()].map((id) => oid(id, 'позиции'));
    const mats = await this.materials.find({ _id: { $in: matIds }, deletedAt: null }, { name: 1 }).lean().exec();
    if (mats.length !== matIds.length) throw new NotFoundException('Часть позиций не найдена (удалены?) — обновите страницу');
    const nameOf = new Map(mats.map((m) => [String(m._id), String(m.name)]));
    const wh = await this.core.defaultWarehouse();
    const note = dto.note?.trim() || undefined;
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const batchId = new Types.ObjectId();
    const now = new Date();
    let moved = 0;
    let repeatBatch: string | undefined;
    // Под заказ / позицию / сотрудник, причина списания, возврат (SK-5) — одной проверкой, как в одиночном движении
    const soRef = await prepareTarget(this.connection.db!, dto);
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        moved = 0; repeatBatch = undefined;
        if (dto.clientUid) { // повтор — внутри транзакции первой строкой (HARDEN-1 п.5)
          const prev = await this.movements.findOne({ clientUid: dto.clientUid, batchId: { $ne: null } }).session(session).lean().exec();
          if (prev) { repeatBatch = String((prev as { batchId?: Types.ObjectId }).batchId); return; }
        }
        const items = new Map<string, StorageItemDocument>();
        for (const id of matIds) items.set(String(id), await this.core.loadStorage(wh._id as Types.ObjectId, id, session));
        if (dto.type === 'out') {
          const short = [...merged].filter(([id, n]) => (items.get(id)!.quantity ?? 0) < n)
            .map(([id, n]) => `«${nameOf.get(id)}»: есть ${items.get(id)!.quantity ?? 0}, нужно ${n}`);
          if (short.length) throw new BadRequestException(`Недостаточно на складе — ${short.join('; ')}`);
        }
        if (dto.type === 'count') {
          // остаток изменился, пока человек считал (expected — что он видел) — как у одиночного пересчёта
          const moved2 = dto.lines.filter((l) => l.expected !== undefined && Math.abs(Number(l.expected) - (items.get(l.materialId)?.quantity ?? 0)) > 1e-9)
            .map((l) => `«${nameOf.get(l.materialId)}»: было ${l.expected}, сейчас ${items.get(l.materialId)?.quantity ?? 0}`);
          if (moved2.length) throw new ConflictException(`Остаток изменился, пока шёл пересчёт — ${moved2.join('; ')}. Обновите и посчитайте заново`);
        }
        if (dto.type === 'count' && !dto.force) {
          // ФИ.4: пересчёт ниже брони — только с подтверждением
          const low = [...merged].filter(([id, n]) => n < (items.get(id)!.reservedQty ?? 0))
            .map(([id, n]) => `«${nameOf.get(id)}»: лежит ${n}, в брони ${items.get(id)!.reservedQty}`);
          if (low.length) throw new ConflictException(`Меньше, чем в брони — ${low.join('; ')}. Сначала снимите или выдайте бронь — или подтвердите`);
        }
        for (const [id, n] of merged) {
          const item = items.get(id)!;
          const before = item.quantity ?? 0;
          const delta = dto.type === 'in' ? n : dto.type === 'out' ? -n : Math.round((n - before) * 1000) / 1000;
          if (delta !== 0) {
            item.quantity = Math.round((before + delta) * 1000) / 1000;
            item.reservedQty = Math.min(item.reservedQty ?? 0, item.quantity); // бронь не больше остатка (HARDEN-1 п.7)
            if (dto.type === 'out' && (item.reservedQty ?? 0) > 0) item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - n);
            await item.save({ session });
            const type = dto.type === 'count' ? 'adjust' : dto.type;
            const ref = dto.type === 'count' ? `ADJUST:${note ?? 'пересчёт'}` : dto.documentRef;
            await this.movements.create([{ type, date: now, materialId: new Types.ObjectId(id), warehouseId: wh._id, qty: Math.abs(delta), delta, documentRef: ref, qtyBefore: before, qtyAfter: item.quantity,
              notes: [note, lineNote.get(id)].filter(Boolean).join('; ') || (dto.type === 'count' ? 'пересчёт' : undefined), clientUid: moved === 0 ? dto.clientUid : undefined, createdBy, batchId, ...soRef }], { session });
            moved++;
          }
          if (dto.type === 'count') {
            await this.connection.db!.collection('storageitems').updateOne({ _id: item._id }, { $set: { lastCountedAt: now } }, { session });
          }
        }
      });
    } finally {
      await session.endSession();
    }
    if (repeatBatch) return this.batchResult(repeatBatch, dto.type);
    await this.connection.db!.collection('materials').updateMany({ _id: { $in: matIds } }, { $set: { editedInApp: true } });
    return { ...(await this.batchResult(String(batchId), dto.type, matIds)), lines: merged.size, moved };
  }

  async batchResult(batchId: string, type: string, matIds?: Types.ObjectId[]) {
    const ids = matIds ?? ((await this.movements.distinct('materialId', { batchId: new Types.ObjectId(batchId) }).exec()) as Types.ObjectId[]);
    const items = ids.length ? (await this.search.listItems({ materialIds: ids, limit: 10000 })).items : [];
    return { batchId, type, items };
  }

  /** Отменить пакет: обратные движения ко всем его неотменённым движениям, одной транзакцией. */
  async cancelBatch(batchId: string, userId?: string) {
    const bid = oid(batchId, 'операции');
    const list = await this.movements.find({ batchId: bid, cancelledAt: null, deletedAt: null }).lean().exec();
    if (!list.length) throw new NotFoundException('Операция не найдена или уже отменена');
    const wh = await this.core.defaultWarehouse();
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const now = new Date();
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        for (const mv of list) {
          // запись занимается первой: параллельная отмена той же операции получит 409, остаток вернётся один раз
          const claim = await this.movements.updateOne({ _id: mv._id, cancelledAt: null }, { $set: { cancelledAt: now } }, { session }).exec();
          if (!claim.matchedCount) throw new ConflictException('Операция уже отменена');
          const d = (mv as { delta?: number }).delta ?? 0;
          const item = await this.core.loadStorage(wh._id as Types.ObjectId, mv.materialId as Types.ObjectId, session);
          const next = Math.round(((item.quantity ?? 0) - d) * 1000) / 1000;
          if (next < 0) {
            const m = await this.materials.findById(mv.materialId, { name: 1 }).lean().exec();
            throw new ConflictException(`Нельзя отменить: «${m?.name ?? 'позиция'}» уже израсходована (остаток станет ${next}). Сделайте пересчёт вручную.`);
          }
          item.quantity = next;
          item.reservedQty = Math.min(item.reservedQty ?? 0, next);
          // выдача по брони отменена — бронь возвращается (TASKS Б.2)
          const resId = (mv as { reservationId?: Types.ObjectId }).reservationId;
          if (resId && d < 0) {
            const r = await this.reservations.findById(resId).session(session).exec();
            if (r) {
              const back = Math.abs(d);
              r.qty = (r.status === 'active' ? r.qty : 0) + back;
              r.issuedQty = Math.max(0, (r.issuedQty ?? 0) - back);
              r.status = 'active'; r.isActive = true;
              await r.save({ session });
              item.reservedQty = (item.reservedQty ?? 0) + back;
            }
          }
          await item.save({ session });
          const when = new Date(mv.date).toLocaleDateString('ru-RU');
          const back = mv.type === 'adjust' ? 'adjust' : d > 0 ? 'out' : 'in';
          await this.movements.create([{ type: back, date: now, materialId: mv.materialId, warehouseId: wh._id, qty: Math.abs(d), delta: -d,
            documentRef: back === 'adjust' ? 'ADJUST:отмена пересчёта' : undefined, notes: `Отмена: ${MOVE_LABEL[mv.type] ?? mv.type} от ${when}`, createdBy, cancelOf: mv._id }], { session });
        }
      });
    } finally {
      await session.endSession();
    }
    return this.batchResult(batchId, 'cancel');
  }
  /**
   * Обрезок, который ещё пригодится (TASKS СМ.2): своя позиция «<позиция> — обрезок 1,2 м» (шт, `offcutOf`, размеры),
   * находится или создаётся; приход count шт. Труба (в метрах) — эти метры уходят из родителя (кусок отделили);
   * лист — родитель не меняется (лист уже списан целиком, обрезок — то, что осталось). Пакет — «Отменить» целиком.
   */
  async offcut(materialId: string, dto: { lengthMm: number; widthMm?: number; count?: number; note?: string; clientUid?: string }, userId?: string) {
    if (dto.clientUid) { // повтор (двойной тап, офлайн-очередь) — вернуть прежний результат
      const prev = await this.movements.findOne({ clientUid: dto.clientUid, batchId: { $ne: null } }).lean().exec() as { batchId?: Types.ObjectId; materialId?: Types.ObjectId } | null;
      if (prev) return this.offcutResult(materialId, String(prev.batchId), String(prev.materialId));
    }
    const parent = await this.search.getItem(materialId);
    if (parent.offcutOf) throw new BadRequestException('Это уже обрезок — отрежьте от основной позиции');
    if (!parent.metal) throw new BadRequestException('Обрезки — только у труб и листов (категория «…труба…» / «…лист…»)');
    const len = Math.round(Number(dto.lengthMm)), wid = dto.widthMm ? Math.round(Number(dto.widthMm)) : undefined, count = Math.max(1, Math.round(Number(dto.count ?? 1)));
    if (!(len > 0)) throw new BadRequestException('Укажите длину обрезка');
    if (parent.metal === 'sheet' && !(wid && wid > 0)) throw new BadRequestException('Укажите оба размера обрезка листа');
    const takeM = parent.metal === 'pipe' ? Math.round((len / 1000) * count * 1000) / 1000 : 0;
    if (takeM > parent.quantity) throw new BadRequestException(`На складе ${parent.quantity} м — обрезок ${takeM} м отделить нельзя`);
    const name = offcutName(parent.name, parent.metal, len, wid);
    let kid = await this.catalog.findMaterialByName(name);
    if (!kid) {
      const created = await this.catalog.createItem({ name, unit: 'шт', categoryId: parent.categoryId ?? undefined, assortment: parent.assortment, materialGrade: parent.materialGrade,
        dims: { ...parent.dims, length: len, ...(wid ? { width: wid } : {}) }, notes: `Обрезок позиции «${parent.name}»` });
      kid = await this.materials.findById(created.id).exec();
    }
    await this.connection.db!.collection('materials').updateOne({ _id: kid!._id }, { $set: { offcutOf: new Types.ObjectId(materialId) } });
    const wh = await this.core.defaultWarehouse();
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const batchId = new Types.ObjectId(); const now = new Date();
    const note = dto.note?.trim() || `обрезок ${name.split(' — обрезок ')[1]}`;
    let repeat: { batchId: string; materialId: string } | undefined;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        repeat = undefined;
        if (dto.clientUid) {
          const prev = await this.movements.findOne({ clientUid: dto.clientUid, batchId: { $ne: null } }).session(session).lean().exec() as { batchId?: Types.ObjectId; materialId?: Types.ObjectId } | null;
          if (prev) { repeat = { batchId: String(prev.batchId), materialId: String(prev.materialId) }; return; }
        }
        if (takeM > 0) {
          const p = await this.core.loadStorage(wh._id as Types.ObjectId, new Types.ObjectId(materialId), session);
          if ((p.quantity ?? 0) < takeM) throw new BadRequestException(`На складе ${p.quantity ?? 0} м — обрезок ${takeM} м отделить нельзя`);
          p.quantity = Math.round(((p.quantity ?? 0) - takeM) * 1000) / 1000;
          await p.save({ session });
          await this.movements.create([{ type: 'out', date: now, materialId: new Types.ObjectId(materialId), warehouseId: wh._id, qty: takeM, delta: -takeM, notes: `В обрезки: ${note}`, createdBy, batchId }], { session });
        }
        const k = await this.core.loadStorage(wh._id as Types.ObjectId, kid!._id as Types.ObjectId, session);
        k.quantity = (k.quantity ?? 0) + count;
        await k.save({ session });
        await this.movements.create([{ type: 'in', date: now, materialId: kid!._id, warehouseId: wh._id, qty: count, delta: count, notes: note, createdBy, batchId, clientUid: dto.clientUid }], { session });
      });
    } finally {
      await session.endSession();
    }
    if (repeat) return this.offcutResult(materialId, repeat.batchId, repeat.materialId);
    return this.offcutResult(materialId, String(batchId), String(kid!._id));
  }

  private async offcutResult(parentId: string, batchId: string, offcutId: string) {
    return { batchId, parent: await this.search.getItem(parentId), offcut: await this.search.getItem(offcutId) };
  }

  /**
   * По весу (TASKS НО.3): штуки = общий вес ÷ вес 1 шт. (образец или из позиции), в примечание — расчёт;
   * вес 1 шт. сохраняется в позицию, если его не было, или если отличается > 10% и это подтверждено (saveUnitWeight).
   * Только для позиций в штуках, только приход и пересчёт.
   */
  private async applyWeight(materialId: string, dto: MoveInput): Promise<MoveInput> {
    if (!['in', 'count'].includes(dto.type)) throw new BadRequestException('По весу — только приход и пересчёт');
    const mat = await this.connection.db!.collection('materials').findOne({ _id: new Types.ObjectId(materialId), deletedAt: null }, { projection: { unit: 1, weightKg: 1, weightUnit: 1 } });
    if (!mat) throw new NotFoundException('Позиция не найдена');
    if (String(mat.unit || 'шт').toLowerCase() !== 'шт') throw new BadRequestException(`По весу считаются только штуки (у позиции «${mat.unit}»)`);
    const bw = dto.byWeight!;
    const known = weightGOf(mat as { weightKg?: unknown; weightUnit?: unknown }) ?? undefined;
    const w: ByWeight = { ...bw, unitWeightG: bw.sampleCount !== undefined ? undefined : bw.unitWeightG ?? known };
    const r = weightCount(w);
    if (!r.ok) throw new BadRequestException(r.errors.join('; ') || 'Не получилось посчитать штуки по весу');
    const differs = known ? Math.abs((r.unitWeightG ?? 0) - known) / known > 0.1 : true;
    if (!known || (differs && bw.saveUnitWeight)) await this.core.setWeightG(mat._id as Types.ObjectId, r.unitWeightG);
    const note = [dto.note?.trim(), weightNote(w, r)].filter(Boolean).join('; ');
    return { ...dto, qty: r.count!, note, byWeight: undefined };
  }
  /** История позиции: движения склада и брони, новые сверху. */
  async history(materialId: string, limit?: number) {
    if (!Types.ObjectId.isValid(materialId)) throw new BadRequestException('Некорректный id позиции');
    const matId = new Types.ObjectId(materialId);
    const [mv, rs] = await Promise.all([
      this.movements.find({ materialId: matId, deletedAt: null }).sort({ date: -1 }).limit(200).lean().exec(),
      this.reservations.find({ materialId: matId, deletedAt: null }).sort({ createdAt: -1 }).limit(200).lean().exec(),
    ]);
    const items = [
      ...mv.map((m) => ({ kind: 'movement', type: m.type, qty: m.qty, date: m.date, note: m.notes ?? (m.documentRef?.startsWith('ADJUST:') ? m.documentRef.slice(7) : m.documentRef), source: (m as { source?: string }).source,
        // «под что» для подписи в карточке позиции (SK-5): как в журнале движений
        salesOrderId: m.salesOrderId ? String(m.salesOrderId) : null, salesOrderLineId: m.salesOrderLineId ? String(m.salesOrderLineId) : null,
        isReturn: !!(m as { isReturn?: boolean }).isReturn, reason: (m as { reason?: string }).reason ?? null, issuedTo: m.issuedTo ?? null })),
      ...rs.map((r) => ({ kind: 'reservation', type: r.status === 'released' && r.isActive === false && /снят/i.test(r.notes ?? r.orderId) ? 'unreserve' : 'reserve', status: r.status, qty: r.qty, date: (r as { createdAt?: Date }).createdAt, note: r.notes ?? r.orderId })),
    ].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
    // limit (1–200) — только последние N записей (карточка позиции: 5); total — всего
    const n = Math.floor(Number(limit));
    return { items: n > 0 ? items.slice(0, Math.min(n, 200)) : items, total: items.length };
  }
  /**
   * Журнал движений по всем позициям (раздел «Движения»): страницы, тип, период, позиция, поиск по наименованию.
   * `delta` — изменение остатка со знаком; у записей из Google-таблицы остаток по ним не менялся (source).
   */
  async listMovements(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: ['date', 'qty', 'type', 'createdAt'], defaultSort: '-date', defaultLimit: 50, maxLimit: 500 });
    const filter: Record<string, unknown> = { deletedAt: null, materialId: { $ne: null } };
    if (q.type) filter.type = { $in: String(q.type).split(',') };
    const range = dateRange(q.from, q.to);
    if (range) filter.date = range;
    if (q.materialId) filter.materialId = { $in: oids(q.materialId) };
    if (q.scopeCategoryId) { // СМ.4: журнал только по категориям роли
      const ids = oids(q.scopeCategoryId);
      const own = await this.materials.find({ categoryId: { $in: [...ids, ...ids.map(String)] } }, { _id: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
      const wanted = q.materialId ? new Set(oids(q.materialId).map(String)) : null;
      filter.materialId = { $in: own.map((m) => m._id).filter((id) => !wanted || wanted.has(String(id))) };
    }
    // кому выдано / под какой заказ (карточка сотрудника, карточка заказчика)
    if (q.personId) filter.issuedToPersonId = oid(q.personId, 'сотрудника');
    if (q.salesOrderId) filter.salesOrderId = { $in: oids(q.salesOrderId) };
    if (q.id) filter._id = oid(q.id, 'движения');
    if (p.search) {
      const mats = await this.materials.find({ $or: [{ name: p.search }, { article: p.search }] }, { _id: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec();
      filter.$or = [{ materialId: { $in: mats.map((m) => m._id) } }, { notes: p.search }, { issuedTo: p.search }];
    }
    const [docs, total] = await Promise.all([
      this.movements.find(filter).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
      this.movements.countDocuments(filter).exec(),
    ]);
    const mats = await this.materials.find({ _id: { $in: docs.map((d) => d.materialId) } }, { name: 1, unit: 1, deletedAt: 1 })
      .setOptions({ includeSoftDeleted: true }).lean().exec();
    const byId = new Map(mats.map((m) => [String(m._id), m]));
    const users = await this.connection.db!.collection('users')
      .find({ _id: { $in: docs.map((d) => d.createdBy).filter(Boolean) as Types.ObjectId[] } }, { projection: { displayName: 1, username: 1 } }).toArray();
    const userName = new Map(users.map((u) => [String(u._id), String(u.displayName || u.username)]));
    const issued = await this.core.issuedNames(docs as never);
    const items = docs.map((m) => {
      const mat = byId.get(String(m.materialId));
      const d = m as typeof m & { delta?: number; cancelledAt?: Date; cancelOf?: Types.ObjectId; source?: string };
      return {
        id: String(m._id), date: m.date, type: m.type, typeLabel: MOVE_LABEL[m.type] ?? m.type, qty: m.qty,
        delta: d.delta ?? (m.type === 'out' ? -m.qty : m.qty),
        materialId: String(m.materialId), materialName: mat?.name ?? '(позиция удалена)', unit: mat?.unit ?? '',
        note: m.notes ?? (m.documentRef?.startsWith('ADJUST:') ? m.documentRef.slice(7) : m.documentRef) ?? '',
        source: d.source ?? null, fromSheet: d.source === 'google-sheets',
        cancelledAt: d.cancelledAt ?? null, cancelOf: d.cancelOf ? String(d.cancelOf) : null,
        createdBy: m.createdBy ? userName.get(String(m.createdBy)) ?? null : null,
        // для карточки движения: операция пакетом, под какой заказ (кликабельно в приложении)
        batchId: (m as { batchId?: Types.ObjectId }).batchId ? String((m as { batchId?: Types.ObjectId }).batchId) : null,
        salesOrderId: (m as { salesOrderId?: Types.ObjectId }).salesOrderId ? String((m as { salesOrderId?: Types.ObjectId }).salesOrderId) : null,
        issuedTo: issued.get(String(m._id)) ?? null,
        // SK-5: под какую позицию заказа, причина списания, возврат
        salesOrderLineId: (m as { salesOrderLineId?: Types.ObjectId }).salesOrderLineId ? String((m as { salesOrderLineId?: Types.ObjectId }).salesOrderLineId) : null,
        reason: (m as { reason?: string }).reason ?? null, isReturn: (m as { isReturn?: boolean }).isReturn === true,
        reservationId: (m as { reservationId?: Types.ObjectId }).reservationId ? String((m as { reservationId?: Types.ObjectId }).reservationId) : null,
        canCancel: d.source !== 'google-sheets' && !d.cancelledAt && !d.cancelOf && m.type !== 'transfer' && d.delta !== undefined,
        qtyBefore: (m as { qtyBefore?: number }).qtyBefore ?? null, qtyAfter: (m as { qtyAfter?: number }).qtyAfter ?? null,
      };
    });
    return { items, total, page: p.page, limit: p.limit };
  }

  /**
   * Отменить ошибочное движение: проводится обратное (история не стирается), исходное помечается отменённым.
   * Записи из Google-таблицы не отменяются — остаток по ним не менялся.
   */
  /** Позиция движения — для проверки категорий роли (СМ.4). */
  async movementMaterialId(id: string) {
    const mv = await this.movements.findOne({ _id: oid(id, 'движения'), deletedAt: null }, { materialId: 1 }).lean().exec();
    if (!mv?.materialId) throw new NotFoundException('Движение не найдено');
    return String(mv.materialId);
  }

  /** Исправить списание (СМ.5): старое отменяется обратным движением, новое проводится с теми же «кому» и «под что». */
  async correctMovement(id: string, qty: number, userId?: string) {
    const mv = await this.movements.findOne({ _id: oid(id, 'движения'), deletedAt: null }).lean().exec();
    if (!mv) throw new NotFoundException('Движение не найдено');
    const d = mv as typeof mv & { cancelledAt?: Date; delta?: number; reason?: string; issuedTo?: string; issuedToPersonId?: Types.ObjectId; salesOrderId?: Types.ObjectId; salesOrderLineId?: Types.ObjectId; reservationId?: Types.ObjectId };
    if (mv.type !== 'out') throw new ConflictException('Исправить можно только списание');
    if (d.reservationId) throw new ConflictException('Это выдача по брони — отмените её и выдайте заново');
    const was = Math.abs(Number(d.delta));
    // остаток проверяется до отмены: иначе старое списание отменится, а новое не пройдёт
    const have = await this.search.getItem(String(mv.materialId));
    if (!d.cancelledAt && Number(have.quantity) + was < qty) throw new BadRequestException(`Недостаточно на складе: после отмены будет ${Math.round((Number(have.quantity) + was) * 1000) / 1000}, нужно ${qty}`);
    await this.cancelMovement(id, userId);
    return this.move(String(mv.materialId), {
      type: 'out', qty, note: `Исправлено: было ${was}`, reason: d.reason, writeOff: !!d.reason, issuedTo: d.issuedTo,
      personId: d.issuedToPersonId ? String(d.issuedToPersonId) : undefined, salesOrderId: d.salesOrderId ? String(d.salesOrderId) : undefined, salesOrderLineId: d.salesOrderLineId ? String(d.salesOrderLineId) : undefined,
    } as MoveInput, userId);
  }

  async cancelMovement(id: string, userId?: string) {
    const mv = await this.movements.findOne({ _id: oid(id, 'движения'), deletedAt: null }).lean().exec();
    if (!mv) throw new NotFoundException('Движение не найдено');
    const d = mv as typeof mv & { delta?: number; cancelledAt?: Date; cancelOf?: Types.ObjectId; source?: string; reservationId?: Types.ObjectId };
    if (d.reservationId && (d.delta ?? 0) < 0) throw new ConflictException('Это выдача по брони — отмените её через «Выдано по брони» (операцию целиком), бронь вернётся сама');
    if (d.source === 'google-sheets') throw new ConflictException('Это запись истории из Google-таблицы: остаток по ней не менялся, отменять нечего');
    if (d.cancelledAt) throw new ConflictException('Движение уже отменено');
    if (d.cancelOf) throw new ConflictException('Это само отмена — проведите новое движение');
    if (d.delta === undefined || !mv.materialId) throw new ConflictException('Это движение создано в CRM — отмените его там или сделайте корректировку');
    const when = new Date(mv.date).toLocaleDateString('ru-RU');
    const note = `Отмена: ${MOVE_LABEL[mv.type] ?? mv.type} от ${when}`;
    const back: MoveInput = d.delta > 0 ? { type: 'out', qty: d.delta, note } : { type: 'in', qty: -d.delta, note };
    if (mv.type === 'adjust') { back.type = 'adjust'; back.qty = -d.delta; }
    back.cancelOf = mv._id as Types.ObjectId;
    // запись занимается условием cancelledAt: null в той же транзакции, что и обратное движение — двойная отмена остаток не вернёт дважды
    return this.move(String(mv.materialId), back, userId, async (session) => {
      const claim = await this.movements.updateOne({ _id: mv._id, cancelledAt: null }, { $set: { cancelledAt: new Date() } }, { session }).exec();
      if (!claim.matchedCount) throw new ConflictException('Движение уже отменено');
    });
  }

}
