import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Shipment,
  ShipmentDocument,
  ShipmentItem,
  ShippingDoc,
  ShipmentStatus,
} from './shipment.schema';
import { Order, OrderDocument } from '../order/order.schema';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { AddDocDto } from './dto/add-doc.dto';
import { CounterService } from '../counter/counter.service';
import { StockMovementService } from '../stock-movement/stock-movement.service';
import { ReservationService } from '../reservation/reservation.service';
import { SessionRunner } from '../../common/db/session-runner';

@Injectable()
export class ShipmentService {
  constructor(
    @InjectModel(Shipment.name)
    private readonly model: Model<ShipmentDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly counter: CounterService,
    private readonly stockMovementService: StockMovementService,
    private readonly reservationService: ReservationService,
    private readonly sessionRunner: SessionRunner,
  ) {}

  async create(
    dto: CreateShipmentDto,
    organizationId?: string | null,
  ): Promise<ShipmentDocument> {
    const number = dto.number ?? (await this.counter.next('Shipment', 'SHP'));
    const items: ShipmentItem[] = dto.items.map((i) => ({
      productId: new Types.ObjectId(i.productId),
      productName: i.productName,
      quantity: i.quantity,
      unit: i.unit,
    }));
    return this.model.create({
      number,
      orderId: new Types.ObjectId(dto.orderId),
      ...this.organizationWrite(organizationId),
      counterpartyId: new Types.ObjectId(dto.counterpartyId),
      date: dto.date ? new Date(dto.date) : new Date(),
      recipient: dto.recipient,
      address: dto.address,
      status: dto.status ?? 'draft',
      driverInfo: dto.driverInfo,
      warehouseId: dto.warehouseId ? new Types.ObjectId(dto.warehouseId) : undefined,
      notes: dto.notes,
      items,
    });
  }

  async findAll(
    orderId?: string,
    status?: string,
    date?: Date,
    organizationId?: string | null,
  ): Promise<ShipmentDocument[]> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      ...this.organizationFilter(organizationId),
    };
    if (orderId) {
      if (!Types.ObjectId.isValid(orderId)) return [];
      filter.orderId = new Types.ObjectId(orderId);
    }
    if (status) filter.status = status;
    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      filter.date = { $gte: dayStart, $lte: dayEnd };
    }
    return this.model
      .find(filter)
      .populate('orderId')
      .populate('counterpartyId')
      .sort({ date: -1 })
      .exec();
  }

  async findById(id: string, organizationId?: string | null): Promise<ShipmentDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    const doc = await this.model
      .findOne({ _id: id, deletedAt: null, ...this.organizationFilter(organizationId) })
      .populate('orderId')
      .populate('counterpartyId')
      .exec();
    if (!doc) throw new NotFoundException(`Shipment ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    dto: UpdateShipmentDto,
    organizationId?: string | null,
  ): Promise<ShipmentDocument> {
    const doc = await this.findById(id, organizationId);
    if (dto.recipient !== undefined) doc.recipient = dto.recipient;
    if (dto.address !== undefined) doc.address = dto.address;
    if (dto.status !== undefined) {
      this.assertStatusTransition(doc.status, dto.status);
      doc.status = dto.status;
    }
    if (dto.driverInfo !== undefined) doc.driverInfo = dto.driverInfo;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.warehouseId !== undefined) {
      doc.warehouseId = dto.warehouseId
        ? new Types.ObjectId(dto.warehouseId)
        : (undefined as unknown as Types.ObjectId);
    }
    return doc.save();
  }

  /**
   * TZ-SHIP-433 — отмена ошибочной отгрузки (до dispatch).
   *
   * Один endpoint по shipment id. Транзакция:
   * 1. Shipment отменяется только из `draft`/`scheduled` и без `dispatchedAt`
   *    (после списания со склада откат — phase 2, 400 RU).
   * 2. Если это единственная активная отгрузка заказа и заказ был переведён
   *    в `shipped` — откатываем whole-order ship: `order.status → ready`,
   *    линии `boardLane → to_ship`, `item.status → ready` (COUPLING-MAP §2b).
   * 3. `order.shipmentIds` не чистим (историческая ссылка), статус shipment
   *    = `cancelled` — читатели фильтруют по статусу.
   */
  async cancelShipment(
    id: string,
    organizationId?: string | null,
  ): Promise<ShipmentDocument> {
    return this.sessionRunner.run(async (session) => {
      const doc = await this.model
        .findOne({ _id: id, deletedAt: null, ...this.organizationFilter(organizationId) })
        .session(session)
        .exec();
      if (!doc) throw new NotFoundException(`Shipment ${id} not found`);
      if (doc.status === 'cancelled') {
        throw new BadRequestException('Отгрузка уже отменена');
      }
      if (doc.dispatchedAt || doc.status === 'in_transit' || doc.status === 'delivered') {
        throw new BadRequestException(
          'Отгрузка уже отправлена со склада — отмена через склад/админа',
        );
      }
      doc.status = 'cancelled';
      await doc.save({ session });

      const order = await this.orderModel.findById(doc.orderId).session(session).exec();
      if (order && order.status === 'shipped') {
        const otherActive = await this.model
          .countDocuments({
            orderId: order._id,
            _id: { $ne: doc._id },
            status: { $nin: ['cancelled'] },
            deletedAt: null,
          })
          .session(session)
          .exec();
        if (otherActive === 0) {
          order.status = 'ready';
          for (const item of order.items ?? []) {
            item.boardLane = 'to_ship';
            item.status = 'ready';
          }
          order.markModified('items');
          await order.save({ session });
        }
      }
      return doc;
    });
  }

  async dispatch(id: string, organizationId?: string | null): Promise<ShipmentDocument> {
    // Z-001: wrap entire write-graph in a single Mongo transaction.
    return this.sessionRunner.run(async (session) => {
      const doc = await this.model
        .findOne({ _id: id, deletedAt: null, ...this.organizationFilter(organizationId) })
        .session(session)
        .exec();
      if (!doc) throw new NotFoundException(`Shipment ${id} not found`);
      if (!doc.warehouseId) {
        throw new NotFoundException(`Shipment has no warehouseId; cannot dispatch`);
      }
      if (doc.status === 'in_transit' || doc.status === 'delivered') {
        throw new NotFoundException(`Shipment already ${doc.status}`);
      }
      for (const item of doc.items) {
        await this.stockMovementService.create(
          {
            type: 'out',
            productId: item.productId.toString(),
            warehouseId: doc.warehouseId.toString(),
            qty: item.quantity,
            orderId: doc.orderId.toString(),
            documentRef: `SHP:${doc.number}`,
          },
          session,
        );
      }
      const reservations = await this.reservationService.findAll(
        doc.orderId.toString(),
      );
      for (const r of reservations) {
        if (r.status === 'active') {
          await this.reservationService.fulfill(r._id.toString(), session);
        }
      }
      doc.status = 'in_transit';
      doc.dispatchedAt = new Date();
      return doc.save({ session });
    });
  }

  async addDoc(
    id: string,
    dto: AddDocDto,
    organizationId?: string | null,
  ): Promise<ShipmentDocument> {
    const doc = await this.findById(id, organizationId);
    const docEntry: ShippingDoc = {
      number: dto.number ?? `${doc.number}-${(doc.docs?.length ?? 0) + 1}`,
      date: dto.date ? new Date(dto.date) : new Date(),
      type: dto.type,
      totalAmount: dto.totalAmount,
      signatures: dto.signatures ?? [],
      pdfUrl: dto.pdfUrl,
      notes: dto.notes,
    };
    doc.docs = [...(doc.docs ?? []), docEntry];
    return doc.save();
  }

  async remove(id: string, organizationId?: string | null): Promise<void> {
    const doc = await this.findById(id, organizationId);
    await this.model
      .updateOne(
        { _id: doc._id, ...this.organizationFilter(organizationId) },
        { $set: { deletedAt: new Date(), isActive: false } },
      )
      .exec();
  }

  private assertStatusTransition(from: ShipmentStatus, to: ShipmentStatus): void {
    if (from === to) return;
    const allowed: Record<ShipmentStatus, ShipmentStatus[]> = {
      draft: ['scheduled', 'cancelled'],
      scheduled: ['in_transit', 'cancelled'],
      in_transit: ['delivered'],
      delivered: [],
      cancelled: [],
    };
    if (!allowed[from]?.includes(to)) {
      throw new BadRequestException(`Нельзя перевести отгрузку из «${from}» в «${to}»`);
    }
  }

  private organizationFilter(organizationId?: string | null): Record<string, unknown> {
    if (!organizationId) return {};
    if (!Types.ObjectId.isValid(organizationId)) {
      throw new BadRequestException('Invalid organization scope');
    }
    return { organizationId: new Types.ObjectId(organizationId) };
  }

  private organizationWrite(organizationId?: string | null): Record<string, unknown> {
    return organizationId ? this.organizationFilter(organizationId) : {};
  }
}
