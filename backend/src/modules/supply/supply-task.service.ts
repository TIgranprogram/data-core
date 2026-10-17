import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateSupplyTaskDto,
  ExplodeSupplyTasksDto,
  UpdateSupplyTaskDto,
} from './dto/create-supply-task.dto';
import {
  SupplyTask,
  SupplyTaskDocument,
  SupplyTaskStatus,
} from './supply-task.schema';

const STATUS_FLOW: Record<SupplyTaskStatus, SupplyTaskStatus[]> = {
  draft: ['confirmed'],
  /** TZ-NX-SUPPLY-TASK-UNCONFIRM — `draft` is the one reverse edge: an accidental
   * confirm is cheap to undo before the task reaches `ordered` (no warehouse
   * movement to unwind at this stage). `ordered`/`received` stay one-way. */
  confirmed: ['ordered', 'draft'],
  ordered: ['received'],
  received: [],
};

type MaterialNeed = {
  materialId: string;
  moduleId?: string;
  qty: number;
  title?: string;
};

@Injectable()
export class SupplyTaskService {
  constructor(
    @InjectModel(SupplyTask.name)
    private readonly model: Model<SupplyTaskDocument>,
  ) {}

  async create(
    dto: CreateSupplyTaskDto,
    organizationId?: string | null,
    initialStatus: SupplyTaskStatus = 'draft',
  ): Promise<SupplyTaskDocument> {
    if (!Types.ObjectId.isValid(dto.orderId)) {
      throw new BadRequestException('Invalid orderId');
    }
    if (!dto.materialId && !dto.moduleId && !(dto.title ?? '').trim()) {
      throw new BadRequestException(
        'Укажите materialId, moduleId или title для задачи снабжения',
      );
    }
    if (dto.materialId && !Types.ObjectId.isValid(dto.materialId)) {
      throw new BadRequestException('Invalid materialId');
    }
    if (dto.moduleId && !Types.ObjectId.isValid(dto.moduleId)) {
      throw new BadRequestException('Invalid moduleId');
    }

    return this.model.create({
      orderId: new Types.ObjectId(dto.orderId),
      ...this.organizationWrite(organizationId),
      orderLineId: dto.orderLineId?.trim() || undefined,
      materialId: dto.materialId
        ? new Types.ObjectId(dto.materialId)
        : undefined,
      moduleId: dto.moduleId ? new Types.ObjectId(dto.moduleId) : undefined,
      qty: dto.qty,
      notes: dto.notes?.trim() || undefined,
      title: dto.title?.trim() || undefined,
      status: initialStatus,
    });
  }

  /**
   * Expand the order's catalog trees into one draft task per material.
   * Existing open tasks are reused so the operation is safe to repeat.
   */
  async explode(
    dto: ExplodeSupplyTasksDto,
    organizationId?: string | null,
  ): Promise<{ created: SupplyTaskDocument[]; skipped: number }> {
    if (!Types.ObjectId.isValid(dto.orderId)) {
      throw new BadRequestException('Invalid orderId');
    }
    if (dto.moduleId && !Types.ObjectId.isValid(dto.moduleId)) {
      throw new BadRequestException('Invalid moduleId');
    }

    const order = await this.model.db
      .collection('orders')
      .findOne({ _id: new Types.ObjectId(dto.orderId) });
    if (!order) throw new NotFoundException(`Order ${dto.orderId} not found`);

    const productModel = this.model.db.collection('products');
    const moduleModel = this.model.db.collection('productmodules');
    const materialRows = new Map<string, MaterialNeed>();
    const addMaterial = (
      materialId: unknown,
      qty: number,
      moduleId?: string,
      title?: string,
    ) => {
      const id = String(materialId ?? '');
      if (!Types.ObjectId.isValid(id)) return;
      const existing = materialRows.get(id);
      if (existing) {
        existing.qty += qty;
        existing.moduleId ??= moduleId;
        existing.title ??= title;
      } else {
        materialRows.set(id, { materialId: id, moduleId, qty, title });
      }
    };

    const walkModule = async (
      moduleId: string,
      multiplier: number,
      modulePath = new Set<string>(),
    ): Promise<void> => {
      if (modulePath.has(moduleId)) return;
      const nextModulePath = new Set(modulePath).add(moduleId);
      const module = await moduleModel.findOne({
        _id: new Types.ObjectId(moduleId),
        deletedAt: null,
      });
      if (!module) return;
      const composition = module.composition ?? [];
      if (composition.length === 0) {
        for (const row of module.materials ?? []) {
          addMaterial(
            row.materialId,
            multiplier * Number(row.quantity ?? 1),
            moduleId,
          );
        }
      }
      for (const line of composition) {
        const lineQty = multiplier * Number(line.quantity ?? 1);
        if (line.lineType === 'material') {
          addMaterial(line.refId, lineQty, moduleId);
        }
        if (line.lineType === 'module') {
          await walkModule(String(line.refId), lineQty, nextModulePath);
        }
      }
    };

    const walkProduct = async (
      productId: string,
      multiplier: number,
      productPath = new Set<string>(),
    ): Promise<void> => {
      if (productPath.has(productId)) return;
      const nextProductPath = new Set(productPath).add(productId);
      const product = await productModel.findOne({
        _id: new Types.ObjectId(productId),
        deletedAt: null,
      });
      if (!product) return;
      for (const line of product.composition ?? []) {
        const lineQty = multiplier * Number(line.quantity ?? 1);
        if (line.lineType === 'material') {
          addMaterial(line.refId, lineQty, undefined, product.name);
        }
        if (line.lineType === 'module') {
          await walkModule(String(line.refId), lineQty);
        }
        if (line.lineType === 'product') {
          await walkProduct(String(line.refId), lineQty, nextProductPath);
        }
      }
      if ((product.composition ?? []).length === 0) {
        for (const moduleId of product.productModuleIds ?? []) {
          await walkModule(String(moduleId), multiplier);
        }
      }
    };

    if (dto.moduleId) {
      await walkModule(dto.moduleId, 1);
    } else {
      for (const item of order.items ?? []) {
        await walkProduct(String(item.productId), Number(item.quantity ?? 1));
      }
    }

    const created: SupplyTaskDocument[] = [];
    let skipped = 0;
    for (const row of materialRows.values()) {
      const open = await this.model
        .findOne({
          orderId: new Types.ObjectId(dto.orderId),
          materialId: new Types.ObjectId(row.materialId),
          ...this.organizationFilter(organizationId),
          status: { $in: ['draft', 'confirmed', 'ordered'] },
          deletedAt: null,
        })
        .exec();
      if (open) {
        skipped += 1;
        continue;
      }
      try {
        const doc = await this.model.create({
          orderId: new Types.ObjectId(dto.orderId),
          ...this.organizationWrite(organizationId),
          materialId: new Types.ObjectId(row.materialId),
          moduleId: row.moduleId ? new Types.ObjectId(row.moduleId) : undefined,
          qty: row.qty,
          title: row.title ?? 'Материал из состава',
          status: 'draft' as SupplyTaskStatus,
        });
        created.push(doc);
      } catch (error: unknown) {
        if (this.isDuplicateKeyError(error)) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }
    return { created, skipped };
  }

  async findAll(
    filters: { orderId?: string; status?: string },
    organizationId?: string | null,
  ): Promise<SupplyTaskDocument[]> {
    const q: Record<string, unknown> = {
      deletedAt: null,
      ...this.organizationFilter(organizationId),
    };
    if (filters.orderId && Types.ObjectId.isValid(filters.orderId)) {
      q.orderId = new Types.ObjectId(filters.orderId);
    }
    if (
      filters.status &&
      ['draft', 'confirmed', 'ordered', 'received'].includes(filters.status)
    ) {
      q.status = filters.status;
    }
    return this.model.find(q).sort({ createdAt: -1 }).limit(500).exec();
  }

  async findOpenByOrderMaterial(
    orderId: string,
    materialId: string,
    organizationId?: string | null,
  ): Promise<SupplyTaskDocument | null> {
    if (!Types.ObjectId.isValid(orderId) || !Types.ObjectId.isValid(materialId)) {
      return null;
    }
    return this.model
      .findOne({
        orderId: new Types.ObjectId(orderId),
        materialId: new Types.ObjectId(materialId),
        status: { $in: ['draft', 'confirmed', 'ordered'] },
        deletedAt: null,
        ...this.organizationFilter(organizationId),
      })
      .exec();
  }

  async findById(id: string, organizationId?: string | null): Promise<SupplyTaskDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`SupplyTask ${id} not found`);
    }
    const doc = await this.model
      .findOne({ _id: id, deletedAt: null, ...this.organizationFilter(organizationId) })
      .exec();
    if (!doc) throw new NotFoundException(`SupplyTask ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    dto: UpdateSupplyTaskDto,
    organizationId?: string | null,
  ): Promise<SupplyTaskDocument> {
    const doc = await this.findById(id, organizationId);
    if (dto.qty !== undefined) doc.qty = dto.qty;
    if (dto.notes !== undefined) doc.notes = dto.notes.trim();
    if (dto.title !== undefined) doc.title = dto.title.trim();
    return doc.save();
  }

  /** D18: зелёный флаг «можно заказывать» — кто + когда. */
  async confirm(
    id: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<SupplyTaskDocument> {
    const doc = await this.findById(id, organizationId);
    this.assertTransition(doc.status, 'confirmed');
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId for confirm');
    }
    doc.status = 'confirmed';
    doc.confirmedBy = new Types.ObjectId(userId);
    doc.confirmedAt = new Date();
    return doc.save();
  }

  /**
   * TZ-NX-SUPPLY-TASK-UNCONFIRM — revert an accidental «Подтвердить» back to
   * `draft`, clearing the confirm audit fields. Only from `confirmed`
   * (`assertTransition` reuses the same `STATUS_FLOW` table as the forward
   * transitions) — `ordered`/`received` have no reverse edge here by design.
   */
  async unconfirm(
    id: string,
    organizationId?: string | null,
  ): Promise<SupplyTaskDocument> {
    const doc = await this.findById(id, organizationId);
    this.assertTransition(doc.status, 'draft');
    doc.status = 'draft';
    doc.confirmedBy = undefined;
    doc.confirmedAt = undefined;
    return doc.save();
  }

  async markOrdered(
    id: string,
    organizationId?: string | null,
  ): Promise<SupplyTaskDocument> {
    const doc = await this.findById(id, organizationId);
    this.assertTransition(doc.status, 'ordered');
    doc.status = 'ordered';
    return doc.save();
  }

  async markReceived(
    id: string,
    organizationId?: string | null,
  ): Promise<SupplyTaskDocument> {
    const doc = await this.findById(id, organizationId);
    this.assertTransition(doc.status, 'received');
    doc.status = 'received';
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
      throw new BadRequestException('Invalid organization scope');
    }
    return { organizationId: new Types.ObjectId(organizationId) };
  }

  private organizationWrite(organizationId?: string | null): Record<string, unknown> {
    return organizationId ? this.organizationFilter(organizationId) : {};
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
  }

  private assertTransition(
    from: SupplyTaskStatus,
    to: SupplyTaskStatus,
  ): void {
    const allowed = STATUS_FLOW[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Нельзя перевести задачу снабжения из «${from}» в «${to}»`,
      );
    }
  }
}
