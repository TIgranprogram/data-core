import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Reservation, ReservationDocument } from './reservation.schema';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { StorageItem, StorageItemDocument } from '../storage-item/storage-item.schema';
import { StockMovement, StockMovementDocument } from '../stock-movement/stock-movement.schema';

@Injectable()
export class ReservationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Reservation.name)
    private readonly model: Model<ReservationDocument>,
    @InjectModel(StorageItem.name)
    private readonly storageModel: Model<StorageItemDocument>,
    @InjectModel(StockMovement.name)
    private readonly movementModel: Model<StockMovementDocument>,
  ) {}

  /** Exactly one of productId/materialId — mirrors the StorageItem discriminator. */
  private refFilter(dto: Pick<CreateReservationDto, 'productId' | 'materialId'>): Record<string, unknown> {
    if (dto.productId && dto.materialId) {
      throw new BadRequestException('Reservation: only one of productId/materialId is allowed');
    }
    if (dto.productId) return { productId: new Types.ObjectId(dto.productId) };
    if (dto.materialId) return { materialId: new Types.ObjectId(dto.materialId) };
    throw new BadRequestException('Reservation: one of productId/materialId is required');
  }

  async create(dto: CreateReservationDto, externalSession?: ClientSession): Promise<ReservationDocument> {
    const refFilter = this.refFilter(dto);
    const filter: Record<string, unknown> = {
      warehouseId: new Types.ObjectId(dto.warehouseId),
      ...refFilter,
    };
    if (dto.zoneName) filter.zoneName = dto.zoneName;
    else filter.$or = [{ zoneName: { $exists: false } }, { zoneName: null }];
    const refLabel = dto.materialId ? `material ${dto.materialId}` : `product ${dto.productId}`;

    const doCreate = async (session: ClientSession): Promise<ReservationDocument> => {
      const item = await this.storageModel.findOne(filter).session(session).exec();
      if (!item) {
        throw new NotFoundException(`No storage item for ${refLabel} in warehouse ${dto.warehouseId}`);
      }
      const available = (item.quantity ?? 0) - (item.reservedQty ?? 0);
      if (available < dto.qty) {
        throw new BadRequestException(
          `Insufficient available stock: have ${available}, requested ${dto.qty}`,
        );
      }
      item.reservedQty = (item.reservedQty ?? 0) + dto.qty;
      await item.save({ session });
      const [doc] = await this.model.create(
        [
          {
            orderId: dto.orderId,
            ...refFilter,
            warehouseId: new Types.ObjectId(dto.warehouseId),
            qty: dto.qty,
            zoneName: dto.zoneName,
            orderItemIndex: dto.orderItemIndex,
            status: 'active',
            isActive: true,
            notes: dto.notes,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
          },
        ],
        { session },
      );
      if (!doc) throw new BadRequestException('Reservation failed');
      return doc;
    };

    if (externalSession) return doCreate(externalSession);

    const session = await this.connection.startSession();
    let result: ReservationDocument | undefined;
    try {
      await session.withTransaction(async () => {
        result = await doCreate(session);
      });
    } finally {
      await session.endSession();
    }
    if (!result) throw new BadRequestException('Reservation failed');
    return result;
  }

  async findAll(orderId?: string): Promise<ReservationDocument[]> {
    const filter: Record<string, unknown> = {};
    if (orderId) filter.orderId = orderId;
    return this.model
      .find(filter)
      .populate('productId')
      .populate('materialId')
      .populate('warehouseId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<ReservationDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Reservation ${id} not found`);
    return doc;
  }

  async release(id: string): Promise<ReservationDocument> {
    const session = await this.connection.startSession();
    let result: ReservationDocument | undefined;
    try {
      await session.withTransaction(async () => {
        const doc = await this.findById(id);
        if (doc.status !== 'active') {
          throw new BadRequestException(`Reservation already ${doc.status}`);
        }
        const filter: Record<string, unknown> = {
          warehouseId: doc.warehouseId,
          ...(doc.materialId ? { materialId: doc.materialId } : { productId: doc.productId }),
        };
        if (doc.zoneName) filter.zoneName = doc.zoneName;
        else filter.$or = [{ zoneName: { $exists: false } }, { zoneName: null }];

        const item = await this.storageModel
          .findOne(filter)
          .session(session)
          .exec();
        if (item) {
          item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - doc.qty);
          await item.save({ session });
        }
        doc.status = 'released';
        doc.isActive = false;
        const saved = await doc.save({ session });
        result = saved;
      });
    } finally {
      await session.endSession();
    }
    if (!result) throw new NotFoundException('Release failed');
    return result;
  }

  async fulfill(id: string, externalSession?: ClientSession): Promise<ReservationDocument> {
    const doc = await this.findById(id);
    if (doc.status !== 'active') {
      throw new BadRequestException(`Reservation already ${doc.status}`);
    }
    // Z-001: if caller passed an external session, run on it.
    if (externalSession) return this.runFulfillOnSession(doc, id, externalSession);
    // Manual startTransaction + inline movementModel.create to avoid nested transactions
    const session = await this.connection.startSession();
    let result: ReservationDocument | undefined;
    try {
      session.startTransaction();
      result = await this.runFulfillOnSession(doc, id, session);
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
    if (!result) throw new NotFoundException('Fulfill failed');
    return result;
  }

  private async runFulfillOnSession(
    doc: ReservationDocument,
    id: string,
    session: ClientSession,
  ): Promise<ReservationDocument> {
    const refFilter = doc.materialId ? { materialId: doc.materialId } : { productId: doc.productId };
    const refLabel = doc.materialId ? `material ${doc.materialId}` : `product ${doc.productId}`;
    const filter: Record<string, unknown> = {
      warehouseId: doc.warehouseId,
      ...refFilter,
    };
    if (doc.zoneName) filter.zoneName = doc.zoneName;
    else filter.$or = [{ zoneName: { $exists: false } }, { zoneName: null }];
    const item = await this.storageModel.findOne(filter).session(session).exec();
    if (!item) {
      throw new NotFoundException(`No storage item for ${refLabel} in warehouse ${doc.warehouseId}`);
    }
    if ((item.quantity ?? 0) < doc.qty) {
      throw new BadRequestException(
        `Insufficient stock: have ${item.quantity}, requested ${doc.qty}`,
      );
    }
    item.quantity = (item.quantity ?? 0) - doc.qty;
    item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - doc.qty);
    await item.save({ session });
    await this.movementModel.create(
      [
        {
          type: 'out',
          date: new Date(),
          ...refFilter,
          warehouseId: doc.warehouseId,
          zoneName: doc.zoneName,
          qty: doc.qty,
          cost: 0,
          orderId: doc.orderId,
          documentRef: `RES:${id}`,
        },
      ],
      { session },
    );
    doc.status = 'fulfilled';
    doc.isActive = false;
    return doc.save({ session });
  }
  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
