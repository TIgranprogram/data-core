/**
 * Local / dev demo catalog + orders for Gantt smoke.
 *
 * Writes real Mongo documents (idempotent by stable markers). Never runs when
 * NODE_ENV=production. Complements `scripts/seed-local-demo.mjs` (API path):
 * this seed fills a fresh local DB on backend boot so `/production` is usable
 * without a manual script — script remains the preferred one-shot refresh.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkType, WorkTypeDocument } from '../../modules/work-type/work-type.schema';
import {
  ProductModule as ProductModuleEntity,
  ProductModuleDocument,
} from '../../modules/product-module/product-module.schema';
import { Product, ProductDocument } from '../../modules/product/product.schema';
import { Order, OrderDocument } from '../../modules/order/order.schema';
import { Counterparty, CounterpartyDocument } from '../../modules/counterparty/counterparty.schema';
import { Material, MaterialDocument } from '../../modules/material/material.schema';
import { Worker, WorkerDocument } from '../../modules/worker/worker.schema';
import { Warehouse, WarehouseDocument } from '../../modules/warehouse/warehouse.schema';
import { Site, SiteDocument } from '../../modules/site/site.schema';

const MARK = 'DEMO-LOCAL';
const PREFIX = 'Демо · ';
/** Opt-out: LOCAL_DEMO_SEED=0|false skips even in non-production. */
function isEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    !['0', 'false', 'no'].includes(String(process.env.LOCAL_DEMO_SEED ?? '').toLowerCase())
  );
}

function daysFromToday(offset: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

@Injectable()
export class LocalDemoSeed implements OnModuleInit {
  private readonly logger = new Logger(LocalDemoSeed.name);

  constructor(
    @InjectModel(WorkType.name) private readonly workTypeModel: Model<WorkTypeDocument>,
    @InjectModel(ProductModuleEntity.name)
    private readonly moduleModel: Model<ProductModuleDocument>,
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Counterparty.name) private readonly cpModel: Model<CounterpartyDocument>,
    @InjectModel(Material.name) private readonly materialModel: Model<MaterialDocument>,
    @InjectModel(Worker.name) private readonly workerModel: Model<WorkerDocument>,
    @InjectModel(Warehouse.name) private readonly warehouseModel: Model<WarehouseDocument>,
    @InjectModel(Site.name) private readonly siteModel: Model<SiteDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!isEnabled()) {
      this.logger.debug('LocalDemoSeed: skipped');
      return;
    }
    try {
      await this.seedAll();
    } catch (err) {
      this.logger.warn(`LocalDemoSeed failed: ${(err as Error).message}`);
    }
  }

  private async seedAll(): Promise<void> {
    const cp = await this.ensureCounterparty();
    await this.ensureMaterials();
    const workTypes = await this.ensureWorkTypes();
    const modules = await this.ensureModules(workTypes);
    const products = await this.ensureProducts(modules);
    await this.ensureWorkers();
    await this.ensureWorkersWithWorkTypes(workTypes);
    await this.ensureWarehouses();
    const siteId = await this.ensureSite(cp._id as Types.ObjectId);
    await this.ensureOrders(cp._id as Types.ObjectId, products, siteId);
    this.logger.log(`LocalDemoSeed ready (marker ${MARK})`);
  }

  private async ensureCounterparty(): Promise<CounterpartyDocument> {
    const name = `${PREFIX}Клиент 1`;
    const existing = await this.cpModel.findOne({ shortName: `${MARK}-CP-1` }).exec();
    if (existing) return existing;
    const any = await this.cpModel.findOne({ isActive: true }).exec();
    if (any) return any;
    return this.cpModel.create({
      name,
      shortName: `${MARK}-CP-1`,
      legalForm: 'ООО',
      legalType: 'ooo',
      inn: '7709876545',
      roles: ['customer'],
      type: ['customer'],
      partyTypes: ['customer'],
      isActive: true,
      paymentTermDays: 10,
      vatRate: 20,
    });
  }

  private async ensureMaterials(): Promise<void> {
    for (let i = 1; i <= 5; i++) {
      const sku = `${MARK}-MAT-${i}`;
      const exists = await this.materialModel.findOne({ sku }).exec();
      if (exists) continue;
      try {
        await this.materialModel.create({
          name: `${PREFIX}Материал ${i}`,
          article: sku,
          sku,
          unit: 'шт',
          materialKind: ['raw', 'part', 'fastener', 'purchased', 'other'][i - 1],
          pricePerUnit: 100 * i,
          description: `Local demo ${MARK}`,
          isActive: true,
        });
      } catch (err) {
        // Parallel nest --watch / double boot: unique sku race — treat as already seeded.
        if ((err as { code?: number })?.code === 11000) continue;
        throw err;
      }
    }
  }

  private async ensureWorkTypes(): Promise<Record<string, Types.ObjectId>> {
    const defs = [
      { key: 'weld', name: `${PREFIX}Сварка`, days: 2 },
      { key: 'paint', name: `${PREFIX}Покраска`, days: 3 },
      { key: 'wood', name: `${PREFIX}Столярка`, days: 4 },
      { key: 'asm', name: `${PREFIX}Сборка`, days: 2 },
      { key: 'pack', name: `${PREFIX}Упаковка`, days: 1 },
    ];
    const out: Record<string, Types.ObjectId> = {};
    for (const d of defs) {
      let doc = await this.workTypeModel.findOne({ name: d.name }).exec();
      if (!doc) {
        doc = await this.workTypeModel.create({
          name: d.name,
          section: 'Производство',
          department: 'Цех',
          isActive: true,
          defaultDurationHours: d.days * 8,
          hourlyRate: 800,
          days: d.days,
        });
      } else if (doc.days == null) {
        doc.days = d.days;
        await doc.save();
      }
      out[d.key] = doc._id as Types.ObjectId;
    }
    return out;
  }

  private async ensureModules(
    workTypes: Record<string, Types.ObjectId>,
  ): Promise<Record<string, Types.ObjectId>> {
    const defs = [
      { article: `${MARK}-MOD-FRAME`, name: `${PREFIX}Каркас`, wts: ['weld', 'paint'] },
      { article: `${MARK}-MOD-PANEL`, name: `${PREFIX}Панель`, wts: ['wood', 'paint'] },
      { article: `${MARK}-MOD-FINAL`, name: `${PREFIX}Финиш`, wts: ['asm', 'pack'] },
    ];
    const out: Record<string, Types.ObjectId> = {};
    for (const [idx, d] of defs.entries()) {
      const workTypeRows = d.wts.map((k, sortOrder) => ({
        workTypeId: workTypes[k]!,
        estimatedHours: 8,
        sortOrder,
      }));
      let doc = await this.moduleModel.findOne({ article: d.article }).exec();
      if (!doc) {
        doc = await this.moduleModel.create({
          name: d.name,
          article: d.article,
          dimensions: { width: 1000, height: 600, depth: 40, unit: 'мм' },
          weight: idx + 1,
          sortOrder: idx,
          workTypes: workTypeRows,
          materials: [],
          composition: [],
        });
      } else if (!doc.workTypes?.length) {
        doc.workTypes = workTypeRows;
        await doc.save();
      }
      out[d.article] = doc._id as Types.ObjectId;
    }
    return out;
  }

  private async ensureProducts(
    modules: Record<string, Types.ObjectId>,
  ): Promise<Record<string, { id: Types.ObjectId; name: string; sku: string; price: number }>> {
    const defs = [
      {
        sku: `${MARK}-PRD-GATE`,
        name: `${PREFIX}Калитка цеховая`,
        mods: [`${MARK}-MOD-FRAME`, `${MARK}-MOD-FINAL`],
        price: 45000,
      },
      {
        sku: `${MARK}-PRD-DOOR`,
        name: `${PREFIX}Дверь входная`,
        mods: [`${MARK}-MOD-FRAME`, `${MARK}-MOD-PANEL`, `${MARK}-MOD-FINAL`],
        price: 78000,
      },
      {
        sku: `${MARK}-PRD-PANEL`,
        name: `${PREFIX}Панель облицовки`,
        mods: [`${MARK}-MOD-PANEL`],
        price: 12000,
      },
    ];
    const out: Record<
      string,
      { id: Types.ObjectId; name: string; sku: string; price: number }
    > = {};
    for (const d of defs) {
      let doc = await this.productModel.findOne({ sku: d.sku }).exec();
      const composition = d.mods.map((article, sortOrder) => ({
        lineType: 'module' as const,
        refId: modules[article]!,
        quantity: 1,
        sortOrder,
        unit: 'шт',
      }));
      if (!doc) {
        doc = await this.productModel.create({
          name: d.name,
          sku: d.sku,
          kind: 'good',
          unit: 'шт',
          status: 'active',
          listPrice: d.price,
          basePrice: Math.round(d.price * 0.8),
          isActive: true,
          composition,
          productModuleIds: d.mods.map((a) => modules[a]!),
        });
      } else if (!doc.composition?.length) {
        doc.composition = composition as never;
        doc.productModuleIds = d.mods.map((a) => modules[a]!);
        await doc.save();
      }
      out[d.sku] = {
        id: doc._id as Types.ObjectId,
        name: d.name,
        sku: d.sku,
        price: d.price,
      };
    }
    return out;
  }

  private async ensureWorkers(): Promise<void> {
    const people: Array<[string, string]> = [
      ['Иванов', 'Иван'],
      ['Петров', 'Пётр'],
      ['Сидоров', 'Сидор'],
      ['Козлова', 'Анна'],
      ['Орлов', 'Олег'],
    ];
    for (const [idx, [lastName, firstName]] of people.entries()) {
      const exists = await this.workerModel
        .findOne({ lastName, firstName, department: `${PREFIX}Цех` })
        .exec();
      if (exists) continue;
      await this.workerModel.create({
        lastName,
        firstName,
        patronymic: 'Демович',
        department: `${PREFIX}Цех`,
        grade: `${(idx % 3) + 3}-й разряд`,
        phone: `+7 (900) 100-20-0${idx + 1}`,
        isActive: true,
        workTypeIds: [], // filled after work types exist — see seedAll order
      });
    }
  }

  private async ensureWorkersWithWorkTypes(
    workTypes: Record<string, Types.ObjectId>,
  ): Promise<void> {
    const ids = Object.values(workTypes);
    if (!ids.length) return;
    const people = await this.workerModel.find({ department: `${PREFIX}Цех` }).exec();
    let i = 0;
    for (const w of people) {
      if (w.workTypeIds?.length) {
        i++;
        continue;
      }
      w.workTypeIds = [ids[i % ids.length]!, ids[(i + 1) % ids.length]!].filter(
        (v, idx, a) => a.findIndex((x) => String(x) === String(v)) === idx,
      );
      await w.save();
      i++;
    }
  }

  private async ensureWarehouses(): Promise<void> {
    for (let i = 1; i <= 3; i++) {
      const name = `${PREFIX}Склад ${i}`;
      const exists = await this.warehouseModel.findOne({ name }).exec();
      if (exists) continue;
      await this.warehouseModel.create({
        name,
        type: ['main', 'production', 'branch'][i - 1],
        address: `Локальный адрес ${i}`,
        description: `Demo ${MARK}`,
        isActive: true,
        zoneNames: [`Зона A${i}`, `Зона B${i}`],
      });
    }
  }

  private async ensureSite(counterpartyId: Types.ObjectId): Promise<Types.ObjectId> {
    const existing = await this.siteModel
      .findOne({ counterpartyId, deletedAt: null })
      .exec();
    if (existing) return existing._id as Types.ObjectId;
    const created = await this.siteModel.create({
      counterpartyId,
      name: `${PREFIX}Объект 1`,
      address: 'Локальный адрес объекта',
      isActive: true,
    });
    return created._id as Types.ObjectId;
  }

  private async ensureOrders(
    counterpartyId: Types.ObjectId,
    products: Record<string, { id: Types.ObjectId; name: string; sku: string; price: number }>,
    siteId: Types.ObjectId,
  ): Promise<void> {
    const defs = [
      {
        number: `${MARK}-ORD-001`,
        status: 'in_production' as const,
        plannedOffset: 0,
        sku: `${MARK}-PRD-GATE`,
        qty: 1,
      },
      {
        number: `${MARK}-ORD-002`,
        status: 'confirmed' as const,
        plannedOffset: 3,
        sku: `${MARK}-PRD-DOOR`,
        qty: 2,
      },
      {
        number: `${MARK}-ORD-003`,
        status: 'draft' as const,
        plannedOffset: -1,
        sku: `${MARK}-PRD-PANEL`,
        qty: 4,
      },
      {
        number: `${MARK}-ORD-004`,
        status: 'ready' as const,
        plannedOffset: -5,
        sku: `${MARK}-PRD-GATE`,
        qty: 1,
      },
      {
        number: `${MARK}-ORD-005`,
        status: 'in_production' as const,
        plannedOffset: 7,
        sku: `${MARK}-PRD-DOOR`,
        qty: 1,
      },
    ];
    for (const o of defs) {
      const exists = await this.orderModel.findOne({ number: o.number }).exec();
      if (exists) {
        if (!exists.siteId) {
          exists.siteId = siteId;
          await exists.save();
        }
        continue;
      }
      const product = products[o.sku];
      if (!product) continue;
      const unitPrice = product.price;
      await this.orderModel.create({
        number: o.number,
        counterpartyId,
        siteId,
        date: daysFromToday(o.plannedOffset - 2),
        plannedDate: daysFromToday(o.plannedOffset),
        status: o.status,
        priority: 'normal',
        notes: `Local demo order ${MARK}`,
        isActive: true,
        total: unitPrice * o.qty,
        items: [
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            quantity: o.qty,
            unit: 'шт',
            unitPrice,
            total: unitPrice * o.qty,
          },
        ],
      });
    }
  }
}
