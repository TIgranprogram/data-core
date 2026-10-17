import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CreateSupplyRequestDto,
  ReceiveSupplyRequestDto,
  UpdateSupplyRequestDto,
} from './dto/supply-request.dto';
import {
  SupplyRequest,
  SupplyRequestDocument,
  SupplyRequestPriority,
} from './supply-request.schema';
import { SupplyTaskService } from './supply-task.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { StockMovementService } from '../stock-movement/stock-movement.service';

const PRIORITY_WEIGHT: Record<SupplyRequestPriority, number> = {
  urgent: 3,
  normal: 2,
  low: 1,
};

const VALID_STATUSES = [
  'in_progress',
  'requested',
  'ordered',
  'received',
  'cancelled',
] as const;
const VALID_PRIORITIES = ['urgent', 'normal', 'low'] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class SupplyRequestService {
  constructor(
    @InjectModel(SupplyRequest.name)
    private readonly model: Model<SupplyRequestDocument>,
    private readonly supplyTasks: SupplyTaskService,
    private readonly warehouses: WarehouseService,
    private readonly stockMovements: StockMovementService,
  ) {}

  async findAll(
    filters: { status?: string; priority?: string; search?: string; orderId?: string },
    organizationId?: string | null,
  ): Promise<SupplyRequestDocument[]> {
    const q: Record<string, unknown> = {
      deletedAt: null,
      ...this.organizationFilter(organizationId),
    };
    if (filters.orderId) {
      if (!Types.ObjectId.isValid(filters.orderId)) return [];
      q.orderId = new Types.ObjectId(filters.orderId);
    }
    if (filters.status && (VALID_STATUSES as readonly string[]).includes(filters.status)) {
      q.status = filters.status;
    }
    if (
      filters.priority &&
      (VALID_PRIORITIES as readonly string[]).includes(filters.priority)
    ) {
      q.priority = filters.priority;
    }
    if (filters.search?.trim()) {
      const rx = new RegExp(escapeRegex(filters.search.trim()), 'i');
      q.$or = [{ title: rx }, { article: rx }, { notes: rx }];
    }

    const docs = await this.model.find(q).limit(500).exec();
    return docs.sort((a, b) => {
      const pw = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (pw !== 0) return pw;
      return (
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      );
    });
  }

  async findById(
    id: string,
    organizationId?: string | null,
  ): Promise<SupplyRequestDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`SupplyRequest ${id} not found`);
    }
    const doc = await this.model
      .findOne({ _id: id, deletedAt: null, ...this.organizationFilter(organizationId) })
      .exec();
    if (!doc) throw new NotFoundException(`SupplyRequest ${id} not found`);
    return doc;
  }

  async create(
    dto: CreateSupplyRequestDto,
    organizationId?: string | null,
    session?: ClientSession,
    createdByUserId?: string | null,
  ): Promise<SupplyRequestDocument> {
    const title = dto.title?.trim() || undefined;
    const article = dto.article?.trim() || undefined;
    const unit = dto.unit?.trim() || undefined;
    const material = dto.materialId
      ? await this.model.db
          .collection('materials')
          .findOne({ _id: new Types.ObjectId(dto.materialId) }, { session })
      : null;
    // orderId XOR orderLabel — a matched Order always wins over free text.
    const orderId = dto.orderId ? new Types.ObjectId(dto.orderId) : undefined;
    const orderLabel = orderId ? undefined : dto.orderLabel?.trim() || undefined;

    // Quick-order creates an empty draft first and fills it from the form.
    // The schema intentionally allows both fields to be empty until the user
    // selects a material or enters a title.
    const [doc] = await this.model.create(
      [
        {
          ...this.organizationWrite(organizationId),
          title: title ?? material?.name ?? undefined,
          categoryId: dto.categoryId ? new Types.ObjectId(dto.categoryId) : undefined,
          materialId: dto.materialId ? new Types.ObjectId(dto.materialId) : undefined,
          article: article ?? material?.article ?? undefined,
          color: dto.color?.trim() || undefined,
          productUrl: dto.productUrl?.trim() || undefined,
          supplierId: dto.supplierId ? new Types.ObjectId(dto.supplierId) : undefined,
          supplierContactId: dto.supplierContactId
            ? new Types.ObjectId(dto.supplierContactId)
            : undefined,
          companyId: dto.companyId ? new Types.ObjectId(dto.companyId) : undefined,
          requestedBy: dto.requestedBy?.trim() || undefined,
          orderId,
          orderLabel,
          qty: dto.qty ?? 1,
          unit: unit ?? material?.unit ?? undefined,
          neededBy: dto.neededBy ? new Date(dto.neededBy) : undefined,
          status: dto.status ?? 'in_progress',
          priority: dto.priority ?? 'normal',
          notes: dto.notes?.trim() || undefined,
          priceHint: dto.priceHint,
          lineTotal: dto.lineTotal,
          supplierOrderDate: dto.supplierOrderDate
            ? new Date(dto.supplierOrderDate)
            : undefined,
          responsible: dto.responsible?.trim() || undefined,
          invoiceNo: dto.invoiceNo?.trim() || undefined,
          deliveryNote: dto.deliveryNote?.trim() || undefined,
          paid: dto.paid ?? false,
          paidAt: dto.paid ? new Date() : undefined,
          createdBy:
            createdByUserId && Types.ObjectId.isValid(createdByUserId)
              ? new Types.ObjectId(createdByUserId)
              : undefined,
        },
      ],
      { session },
    );
    return doc;
  }

  async update(
    id: string,
    dto: UpdateSupplyRequestDto,
    organizationId?: string | null,
  ): Promise<SupplyRequestDocument> {
    const doc = await this.findById(id, organizationId);

    if (dto.materialId && dto.materialId !== doc.materialId?.toString()) {
      doc.materialId = new Types.ObjectId(dto.materialId);
      const material = await this.model.db
        .collection('materials')
        .findOne({ _id: new Types.ObjectId(dto.materialId) });
      if (material) {
        if (dto.title === undefined) doc.title = material.name;
        if (dto.article === undefined) doc.article = material.article;
        if (dto.unit === undefined) doc.unit = material.unit;
      }
    }

    if (dto.title !== undefined) doc.title = dto.title?.trim() || undefined;
    if (dto.article !== undefined) doc.article = dto.article?.trim() || undefined;
    if (dto.color !== undefined) doc.color = dto.color?.trim() || undefined;
    if (dto.productUrl !== undefined)
      doc.productUrl = dto.productUrl?.trim() || undefined;
    if (dto.requestedBy !== undefined)
      doc.requestedBy = dto.requestedBy?.trim() || undefined;
    if (dto.unit !== undefined) doc.unit = dto.unit?.trim() || undefined;
    if (dto.qty !== undefined) doc.qty = dto.qty;
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.priority !== undefined) doc.priority = dto.priority;
    if (dto.notes !== undefined) doc.notes = dto.notes?.trim() || undefined;
    if (dto.priceHint !== undefined) doc.priceHint = dto.priceHint;
    if (dto.lineTotal !== undefined) doc.lineTotal = dto.lineTotal;
    if (dto.responsible !== undefined)
      doc.responsible = dto.responsible?.trim() || undefined;
    if (dto.neededBy !== undefined)
      doc.neededBy = dto.neededBy ? new Date(dto.neededBy) : undefined;
    if (dto.supplierOrderDate !== undefined)
      doc.supplierOrderDate = dto.supplierOrderDate
        ? new Date(dto.supplierOrderDate)
        : undefined;

    if (dto.categoryId !== undefined)
      doc.categoryId = dto.categoryId ? new Types.ObjectId(dto.categoryId) : undefined;
    if (dto.supplierId !== undefined)
      doc.supplierId = dto.supplierId ? new Types.ObjectId(dto.supplierId) : undefined;
    if (dto.supplierContactId !== undefined)
      doc.supplierContactId = dto.supplierContactId
        ? new Types.ObjectId(dto.supplierContactId)
        : undefined;
    if (dto.companyId !== undefined)
      doc.companyId = dto.companyId ? new Types.ObjectId(dto.companyId) : undefined;
    if (dto.orderId !== undefined) {
      doc.orderId = dto.orderId ? new Types.ObjectId(dto.orderId) : undefined;
      // A matched Order always wins over free text — clear stale orderLabel.
      if (doc.orderId) doc.orderLabel = undefined;
    }
    if (dto.orderLabel !== undefined && !doc.orderId) {
      doc.orderLabel = dto.orderLabel?.trim() || undefined;
    }

    if (dto.invoiceNo !== undefined) doc.invoiceNo = dto.invoiceNo?.trim() || undefined;
    if (dto.deliveryNote !== undefined)
      doc.deliveryNote = dto.deliveryNote?.trim() || undefined;
    if (dto.paid !== undefined && dto.paid !== doc.paid) {
      doc.paid = dto.paid;
      doc.paidAt = dto.paid ? new Date() : undefined;
    }

    return doc.save();
  }

  /**
   * «Заказано»: при наличии orderId+materialId порождает задачу реестра
   * SupplyTask и линкует её; без них просто фиксирует статус (не ошибка).
   */
  async markOrdered(
    id: string,
    organizationId?: string | null,
  ): Promise<SupplyRequestDocument> {
    const doc = await this.findById(id, organizationId);
    doc.status = 'ordered';
    // Idempotent: repeated «Заказано» must not create duplicate registry tasks.
    if (doc.orderId && doc.materialId && !doc.linkedSupplyTaskId) {
      const orderId = doc.orderId.toString();
      const materialId = doc.materialId.toString();
      // Reconcile an already-created registry task before spawning a new one.
      // This closes the race/retry gap where the request was saved before its link.
      const existing = await this.supplyTasks.findOpenByOrderMaterial?.(
        orderId,
        materialId,
        organizationId,
      );
      const task = existing ?? (await this.supplyTasks.create(
        {
          orderId,
          materialId,
          qty: doc.qty,
          title: doc.title ?? doc.article ?? 'Материал заявки снабжения',
          ...(doc.notes ? { notes: doc.notes } : {}),
        },
        organizationId,
        'ordered',
      ));
      doc.linkedSupplyTaskId = task._id;
    }
    return doc.save();
  }

  /**
   * TZ-NX-SUPPLY-S4-RECEIVE-TO-STOCK — HITL confirm: posts a single `StockMovement`
   * IN (sole write-path, via `StockMovementService`) and marks the request received.
   * Explicit 409 on a repeat receive — no silent no-op, no reverse-path here.
   */
  async receive(
    id: string,
    dto: ReceiveSupplyRequestDto,
    organizationId?: string | null,
  ): Promise<SupplyRequestDocument> {
    const doc = await this.findById(id, organizationId);
    if (doc.status === 'received') {
      throw new ConflictException('Заявка уже отмечена как полученная');
    }
    if (!doc.materialId) {
      throw new BadRequestException(
        'У заявки нет привязанного материала — нельзя оприходовать на склад',
      );
    }

    let warehouseId = dto.warehouseId;
    if (!warehouseId) {
      const defaultWarehouse = await this.warehouses.findDefault();
      if (!defaultWarehouse) {
        throw new BadRequestException('Нет склада по умолчанию — выберите склад');
      }
      warehouseId = defaultWarehouse._id.toString();
    }

    await this.stockMovements.create({
      type: 'in',
      materialId: doc.materialId.toString(),
      warehouseId,
      qty: dto.receivedQty,
      ...(doc.orderId ? { orderId: doc.orderId.toString() } : {}),
      documentRef: `SupplyRequest:${doc._id.toString()}`,
    });

    doc.status = 'received';
    doc.receivedQty = dto.receivedQty;
    return doc.save();
  }

  async cancel(
    id: string,
    organizationId?: string | null,
  ): Promise<SupplyRequestDocument> {
    const doc = await this.findById(id, organizationId);
    doc.status = 'cancelled';
    return doc.save();
  }

  async remove(id: string, organizationId?: string | null): Promise<void> {
    const doc = await this.findById(id, organizationId);
    await this.model
      .updateOne(
        { _id: doc._id, ...this.organizationFilter(organizationId) },
        { $set: { deletedAt: new Date() } },
      )
      .exec();
  }

  private organizationFilter(organizationId?: string | null): Record<string, unknown> {
    if (!organizationId) return {};
    if (!Types.ObjectId.isValid(organizationId)) {
      throw new NotFoundException('Invalid organization scope');
    }
    return { organizationId: new Types.ObjectId(organizationId) };
  }

  private organizationWrite(organizationId?: string | null): Record<string, unknown> {
    return organizationId ? this.organizationFilter(organizationId) : {};
  }
}
