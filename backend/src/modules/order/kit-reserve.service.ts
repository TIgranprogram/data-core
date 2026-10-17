import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Order, OrderDocument } from './order.schema';
import { Product, ProductDocument } from '../product/product.schema';
import {
  ProductModule as ProductModuleEntity,
  ProductModuleDocument,
} from '../product-module/product-module.schema';
import { Material, MaterialDocument } from '../material/material.schema';
import { StorageItem, StorageItemDocument } from '../storage-item/storage-item.schema';
import { ReservationService } from '../reservation/reservation.service';
import { SupplyRequestService } from '../supply/supply-request.service';
import { SessionRunner } from '../../common/db/session-runner';

type CompositionLineSource = { lineType: 'module' | 'material' | 'product'; refId: Types.ObjectId | string; quantity?: number };
type ProductSource = { composition?: CompositionLineSource[]; productModuleIds?: Types.ObjectId[] };
type ModuleMaterialSource = { materialId: Types.ObjectId | string; quantity?: number };
type ModuleSource = { composition?: CompositionLineSource[]; materials?: ModuleMaterialSource[] };

export interface KitAvailabilityLine {
  materialId: string;
  materialName: string;
  needQty: number;
  availableQty: number;
  warehouseId: string | null;
  status: 'ok' | 'short';
}

export interface KitAvailability {
  orderId: string;
  orderItemIndex: number;
  lines: KitAvailabilityLine[];
  summary: { canReserveAll: boolean };
}

export interface KitReserveResult {
  reserved: { materialId: string; warehouseId: string; qty: number; reservationId: string }[];
  supplyRequestIds: string[];
  warnings: string[];
}

const NO_COMPOSITION_RU = 'Нет состава для комплектации изделия — снимок BOM отсутствует';

/**
 * TZ-NX-SUPPLY-S0 — availability + reserve + shortage→SupplyRequest for one order line.
 *
 * Reuses the existing Product/ProductModule composition (dual-read: `composition`,
 * else legacy `productModuleIds`/`materials[]`) — same precedence as
 * CostCalculationService.walkModule, but flattens to materialId→qty (no cost math)
 * and additionally recurses into nested `lineType=product` lines, which matters for
 * physical kitting (cost preview intentionally does not recurse there).
 *
 * known_limitation: one StorageItem row per material is picked (the one with the
 * most available stock) — no split-reservation across multiple warehouses/zones
 * for a single material. Matches the current single-warehouse operating reality;
 * revisit if/when multi-warehouse split kitting is actually needed.
 */
@Injectable()
export class KitReserveService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(ProductModuleEntity.name) private readonly moduleModel: Model<ProductModuleDocument>,
    @InjectModel(Material.name) private readonly materialModel: Model<MaterialDocument>,
    @InjectModel(StorageItem.name) private readonly storageModel: Model<StorageItemDocument>,
    private readonly reservationService: ReservationService,
    private readonly supplyRequests: SupplyRequestService,
    private readonly sessionRunner: SessionRunner,
  ) {}

  async getAvailability(
    orderId: string,
    orderItemIndex: number,
    organizationId?: string | null,
  ): Promise<KitAvailability> {
    const { order, item } = await this.loadOrderItem(orderId, orderItemIndex, organizationId);
    const needs = await this.resolveMaterialNeeds(item.productId.toString(), item.quantity || 1);
    if (needs.size === 0) throw new BadRequestException(NO_COMPOSITION_RU);

    const lines: KitAvailabilityLine[] = [];
    for (const [materialId, needQty] of needs) {
      const [material, candidate] = await Promise.all([
        this.materialModel.findById(materialId).select('name').lean().exec(),
        this.pickStorageCandidate(materialId),
      ]);
      const availableQty = candidate ? Math.max(0, (candidate.quantity ?? 0) - (candidate.reservedQty ?? 0)) : 0;
      lines.push({
        materialId,
        materialName: material?.name ?? materialId,
        needQty,
        availableQty,
        warehouseId: candidate ? String(candidate.warehouseId) : null,
        status: availableQty >= needQty ? 'ok' : 'short',
      });
    }
    return {
      orderId: String(order._id),
      orderItemIndex,
      lines,
      summary: { canReserveAll: lines.every((l) => l.status === 'ok') },
    };
  }

  async confirmReserve(
    orderId: string,
    orderItemIndex: number,
    organizationId?: string | null,
  ): Promise<KitReserveResult> {
    return this.sessionRunner.run(async (session) => {
      const { order, item } = await this.loadOrderItem(orderId, orderItemIndex, organizationId, session);
      const needs = await this.resolveMaterialNeeds(item.productId.toString(), item.quantity || 1, session);
      if (needs.size === 0) throw new BadRequestException(NO_COMPOSITION_RU);

      const reserved: KitReserveResult['reserved'] = [];
      const supplyRequestIds: string[] = [];
      const warnings: string[] = [];

      for (const [materialId, needQty] of needs) {
        const candidate = await this.pickStorageCandidate(materialId, session);
        const availableQty = candidate ? Math.max(0, (candidate.quantity ?? 0) - (candidate.reservedQty ?? 0)) : 0;
        if (candidate && availableQty >= needQty) {
          const reservation = await this.reservationService.create(
            {
              orderId: order.number,
              materialId,
              warehouseId: String(candidate.warehouseId),
              zoneName: candidate.zoneName,
              qty: needQty,
              orderItemIndex,
            },
            session,
          );
          reserved.push({
            materialId,
            warehouseId: String(candidate.warehouseId),
            qty: needQty,
            reservationId: String(reservation._id),
          });
        } else {
          const shortfall = needQty - availableQty;
          const supplyRequest = await this.supplyRequests.create(
            {
              materialId,
              orderId: String(order._id),
              qty: shortfall,
              requestedBy: `Комплектация ${order.number} · поз. ${orderItemIndex + 1}`,
            },
            organizationId,
            session,
          );
          supplyRequestIds.push(String(supplyRequest._id));
          warnings.push(
            `Материал ${materialId}: не хватает ${shortfall} — создана заявка снабжения, резерв не создан`,
          );
        }
      }

      order.reservationIds = [
        ...(order.reservationIds ?? []),
        ...reserved.map((r) => new Types.ObjectId(r.reservationId)),
      ];
      await order.save({ session });

      return { reserved, supplyRequestIds, warnings };
    });
  }

  private async loadOrderItem(
    orderId: string,
    orderItemIndex: number,
    organizationId?: string | null,
    session?: ClientSession,
  ): Promise<{ order: OrderDocument; item: OrderDocument['items'][number] }> {
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException(`Order ${orderId} not found`);
    const query = this.orderModel.findById(orderId);
    if (session) query.session(session);
    const order = await query.exec();
    if (!order || order.deletedAt) throw new NotFoundException(`Order ${orderId} not found`);
    if (organizationId && order.organizationId && String(order.organizationId) !== organizationId) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (!Number.isInteger(orderItemIndex) || orderItemIndex < 0 || orderItemIndex >= order.items.length) {
      throw new NotFoundException(`Order line ${orderItemIndex} not found`);
    }
    return { order, item: order.items[orderItemIndex] };
  }

  private async resolveMaterialNeeds(
    productId: string,
    multiplier: number,
    session?: ClientSession,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    await this.walkProduct(productId, multiplier, map, new Set(), new Set(), session);
    return map;
  }

  private async walkProduct(
    productId: string,
    multiplier: number,
    map: Map<string, number>,
    productAncestors: Set<string>,
    moduleAncestors: Set<string>,
    session?: ClientSession,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(productId) || productAncestors.has(productId)) return;
    const query = this.productModel.findById(new Types.ObjectId(productId)).select('composition productModuleIds');
    if (session) query.session(session);
    const product = (await query.lean().exec()) as ProductSource | null;
    if (!product) return;

    const nextAncestors = new Set(productAncestors);
    nextAncestors.add(productId);

    const composition = product.composition ?? [];
    for (const line of composition.filter((l) => l.lineType === 'material')) {
      this.addMaterial(map, line.refId, (line.quantity ?? 1) * multiplier);
    }
    const moduleLines = composition.length
      ? composition.filter((l) => l.lineType === 'module')
      : (product.productModuleIds ?? []).map((refId) => ({ lineType: 'module' as const, refId, quantity: 1 }));
    for (const line of moduleLines) {
      await this.walkModule(String(line.refId), (line.quantity ?? 1) * multiplier, map, moduleAncestors, session);
    }
    for (const line of composition.filter((l) => l.lineType === 'product')) {
      await this.walkProduct(String(line.refId), (line.quantity ?? 1) * multiplier, map, nextAncestors, moduleAncestors, session);
    }
  }

  private async walkModule(
    moduleId: string,
    multiplier: number,
    map: Map<string, number>,
    ancestors: Set<string>,
    session?: ClientSession,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(moduleId) || ancestors.has(moduleId)) return;
    const query = this.moduleModel.findById(new Types.ObjectId(moduleId)).select('composition materials');
    if (session) query.session(session);
    const module = (await query.lean().exec()) as ModuleSource | null;
    if (!module) return;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(moduleId);

    const composition = module.composition ?? [];
    const materialLines = composition.length
      ? composition.filter((l) => l.lineType === 'material')
      : (module.materials ?? []).map((m) => ({ lineType: 'material' as const, refId: m.materialId, quantity: m.quantity }));
    for (const line of materialLines) {
      this.addMaterial(map, line.refId, (line.quantity ?? 1) * multiplier);
    }
    for (const line of composition.filter((l) => l.lineType === 'module')) {
      await this.walkModule(String(line.refId), (line.quantity ?? 1) * multiplier, map, nextAncestors, session);
    }
  }

  private addMaterial(map: Map<string, number>, refId: Types.ObjectId | string, qty: number): void {
    const key = String(refId);
    if (!Types.ObjectId.isValid(key) || qty <= 0) return;
    map.set(key, (map.get(key) ?? 0) + qty);
  }

  /** Best single StorageItem row for a material — most available stock wins (no cross-row split). */
  private async pickStorageCandidate(
    materialId: string,
    session?: ClientSession,
  ): Promise<StorageItemDocument | null> {
    const query = this.storageModel.find({
      materialId: new Types.ObjectId(materialId),
      isActive: true,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    });
    if (session) query.session(session);
    const rows = await query.exec();
    if (!rows.length) return null;
    return rows.reduce<StorageItemDocument | null>((best, row) => {
      const avail = (row.quantity ?? 0) - (row.reservedQty ?? 0);
      const bestAvail = best ? (best.quantity ?? 0) - (best.reservedQty ?? 0) : -Infinity;
      return avail > bestAvail ? row : best;
    }, null);
  }
}
