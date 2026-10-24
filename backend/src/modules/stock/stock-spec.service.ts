import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { Material, MaterialDocument } from '../material/material.schema';
import { Reservation, ReservationDocument } from './schemas/reservation.schema';
import { StockCoreService } from './stock-core.service';
import { StockReservationsService } from './stock-reservations.service';
import { buildIndex, matchRow, specGroupName, SPEC_PREFIX, type SpecMaterial } from './stock-match';
import { lookupOrderLines, resolveTarget } from './stock-target';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface PreviewLine { code?: string; name: string; qty: number; unit?: string; salesOrderLineId?: string }
interface ApplyLine { row?: number; materialId: string; qty: number; salesOrderLineId?: string; note?: string }

/**
 * Спецификация из Excel → брони под заказ (SK-6, СК-5, СК-9). Файл разбирает клиент и присылает JSON-строки.
 * preview ничего не пишет: сопоставляет строки с позициями склада и считает, хватает ли свободного.
 * apply ставит брони одной пачкой (общий batchId, groupName «Спецификация <дата>»); «заменить» снимает прежнюю загрузку.
 */
@Injectable()
export class StockSpecService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Reservation.name) private readonly reservations: Model<ReservationDocument>,
    @InjectModel(Material.name) private readonly materials: Model<MaterialDocument>,
    private readonly core: StockCoreService,
    private readonly resv: StockReservationsService,
  ) {}

  /** Просмотр до записи: matched (готово), short (не хватает свободного), notMatched (не найдено / неоднозначно / другая единица / чужая позиция). */
  async preview(dto: { salesOrderId: string; lines: PreviewLine[] }) {
    const db = this.connection.db!;
    const order = await resolveTarget(db, { salesOrderId: dto.salesOrderId });
    const orderId = order.salesOrderId as Types.ObjectId;
    const wh = await this.core.defaultWarehouse();
    // позиции склада — одним запросом (названия сравниваются в «нормальном виде», в базе так не найти), потом сопоставление в памяти
    const mats = await this.materials.find({ deletedAt: null }, { name: 1, unit: 1, article: 1, sku: 1, internalArticle: 1 }).lean().exec();
    const idx = buildIndex(mats.map((m) => ({ id: String(m._id), name: String(m.name), unit: m.unit, article: m.article, sku: m.sku, internalArticle: (m as { internalArticle?: string }).internalArticle })));
    const [stocks, ownLines, previous] = await Promise.all([
      db.collection('storageitems').find({ warehouseId: wh._id, deletedAt: null }, { projection: { materialId: 1, quantity: 1, reservedQty: 1, zoneName: 1 } }).sort({ zoneName: 1 }).toArray(),
      lookupOrderLines(db, orderId, dto.lines.map((l) => l.salesOrderLineId ?? '')),
      this.previousLoads(orderId),
    ]);
    // свободно считаем по той же строке остатка, куда встанет бронь (первая по зоне), и расходуем по ходу файла
    const free = new Map<string, number>();
    for (const s of stocks) if (!free.has(String(s.materialId))) free.set(String(s.materialId), Math.max(0, r3((Number(s.quantity) || 0) - (Number(s.reservedQty) || 0))));
    const matched: unknown[] = [], short: unknown[] = [], notMatched: unknown[] = [];
    dto.lines.forEach((l, row) => {
      const base = { row, code: l.code?.trim() || null, name: l.name, unit: l.unit?.trim() || null, qty: Number(l.qty) };
      const no = (reason: string, message: string, extra: Record<string, unknown> = {}) => notMatched.push({ ...base, reason, message, ...extra });
      if (!(base.qty > 0)) return no('badQty', 'Количество должно быть больше нуля');
      if (l.salesOrderLineId && !ownLines.has(l.salesOrderLineId)) return no('badLine', 'Позиция относится к другому заказу или не найдена');
      const m = matchRow(idx, l);
      if (m.kind === 'none') return no('notFound', 'На складе такой позиции нет — новую не создаём');
      const view = (x: SpecMaterial) => ({ materialId: x.id, name: x.name, unit: x.unit ?? '', article: x.article ?? null });
      if (m.kind === 'ambiguous') return no('ambiguous', 'Подходит несколько позиций — выберите нужную', { candidates: m.candidates.map(view) });
      if (m.kind === 'unit') return no('unit', `Другая единица: в файле «${l.unit}», на складе «${m.material.unit}»`, { ...view(m.material) });
      const mid = m.material.id, have = free.get(mid) ?? 0;
      const line = l.salesOrderLineId ? ownLines.get(l.salesOrderLineId) : undefined;
      const row0 = { ...base, ...view(m.material), by: m.by, need: base.qty, free: have, salesOrderLineId: l.salesOrderLineId ?? null, lineNo: line?.lineNo ?? null };
      if (have >= base.qty) { free.set(mid, r3(have - base.qty)); matched.push(row0); } else short.push({ ...row0, shortBy: r3(base.qty - have) });
    });
    return { salesOrderId: dto.salesOrderId, matched, short, notMatched, previous, counts: { total: dto.lines.length, matched: matched.length, short: short.length, notMatched: notMatched.length } };
  }

  /** Прежние загрузки спецификации этого заказа (активные брони) — чтобы спросить «заменить / добавить / отмена». */
  private async previousLoads(orderId: Types.ObjectId) {
    const rs = await this.reservations.find({ salesOrderId: orderId, status: 'active', deletedAt: null, groupName: { $regex: '^' + SPEC_PREFIX } }, { batchId: 1, groupName: 1, createdAt: 1 }).lean().exec();
    const by = new Map<string, { batchId: string | null; groupName: string; createdAt?: Date; count: number }>();
    for (const r of rs as (typeof rs[number] & { batchId?: Types.ObjectId; groupName?: string; createdAt?: Date })[]) {
      const k = r.batchId ? String(r.batchId) : String(r._id);
      const g = by.get(k) ?? { batchId: r.batchId ? String(r.batchId) : null, groupName: r.groupName ?? SPEC_PREFIX, createdAt: r.createdAt, count: 0 };
      g.count++;
      by.set(k, g);
    }
    return [...by.values()];
  }

  /**
   * Запись подтверждённых строк: брони одной пачкой. Нехватка свободного — строка пропускается и идёт в `skipped`
   * (`takeFree: true` — бронируется сколько свободно, остальное тоже в `skipped`). `replace` — сперва снять
   * активные брони прежней загрузки этого заказа. Повтор с тем же clientUid дублей не создаёт.
   */
  async apply(dto: { salesOrderId: string; lines: ApplyLine[]; replace?: boolean; takeFree?: boolean; clientUid?: string }, userId?: string) {
    const db = this.connection.db!;
    if (dto.clientUid) {
      const prev = await this.reservations.findOne({ clientUid: dto.clientUid }).lean().exec() as (ReservationDocument & { batchId?: Types.ObjectId; groupName?: string }) | null;
      if (prev) return { repeated: true, batchId: prev.batchId ? String(prev.batchId) : null, groupName: prev.groupName ?? '', created: prev.batchId ? await this.reservations.countDocuments({ batchId: prev.batchId }) : 1, replaced: 0, reserved: [], skipped: [] };
    }
    const orderId = (await resolveTarget(db, { salesOrderId: dto.salesOrderId })).salesOrderId as Types.ObjectId;
    const ownLines = await lookupOrderLines(db, orderId, dto.lines.map((l) => l.salesOrderLineId ?? ''));
    // одинаковая позиция склада под одну позицию заказа — одна бронь на сумму
    const merged = new Map<string, { materialId: Types.ObjectId; need: number; lineId?: Types.ObjectId; rows: number[]; note?: string }>();
    dto.lines.forEach((l, i) => {
      const n = Number(l.qty);
      if (!(n > 0)) throw new BadRequestException(`Строка ${(l.row ?? i) + 1}: количество должно быть больше нуля`);
      if (l.salesOrderLineId && !ownLines.has(l.salesOrderLineId)) throw new BadRequestException(`Строка ${(l.row ?? i) + 1}: позиция относится к другому заказу — обновите просмотр`);
      const key = `${l.materialId}|${l.salesOrderLineId ?? ''}`;
      const cur = merged.get(key) ?? { materialId: new Types.ObjectId(l.materialId), need: 0, lineId: l.salesOrderLineId ? new Types.ObjectId(l.salesOrderLineId) : undefined, rows: [], note: l.note?.trim() || undefined };
      cur.need = r3(cur.need + n); cur.rows.push(l.row ?? i);
      merged.set(key, cur);
    });
    const mats = await this.materials.find({ _id: { $in: [...merged.values()].map((m) => m.materialId) }, deletedAt: null }, { name: 1, unit: 1 }).lean().exec();
    const nm = new Map(mats.map((m) => [String(m._id), m]));
    const wh = await this.core.defaultWarehouse();
    const batchId = new Types.ObjectId();
    const groupName = specGroupName();
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const reserved: unknown[] = [], skipped: unknown[] = [];
    let replaced = 0;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        reserved.length = 0; skipped.length = 0; replaced = 0;
        if (dto.replace) {
          const olds = await this.reservations.find({ salesOrderId: orderId, status: 'active', deletedAt: null, groupName: { $regex: '^' + SPEC_PREFIX } }).session(session).exec();
          for (const r of olds) await this.resv.releaseWithin(r, session);
          replaced = olds.length;
        }
        let first = true;
        for (const m of merged.values()) {
          const mat = nm.get(String(m.materialId));
          const info = { rows: m.rows, materialId: String(m.materialId), name: mat?.name ?? '', unit: mat?.unit ?? '', salesOrderLineId: m.lineId ? String(m.lineId) : null };
          if (!mat) { skipped.push({ ...info, need: m.need, free: 0, reserved: 0, reason: 'Позиция склада не найдена или в корзине' }); continue; }
          const item = await this.core.loadStorage(wh._id as Types.ObjectId, m.materialId, session);
          const free = Math.max(0, r3((item.quantity ?? 0) - (item.reservedQty ?? 0)));
          const take = free >= m.need ? m.need : dto.takeFree ? free : 0;
          if (take < m.need) skipped.push({ ...info, need: m.need, free, reserved: take, reason: `Не хватает свободного: нужно ${m.need}, свободно ${free}` });
          if (take <= 0) continue;
          item.reservedQty = r3((item.reservedQty ?? 0) + take);
          await item.save({ session });
          await this.reservations.create([{ orderId: groupName, materialId: m.materialId, warehouseId: wh._id, qty: take, isActive: true, status: 'active', notes: m.note ?? groupName,
            batchId, groupName, createdBy, salesOrderId: orderId, ...(m.lineId ? { salesOrderLineId: m.lineId } : {}), ...(first && dto.clientUid ? { clientUid: dto.clientUid } : {}) }], { session });
          first = false;
          reserved.push({ ...info, qty: take });
        }
      });
    } finally { await session.endSession(); }
    return { repeated: false, batchId: String(batchId), groupName, created: reserved.length, replaced, reserved, skipped };
  }
}
