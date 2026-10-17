import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrderService } from './order.service';
import { OrderStatus } from './order.schema';

const COUNTERPARTY = new Types.ObjectId().toString();
const SITE = new Types.ObjectId().toString();
const PRODUCT = new Types.ObjectId().toString();
const ORGANIZATION = new Types.ObjectId().toString();
const WORKTYPE = new Types.ObjectId();

/** Shape of a stored OrderItem — unitPrice may be absent (strip-commerce). */
interface MockOrderItem {
  productId: Types.ObjectId;
  productName?: string;
  productSku?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  total: number;
  readyForWork?: boolean;
  readyAt?: Date;
  readyByUserId?: Types.ObjectId;
  /** TZ-COMBINE-402 */
  lineId?: string;
  boardLane?: 'prep' | 'design' | 'shop' | 'to_ship' | 'shipped';
  /** TZ-DASHBOARD-400: ход изделия (может отсутствовать у старых заказов). */
  status?: 'pending' | 'in_production' | 'ready' | 'shipped';
}

/** Minimal mock Mongoose document (toObject-free). */
function orderDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    number: 'ORD-0001',
    counterpartyId: new Types.ObjectId(COUNTERPARTY),
    siteId: new Types.ObjectId(SITE) as Types.ObjectId | undefined,
    quotationId: undefined as Types.ObjectId | undefined,
    organizationId: undefined as Types.ObjectId | undefined,
    plannedDate: undefined as Date | undefined,
    date: new Date(),
    status: 'draft',
    total: 0,
    isPaid: false,
    paidAt: null as Date | null,
    items: [] as MockOrderItem[],
    notes: undefined,
    priority: 'normal',
    materialsSource: 'own' as 'own' | 'customer',
    estimateDayOverrides: [] as Array<{
      orderItemIndex: number;
      moduleId: Types.ObjectId;
      workTypeId: Types.ObjectId;
      days: number;
    }>,
    estimateStartOffsets: [] as Array<{
      orderItemIndex: number;
      moduleId: Types.ObjectId;
      workTypeId: Types.ObjectId;
      offsetDays: number;
    }>,
    estimateWorkerOverrides: [] as Array<{
      orderItemIndex: number;
      moduleId: Types.ObjectId;
      workTypeId: Types.ObjectId;
      workerIds: Types.ObjectId[];
    }>,
    moduleLanes: [] as Array<{
      lineId: string;
      moduleId: Types.ObjectId;
      lane: 'prep' | 'design' | 'shop' | 'to_ship' | 'shipped';
    }>,
    markModified: jest.fn(),
    save: jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

/** Minimal mock Mongoose query wrapper (matching project convention). */
function mockQuery<T>(value: T) {
  return {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

/** TZ-COMBINE-408 — query chain `.select().lean().exec()` для каталог-моделей. */
function leanQuery<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

/** TZ-COMBINE-408 — изделие с модулем, у которого есть workType + catalog days. */
function stubShopReady(
  deps: {
    productModel: { findById: jest.Mock; find: jest.Mock };
    productModuleModel: { find: jest.Mock };
    workTypeModel: { find: jest.Mock };
  },
  moduleId = new Types.ObjectId(),
): void {
  deps.productModel.findById.mockReturnValue(
    leanQuery({ composition: [], productModuleIds: [moduleId] }),
  );
  deps.productModuleModel.find.mockReturnValue(
    leanQuery([
      { workTypes: [{ workTypeId: WORKTYPE, estimatedHours: 1, sortOrder: 0 }] },
    ]),
  );
  deps.workTypeModel.find.mockReturnValue(
    leanQuery([{ _id: WORKTYPE, days: 2 }]),
  );
}

function createService(overrides: Record<string, unknown> = {}) {
  // `model` is BOTH a constructor (`new this.model(...)`) and a static
  // query namespace (find/findById/updateOne) — same dual shape as Mongoose.
  const model = jest.fn() as jest.Mock & {
    find: jest.Mock;
    findById: jest.Mock;
    findOne: jest.Mock;
    updateOne: jest.Mock;
  };
  // `new this.model(payload)` must APPLY the payload onto a fresh doc
  // (mongoose semantics) — the service reads `doc.total`/`doc.items` after
  // construction. Mock merges payload over the base doc shape.
  model.mockImplementation((payload: Record<string, unknown>) => ({
    ...orderDoc(),
    ...payload,
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
  }));
  model.find = jest.fn();
  model.findById = jest.fn();
  model.findOne = jest.fn();
  model.updateOne = jest.fn();
  const counter = { next: jest.fn().mockResolvedValue('ORD-0001') };
  const shipmentModel = { create: jest.fn() };
  const reservationService = { create: jest.fn(), release: jest.fn() };
  const shipmentService = { create: jest.fn() };
  const sessionRunner = { run: jest.fn() };
  const sites = {
    assertBelongsTo: jest.fn().mockResolvedValue({ _id: SITE }),
    ensureDefaultForCounterparty: jest.fn(),
    findByCounterparty: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(SITE) }]),
  };
  // TZ-ORDERS-306: stub КП пишется в quotations, а «наша фирма» приходит из
  // OrganizationService.findCurrent — те же зависимости, что у сервиса.
  const quotationModel = {
    findById: jest.fn(),
    create: jest.fn().mockImplementation((payload: Record<string, unknown>) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...payload }),
    ),
  };
  const organizations = {
    findCurrent: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(ORGANIZATION) }),
  };
  // TZ-COMBINE-408: каталог-модели для gate входа в «Цех».
  const productModel = {
    findById: jest.fn(),
    find: jest.fn(),
  };
  const productModuleModel = {
    find: jest.fn(),
  };
  const workTypeModel = {
    find: jest.fn(),
  };
  const dependencies = {
    model,
    counter,
    reservationService,
    shipmentService,
    sessionRunner,
    sites,
    quotationModel,
    organizations,
    shipmentModel,
    productModel,
    productModuleModel,
    workTypeModel,
    ...overrides,
  };
  return {
    service: new OrderService(
      dependencies.model as never,
      (dependencies.shipmentModel as { create: jest.Mock }) as never,
      dependencies.counter as never,
      dependencies.reservationService as never,
      dependencies.shipmentService as never,
      dependencies.sessionRunner as never,
      dependencies.sites as never,
      dependencies.quotationModel as never,
      dependencies.organizations as never,
      dependencies.productModel as never,
      dependencies.productModuleModel as never,
      dependencies.workTypeModel as never,
    ),
    model: dependencies.model as jest.Mock & {
      find: jest.Mock;
      findById: jest.Mock;
      findOne: jest.Mock;
      updateOne: jest.Mock;
    },
    counter: dependencies.counter as { next: jest.Mock },
    sessionRunner: dependencies.sessionRunner as { run: jest.Mock },
    sites: dependencies.sites as {
      assertBelongsTo: jest.Mock;
      findByCounterparty: jest.Mock;
    },
    quotationModel: dependencies.quotationModel as { findById: jest.Mock; create: jest.Mock },
    organizations: dependencies.organizations as { findCurrent: jest.Mock },
    shipmentModel: dependencies.shipmentModel as { create: jest.Mock },
    productModel: dependencies.productModel as { findById: jest.Mock; find: jest.Mock },
    productModuleModel: dependencies.productModuleModel as { find: jest.Mock },
    workTypeModel: dependencies.workTypeModel as { find: jest.Mock },
  };
}

function validCreateDto(overrides: Record<string, unknown> = {}) {
  return {
    counterpartyId: COUNTERPARTY,
    siteId: SITE,
    items: [
      {
        productId: PRODUCT,
        productName: 'Стенд напольный',
        productSku: 'SKU-100',
        quantity: 2,
        unit: 'шт',
        unitPrice: 5000,
      },
    ],
    ...overrides,
  };
}

describe('OrderService — TZ-ORDERS-301', () => {
  describe('create (from accepted quote — strip commerce)', () => {
    it('generates the number via counter when omitted', async () => {
      const { service, counter } = createService();

      const result = await service.create(validCreateDto() as never);
      expect(counter.next).toHaveBeenCalledWith('Order', 'ORD');
      expect(result.number).toBe('ORD-0001');
      expect(result.save).toHaveBeenCalled();
    });

    it('computes total from items (qty × unitPrice) when prices ARE provided', async () => {
      const { service } = createService();

      const result = await service.create(validCreateDto() as never);
      expect(result).toMatchObject({ total: 10000 });
      expect(result.items[0]).toMatchObject({ quantity: 2, unitPrice: 5000, total: 10000 });
    });

    it('STRIPS COMMERCE: unitPrice omitted → item total and order total stay 0, inline snapshot kept', async () => {
      // Conversion path (QuotationService.convertToOrder) sends items WITHOUT
      // unitPrice — the order must NOT recompute commerce from the quote.
      const { service } = createService();

      const result = await service.create(
        validCreateDto({
          items: [
            {
              productId: PRODUCT,
              productName: 'Стенд напольный',
              productSku: 'SKU-100',
              quantity: 3,
              unit: 'шт',
              // no unitPrice → strip-commerce
            },
          ],
        }) as never,
      );
      expect(result.total).toBe(0);
      expect(result.items[0].total).toBe(0);
      // SNAPSHOT survives.
      expect(result.items[0]).toMatchObject({
        productName: 'Стенд напольный',
        productSku: 'SKU-100',
      });
    });

    it('stores the inline product snapshot (productName/productSku) at create time', async () => {
      const { service } = createService();

      const result = await service.create(
        validCreateDto({
          items: [
            {
              productId: PRODUCT,
              productName: 'Старое название',
              productSku: 'SKU-OLD',
              quantity: 1,
              unitPrice: 100,
            },
          ],
        }) as never,
      );
      expect(result.items[0]).toMatchObject({
        productName: 'Старое название',
        productSku: 'SKU-OLD',
      });
      expect(result.items[0].productId).toBeInstanceOf(Types.ObjectId);
    });

    it('DEFAULT status = draft when omitted (TZ-OPS-315)', async () => {
      const { service } = createService();

      const result = await service.create(validCreateDto() as never);
      expect(result.status).toBe('draft');
    });

    it('creates an unpaid direct order with a null paidAt and no quotationId (S31)', async () => {
      const { service } = createService();

      const result = await service.create(validCreateDto() as never);

      expect(result.quotationId).toBeUndefined();
      expect(result.isPaid).toBe(false);
      expect(result.paidAt).toBeNull();
      expect(result.status).toBe('draft');
    });

    it('marks a created order paid and assigns paidAt when omitted (S31)', async () => {
      const { service } = createService();
      const before = Date.now();

      const result = await service.create(
        validCreateDto({ isPaid: true }) as never,
      );

      expect(result.isPaid).toBe(true);
      expect(result.paidAt).toBeInstanceOf(Date);
      expect(result.paidAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.paidAt!.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('TZ-COMBINE-402: create assigns lineId + boardLane prep + status pending', async () => {
      const { service } = createService();

      const result = await service.create(validCreateDto() as never);
      expect(result.items[0].lineId).toEqual(expect.any(String));
      expect(result.items[0].lineId.length).toBeGreaterThan(8);
      expect(result.items[0]).toMatchObject({
        boardLane: 'prep',
        status: 'pending',
      });
    });

    it('ALLOWS explicit confirmed on create (TZ-OPS-315)', async () => {
      const { service } = createService();

      const result = await service.create(
        validCreateDto({ status: 'confirmed' }) as never,
      );
      expect(result.status).toBe('confirmed');
      expect(result.save).toHaveBeenCalled();
    });

    it('BLOCKS create directly in shipped/delivered/cancelled/in_production/ready — no mutation (TZ-OPS-315)', async () => {
      const { service, model } = createService();

      for (const status of [
        'shipped',
        'delivered',
        'cancelled',
        'in_production',
        'ready',
      ] as const) {
        await expect(
          service.create(validCreateDto({ status }) as never),
        ).rejects.toMatchObject({
          message: expect.stringContaining(
            'Заказ нельзя создать сразу в статусе',
          ) as never,
        });
      }
      // Guard сработал до создания документа (model-конструктор не вызывался).
      expect(model).toHaveBeenCalledTimes(0);
    });
  });

  describe('findAll / findById', () => {
    it('returns [] for an INVALID counterpartyId filter (no DB hit)', async () => {
      const { service, model } = createService();

      await expect(service.findAll('not-an-object-id')).resolves.toEqual([]);
      expect(model.find).not.toHaveBeenCalled();
    });

    it('builds the filter and returns populated docs', async () => {
      const { service, model } = createService();
      const docs = [orderDoc({}), orderDoc({})];
      model.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(docs),
      });

      const result = await service.findAll(COUNTERPARTY, 'confirmed');
      expect(model.find).toHaveBeenCalledWith({
        deletedAt: null,
        counterpartyId: new Types.ObjectId(COUNTERPARTY),
        status: 'confirmed',
      });
      expect(result).toBe(docs);
    });

    it('findById throws 404 when the order is soft-deleted (TZ-ORDERS-308)', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ deletedAt: new Date() });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(service.findById(doc._id.toString())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('findById throws 404 on an invalid id before any query', async () => {
      const { service, model } = createService();

      await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('findById throws 404 when the doc is missing', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(null));

      await expect(service.findById(new Types.ObjectId().toString())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('backfills stable legacy lineId + boardLane from status on findById (TZ-COMBINE-402)', async () => {
      const { service, model } = createService();
      const orderId = new Types.ObjectId();
      const doc = orderDoc({
        _id: orderId,
        items: [
          {
            productId: new Types.ObjectId(PRODUCT),
            quantity: 1,
            total: 0,
            status: 'in_production',
          },
          {
            productId: new Types.ObjectId(PRODUCT),
            quantity: 1,
            total: 0,
            status: 'ready',
          },
          {
            productId: new Types.ObjectId(PRODUCT),
            quantity: 1,
            total: 0,
            status: 'shipped',
          },
          {
            productId: new Types.ObjectId(PRODUCT),
            quantity: 1,
            total: 0,
            // pending / missing status → prep
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      const result = await service.findById(orderId.toString());
      expect(result.items[0].lineId).toBe(`legacy-0-${orderId.toString()}`);
      expect(result.items[0].boardLane).toBe('shop');
      expect(result.items[1].lineId).toBe(`legacy-1-${orderId.toString()}`);
      expect(result.items[1].boardLane).toBe('to_ship');
      expect(result.items[2].boardLane).toBe('shipped');
      expect(result.items[3].boardLane).toBe('prep');
      expect(doc.markModified).toHaveBeenCalledWith('items');
      expect(doc.save).toHaveBeenCalled();
    });

    it('does not re-save when lineId and boardLane already present (TZ-COMBINE-402)', async () => {
      const { service, model } = createService();
      const doc = orderDoc({
        items: [
          {
            productId: new Types.ObjectId(PRODUCT),
            quantity: 1,
            total: 0,
            lineId: 'already-there',
            boardLane: 'design',
            status: 'pending',
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.findById(doc._id.toString());
      expect(doc.items[0].lineId).toBe('already-there');
      expect(doc.items[0].boardLane).toBe('design');
      expect(doc.save).not.toHaveBeenCalled();
    });
  });

  describe('update (frozen after production)', () => {
    it('BLOCKS composition updates once the order is in_production/ready/shipped/delivered/cancelled', async () => {
      const { service, model } = createService();
      for (const status of [
        'in_production',
        'ready',
        'shipped',
        'delivered',
        'cancelled',
      ] as OrderStatus[]) {
        model.findById.mockReturnValue(mockQuery(orderDoc({ status })));
        await expect(
          service.update(new Types.ObjectId().toString(), { notes: 'меняю' } as never),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(model.findById).toHaveBeenCalledTimes(5);
    });

    it('ALLOWS updates for draft/confirmed orders and mutates fields', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'confirmed' });
      model.findById.mockReturnValue(mockQuery(doc));

      const result = await service.update(doc._id.toString(), {
        notes: 'новая заметка',
        priority: 'urgent',
      } as never);
      expect(doc.notes).toBe('новая заметка');
      expect(doc.priority).toBe('urgent');
      expect(doc.save).toHaveBeenCalled();
      expect(result).toBe(doc);
    });

    it('PATCH number updates doc.number when unique (TZ-ORDERS-308)', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'confirmed', number: 'ORD-0001' });
      model.findById.mockReturnValue(mockQuery(doc));
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.update(doc._id.toString(), { number: 'ORD-0099' } as never);
      expect(doc.number).toBe('ORD-0099');
      expect(model.findOne).toHaveBeenCalledWith({
        number: 'ORD-0099',
        _id: { $ne: doc._id },
        deletedAt: null,
      });
      expect(doc.save).toHaveBeenCalled();
    });

    it('PATCH number rejects duplicate with 409 Conflict (TZ-ORDERS-308)', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'confirmed', number: 'ORD-0001' });
      model.findById.mockReturnValue(mockQuery(doc));
      model.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(orderDoc({ number: 'ORD-0099' })),
      });

      await expect(
        service.update(doc._id.toString(), { number: 'ORD-0099' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('allows number change in in_production (TZ-ORDERS-308)', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'in_production', number: 'ORD-0001' });
      model.findById.mockReturnValue(mockQuery(doc));
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.update(doc._id.toString(), { number: 'ORD-0099' } as never);
      expect(doc.number).toBe('ORD-0099');
    });

    it('marks an existing order paid without changing its lifecycle status (S31)', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'confirmed', isPaid: false, paidAt: null });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), { isPaid: true } as never);

      expect(doc.isPaid).toBe(true);
      expect(doc.paidAt).toBeInstanceOf(Date);
      expect(doc.status).toBe('confirmed');
    });

    it('preserves an existing paidAt when isPaid is repeated true (S31)', async () => {
      const { service, model } = createService();
      const paidAt = new Date('2026-09-01T10:00:00.000Z');
      const doc = orderDoc({ status: 'ready', isPaid: true, paidAt });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), { isPaid: true } as never);

      expect(doc.isPaid).toBe(true);
      expect(doc.paidAt).toBe(paidAt);
      expect(doc.status).toBe('ready');
    });

    it('clears paidAt when an existing order is marked unpaid (S31)', async () => {
      const { service, model } = createService();
      const doc = orderDoc({
        status: 'in_production',
        isPaid: true,
        paidAt: new Date('2026-09-01T10:00:00.000Z'),
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), { isPaid: false } as never);

      expect(doc.isPaid).toBe(false);
      expect(doc.paidAt).toBeNull();
      expect(doc.status).toBe('in_production');
    });
  });

  describe('status transition graph (TZ-SWEEP-401)', () => {
    function orderWithItem(overrides: Record<string, unknown> = {}) {
      return orderDoc({
        items: [
          {
            productId: new Types.ObjectId(PRODUCT),
            quantity: 1,
            unitPrice: 0,
            total: 0,
          },
        ],
        ...overrides,
      });
    }

    it('BLOCKS PATCH to shipped/delivered/cancelled with RU message, no mutation', async () => {
      const { service, model } = createService();
      for (const to of ['shipped', 'delivered', 'cancelled']) {
        const doc = orderWithItem({ status: 'draft' });
        model.findById.mockReturnValueOnce(mockQuery(doc));
        await expect(
          service.update(doc._id.toString(), { status: to } as never),
        ).rejects.toMatchObject({
          message: 'Отгрузка — через действие «Отгрузить»; отмена — «Отменить заказ».',
        });
        expect(doc.status).toBe('draft');
        expect(doc.save).not.toHaveBeenCalled();
      }
      expect(model.findById).toHaveBeenCalledTimes(3);
    });

    it('BLOCKS PATCH out of a hard-frozen status (shipped → ready)', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({ status: 'shipped' });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.update(doc._id.toString(), { status: 'ready' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(doc.status).toBe('shipped');
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('ALLOWS status-only PATCH in_production → ready (no composition required)', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({ status: 'in_production' });
      model.findById.mockReturnValue(mockQuery(doc));

      const result = await service.update(doc._id.toString(), { status: 'ready' } as never);
      expect(doc.status).toBe('ready');
      expect(result).toBe(doc);
      expect(doc.save).toHaveBeenCalled();
    });

    it('ALLOWS step-back PATCH ready → in_production', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({ status: 'ready' });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), { status: 'in_production' } as never);
      expect(doc.status).toBe('in_production');
    });

    it('BLOCKS PATCH ready + notes — freeze состава не обходится статусом', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({ status: 'in_production' });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.update(doc._id.toString(), { status: 'ready', notes: 'нельзя' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(doc.status).toBe('in_production');
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('ship() creates Shipment, sets order status and marks every item shipped', async () => {
      const { service, model, sessionRunner, shipmentModel } = createService();
      const doc = orderWithItem({ status: 'ready' });
      model.findById.mockReturnValue(mockQuery(doc));
      sessionRunner.run.mockImplementation(async (fn: (s: unknown) => Promise<unknown>) =>
        fn({}),
      );
      const shipmentId = new Types.ObjectId();
      shipmentModel.create.mockResolvedValue([{ _id: shipmentId }]);

      const { order, shipmentId: createdId } = await service.ship(doc._id.toString());

      expect(order.status).toBe('shipped');
      expect(createdId).toBe(shipmentId.toString());
      expect(order.shipmentIds?.map((s) => s.toString())).toContain(shipmentId.toString());
      expect(order.items.every((item) => item.status === 'shipped')).toBe(true);
      expect(order.save).toHaveBeenCalled();
    });

    it('setItemStatus shipped on a draft order → 400 (ship() owns that transition)', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({ status: 'draft' });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.setItemStatus(doc._id.toString(), '0', 'shipped'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(doc.items[0].status).toBeUndefined();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('setItemStatus ready on a line WITHOUT status field writes the value, no throw', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({ status: 'in_production' });
      model.findById.mockReturnValueOnce(mockQuery(doc)).mockReturnValueOnce(mockQuery(doc));

      const result = await service.setItemStatus(doc._id.toString(), '0', 'ready');
      expect(doc.items[0].status).toBe('ready');
      expect(result).toBe(doc);
    });
  });

  describe('update plan fields + siteId heal (TZ-PRODUCTION-331)', () => {
    it('ALLOWS plannedDate on ready', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'ready', siteId: new Types.ObjectId(SITE) });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), {
        plannedDate: '2026-08-20T12:00:00.000Z',
      } as never);
      expect(doc.plannedDate).toEqual(new Date('2026-08-20T12:00:00.000Z'));
      expect(doc.save).toHaveBeenCalled();
    });

    it('ALLOWS priority on in_production', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'in_production', siteId: new Types.ObjectId(SITE) });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), { priority: 'urgent' } as never);
      expect(doc.priority).toBe('urgent');
      expect(doc.save).toHaveBeenCalled();
    });

    it('BLOCKS notes on ready', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'ready', siteId: new Types.ObjectId(SITE) });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.update(doc._id.toString(), { notes: 'нельзя' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('BLOCKS plannedDate on shipped', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'shipped', siteId: new Types.ObjectId(SITE) });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.update(doc._id.toString(), {
          plannedDate: '2026-08-20T12:00:00.000Z',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('heals missing siteId then saves patchEstimateDays', async () => {
      const siteOid = new Types.ObjectId(SITE);
      const { service, model, sites } = createService();
      sites.findByCounterparty.mockResolvedValue([{ _id: siteOid }]);
      const doc = orderDoc({
        status: 'ready',
        siteId: undefined,
        items: [{ productId: new Types.ObjectId(PRODUCT), quantity: 1, total: 0 }],
        estimateDayOverrides: [],
      });
      model.findById.mockReturnValue(mockQuery(doc));
      const moduleId = new Types.ObjectId();
      const workTypeId = new Types.ObjectId();

      await service.patchEstimateDays(doc._id.toString(), {
        orderItemIndex: 0,
        moduleId: moduleId.toString(),
        workTypeId: workTypeId.toString(),
        days: 4,
      });

      expect(sites.findByCounterparty).toHaveBeenCalled();
      expect(doc.siteId).toEqual(siteOid);
      expect(doc.estimateDayOverrides).toHaveLength(1);
      expect(doc.save).toHaveBeenCalled();
    });

    it('throws RU when missing siteId and Counterparty has no Site', async () => {
      const { service, model, sites } = createService();
      sites.findByCounterparty.mockResolvedValue([]);
      const doc = orderDoc({ status: 'ready', siteId: undefined });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.update(doc._id.toString(), {
          plannedDate: '2026-08-20T12:00:00.000Z',
        } as never),
      ).rejects.toMatchObject({
        message: 'У заказа нет площадки (siteId) — создайте объект у контрагента',
      });
      expect(doc.save).not.toHaveBeenCalled();
    });
  });

  describe('organizationId PATCH (TZ-NX-ORDER-WS-META-INLINE)', () => {
    it('applies organizationId — DTO validated it but update() silently ignored it before this fix', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'draft', siteId: new Types.ObjectId(SITE) });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), { organizationId: ORGANIZATION } as never);

      expect(doc.organizationId).toEqual(new Types.ObjectId(ORGANIZATION));
      expect(doc.save).toHaveBeenCalled();
    });

    it('leaves organizationId untouched when omitted from the PATCH body', async () => {
      const { service, model } = createService();
      const existingOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'draft', siteId: new Types.ObjectId(SITE), organizationId: existingOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), { notes: 'без смены фирмы' } as never);

      expect(doc.organizationId).toEqual(existingOrgId);
    });
  });

  describe('materials source (TZ-ORDERS-305)', () => {
    it('stores own/customer source and updates it without hard blocking', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'confirmed', materialsSource: 'own' });
      model.findById.mockReturnValue(mockQuery(doc));
      const result = await service.update(doc._id.toString(), { materialsSource: 'customer' } as never);
      expect(doc.materialsSource).toBe('customer');
      expect(result).toBe(doc);
    });
  });

  describe('line readiness (TZ-ORDERS-304)', () => {
    it('preserves readiness metadata when an ordinary item update omits the flag', async () => {
      const { service, model } = createService();
      const readyAt = new Date('2026-08-08T10:00:00.000Z');
      const readyByUserId = new Types.ObjectId();
      const doc = orderDoc({
        status: 'confirmed',
        items: [{ productId: new Types.ObjectId(), quantity: 1, total: 0, readyForWork: true, readyAt, readyByUserId }],
      });
      model.findById.mockReturnValue(mockQuery(doc));
      await service.update(doc._id.toString(), { items: [{ productId: doc.items[0].productId.toString(), quantity: 2 }] } as never);
      expect(doc.items[0].readyForWork).toBe(true);
      expect(doc.items[0].readyAt).toBe(readyAt);
      expect(doc.items[0].readyByUserId).toBe(readyByUserId);
    });

    it('clears readiness metadata when explicitly toggled off', async () => {
      const { service, model } = createService();
      const doc = orderDoc({
        status: 'confirmed',
        items: [{ productId: new Types.ObjectId(), quantity: 1, total: 0, readyForWork: true, readyAt: new Date(), readyByUserId: new Types.ObjectId() }],
      });
      model.findById.mockReturnValue(mockQuery(doc));
      await service.update(doc._id.toString(), { items: [{ productId: doc.items[0].productId.toString(), quantity: 2, readyForWork: false }] } as never);
      expect(doc.items[0].readyForWork).toBe(false);
      expect(doc.items[0].readyAt).toBeUndefined();
      expect(doc.items[0].readyByUserId).toBeUndefined();
    });

    it('toggles one line without changing the whole order status', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'confirmed', items: [{ productId: new Types.ObjectId(), quantity: 1, total: 0 }] });
      model.findById.mockReturnValueOnce(mockQuery(doc)).mockReturnValueOnce(mockQuery(doc));
      const result = await service.setLineReady(doc._id.toString(), '0', true, new Types.ObjectId().toString());
      expect(doc.items[0].readyForWork).toBe(true);
      expect(doc.items[0].readyAt).toBeInstanceOf(Date);
      expect(doc.status).toBe('confirmed');
      expect(result).toBe(doc);
    });
  });

  describe('stub proposal (TZ-ORDERS-306)', () => {
    function orderWithLines(overrides: Record<string, unknown> = {}) {
      return orderDoc({
        items: [
          {
            productId: new Types.ObjectId(PRODUCT),
            productName: 'Стенд напольный',
            productSku: 'SKU-100',
            quantity: 2,
            unit: 'шт',
            unitPrice: 5000,
            total: 10000,
          },
        ],
        ...overrides,
      });
    }

    it('creates a draft stub КП from the order lines and links both sides', async () => {
      const { service, model, quotationModel, organizations, counter } = createService();
      const doc = orderWithLines();
      model.findById.mockReturnValue(mockQuery(doc));
      counter.next.mockResolvedValue('QTN-0007');

      const { quotation, created } = await service.ensureStubProposal(doc._id.toString(), {
        organizationId: ORGANIZATION,
      });

      expect(created).toBe(true);
      expect(organizations.findCurrent).toHaveBeenCalledWith({ organizationId: ORGANIZATION });
      const [payload] = quotationModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(payload).toMatchObject({
        number: 'QTN-0007',
        status: 'draft',
        isStub: true,
        sourceOrderId: doc._id,
        counterpartyId: doc.counterpartyId,
        total: 10000,
      });
      expect((payload.items as unknown[])[0]).toMatchObject({
        productSku: 'SKU-100',
        quantity: 2,
        unitPrice: 5000,
        total: 10000,
      });
      // Обратная связь: заказ теперь знает своё КП.
      expect(doc.quotationId).toBe(quotation._id);
      expect(doc.save).toHaveBeenCalled();
    });

    it('IS IDEMPOTENT: an order that already has a КП returns it without creating another', async () => {
      const { service, model, quotationModel } = createService();
      const existing = { _id: new Types.ObjectId(), number: 'QTN-0001' };
      const doc = orderWithLines({ quotationId: existing._id });
      model.findById.mockReturnValue(mockQuery(doc));
      quotationModel.findById.mockReturnValue(mockQuery(existing));

      const result = await service.ensureStubProposal(doc._id.toString());

      expect(result).toEqual({ quotation: existing, created: false });
      expect(quotationModel.create).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('recreates the stub when quotationId points at a deleted КП', async () => {
      const { service, model, quotationModel } = createService();
      const doc = orderWithLines({ quotationId: new Types.ObjectId() });
      model.findById.mockReturnValue(mockQuery(doc));
      quotationModel.findById.mockReturnValue(mockQuery(null));

      const { created } = await service.ensureStubProposal(doc._id.toString());

      expect(created).toBe(true);
      expect(quotationModel.create).toHaveBeenCalledTimes(1);
    });

    it('refuses an order with no lines — an empty КП is useless for a document', async () => {
      const { service, model, quotationModel } = createService();
      const doc = orderDoc({ items: [] });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(service.ensureStubProposal(doc._id.toString())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(quotationModel.create).not.toHaveBeenCalled();
    });

    it('refuses a cancelled order', async () => {
      const { service, model, quotationModel } = createService();
      const doc = orderWithLines({ status: 'cancelled' });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(service.ensureStubProposal(doc._id.toString())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(quotationModel.create).not.toHaveBeenCalled();
    });

    it('propagates the «наша фирма не настроена» error instead of guessing an organization', async () => {
      const { service, model, quotationModel, organizations } = createService();
      const doc = orderWithLines();
      model.findById.mockReturnValue(mockQuery(doc));
      organizations.findCurrent.mockRejectedValue(
        new NotFoundException('Наша организация не настроена'),
      );

      await expect(service.ensureStubProposal(doc._id.toString())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(quotationModel.create).not.toHaveBeenCalled();
    });
  });

  describe('patchEstimateDays (TZ-PRODUCTION-309)', () => {
    const MODULE = new Types.ObjectId();
    const WORK_TYPE = new Types.ObjectId();

    function orderWithItem(overrides: Record<string, unknown> = {}) {
      return orderDoc({
        items: [
          {
            productId: new Types.ObjectId(PRODUCT),
            quantity: 1,
            unitPrice: 0,
            total: 0,
          },
        ],
        estimateDayOverrides: [],
        ...overrides,
      });
    }

    it('upserts an override by composite key', async () => {
      const { service, model } = createService();
      const doc = orderWithItem();
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateDays(doc._id.toString(), {
        orderItemIndex: 0,
        moduleId: MODULE.toString(),
        workTypeId: WORK_TYPE.toString(),
        days: 5,
      });

      expect(doc.estimateDayOverrides).toHaveLength(1);
      expect(doc.estimateDayOverrides[0]).toEqual(
        expect.objectContaining({
          orderItemIndex: 0,
          days: 5,
        }),
      );
      expect(doc.estimateDayOverrides[0].moduleId.equals(MODULE)).toBe(true);
      expect(doc.estimateDayOverrides[0].workTypeId.equals(WORK_TYPE)).toBe(true);
      expect(doc.save).toHaveBeenCalled();
    });

    it('updates existing override on same composite key', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({
        estimateDayOverrides: [
          {
            orderItemIndex: 0,
            moduleId: MODULE,
            workTypeId: WORK_TYPE,
            days: 3,
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateDays(doc._id.toString(), {
        orderItemIndex: 0,
        moduleId: MODULE.toString(),
        workTypeId: WORK_TYPE.toString(),
        days: 7,
      });

      expect(doc.estimateDayOverrides).toHaveLength(1);
      expect(doc.estimateDayOverrides[0].days).toBe(7);
    });

    it('clears override when days is null', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({
        estimateDayOverrides: [
          {
            orderItemIndex: 0,
            moduleId: MODULE,
            workTypeId: WORK_TYPE,
            days: 3,
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateDays(doc._id.toString(), {
        orderItemIndex: 0,
        moduleId: MODULE.toString(),
        workTypeId: WORK_TYPE.toString(),
        days: null,
      });

      expect(doc.estimateDayOverrides).toHaveLength(0);
    });

    it('rejects unknown order line index', async () => {
      const { service, model } = createService();
      const doc = orderWithItem();
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchEstimateDays(doc._id.toString(), {
          orderItemIndex: 9,
          moduleId: MODULE.toString(),
          workTypeId: WORK_TYPE.toString(),
          days: 2,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * TZ-NX-GANTT-L0-PEER-REVIEW — findByIdRaw is an unscoped Model.findById;
     * the only prior protection was OrgScopeGuardInterceptor, which filters
     * the RESPONSE after the handler runs. For a write, doc.save() had
     * already persisted the mutation by then — a cross-org caller couldn't
     * see the result but had already changed another organization's order.
     * These two tests prove the fix rejects BEFORE any mutation.
     */
    it('rejects a cross-org caller before saving (org leak)', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderWithItem({ organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchEstimateDays(
          doc._id.toString(),
          { orderItemIndex: 0, moduleId: MODULE.toString(), workTypeId: WORK_TYPE.toString(), days: 5 },
          new Types.ObjectId().toString(), // different org
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(doc.estimateDayOverrides).toHaveLength(0);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('allows the matching-org caller', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderWithItem({ organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateDays(
        doc._id.toString(),
        { orderItemIndex: 0, moduleId: MODULE.toString(), workTypeId: WORK_TYPE.toString(), days: 5 },
        ownerOrgId.toString(),
      );

      expect(doc.estimateDayOverrides).toHaveLength(1);
      expect(doc.save).toHaveBeenCalled();
    });
  });

  describe('patchEstimateStart (TZ-PRODUCTION-316)', () => {
    const MODULE = new Types.ObjectId();
    const WORK_TYPE = new Types.ObjectId();

    function orderWithItem(overrides: Record<string, unknown> = {}) {
      return orderDoc({
        items: [
          {
            productId: new Types.ObjectId(PRODUCT),
            quantity: 1,
            unitPrice: 0,
            total: 0,
          },
        ],
        estimateStartOffsets: [],
        ...overrides,
      });
    }

    it('upserts a start offset by composite key', async () => {
      const { service, model } = createService();
      const doc = orderWithItem();
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateStart(doc._id.toString(), {
        orderItemIndex: 0,
        moduleId: MODULE.toString(),
        workTypeId: WORK_TYPE.toString(),
        offsetDays: 3,
      });

      expect(doc.estimateStartOffsets).toHaveLength(1);
      expect(doc.estimateStartOffsets[0]).toEqual(
        expect.objectContaining({
          orderItemIndex: 0,
          offsetDays: 3,
        }),
      );
      expect(doc.estimateStartOffsets[0].moduleId.equals(MODULE)).toBe(true);
      expect(doc.save).toHaveBeenCalled();
    });

    it('clears offset when offsetDays is null', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({
        estimateStartOffsets: [
          {
            orderItemIndex: 0,
            moduleId: MODULE,
            workTypeId: WORK_TYPE,
            offsetDays: 2,
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateStart(doc._id.toString(), {
        orderItemIndex: 0,
        moduleId: MODULE.toString(),
        workTypeId: WORK_TYPE.toString(),
        offsetDays: null,
      });

      expect(doc.estimateStartOffsets).toHaveLength(0);
    });

    it('rejects negative offsetDays', async () => {
      const { service, model } = createService();
      const doc = orderWithItem();
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchEstimateStart(doc._id.toString(), {
          orderItemIndex: 0,
          moduleId: MODULE.toString(),
          workTypeId: WORK_TYPE.toString(),
          offsetDays: -1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    /** TZ-NX-GANTT-L0-PEER-REVIEW — same org-leak class as patchEstimateDays above. */
    it('rejects a cross-org caller before saving (org leak)', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderWithItem({ organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchEstimateStart(
          doc._id.toString(),
          { orderItemIndex: 0, moduleId: MODULE.toString(), workTypeId: WORK_TYPE.toString(), offsetDays: 3 },
          new Types.ObjectId().toString(), // different org
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(doc.estimateStartOffsets).toHaveLength(0);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('allows the matching-org caller', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderWithItem({ organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateStart(
        doc._id.toString(),
        { orderItemIndex: 0, moduleId: MODULE.toString(), workTypeId: WORK_TYPE.toString(), offsetDays: 3 },
        ownerOrgId.toString(),
      );

      expect(doc.estimateStartOffsets).toHaveLength(1);
      expect(doc.save).toHaveBeenCalled();
    });
  });

  describe('patchEstimateWorker (TZ-NX-GANTT-G14)', () => {
    const MODULE = new Types.ObjectId();
    const WORK_TYPE = new Types.ObjectId();
    const WORKER_A = new Types.ObjectId();
    const WORKER_B = new Types.ObjectId();

    function orderWithItem(overrides: Record<string, unknown> = {}) {
      return orderDoc({
        items: [
          {
            productId: new Types.ObjectId(PRODUCT),
            quantity: 1,
            unitPrice: 0,
            total: 0,
          },
        ],
        estimateWorkerOverrides: [],
        ...overrides,
      });
    }

    it('upserts an override by composite key', async () => {
      const { service, model } = createService();
      const doc = orderWithItem();
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateWorker(doc._id.toString(), {
        orderItemIndex: 0,
        moduleId: MODULE.toString(),
        workTypeId: WORK_TYPE.toString(),
        workerIds: [WORKER_A.toString(), WORKER_B.toString()],
      });

      expect(doc.estimateWorkerOverrides).toHaveLength(1);
      expect(doc.estimateWorkerOverrides[0]).toEqual(
        expect.objectContaining({ orderItemIndex: 0 }),
      );
      expect(doc.estimateWorkerOverrides[0].moduleId.equals(MODULE)).toBe(true);
      expect(doc.estimateWorkerOverrides[0].workTypeId.equals(WORK_TYPE)).toBe(true);
      expect(
        doc.estimateWorkerOverrides[0].workerIds.map((w: Types.ObjectId) => w.toString()),
      ).toEqual([WORKER_A.toString(), WORKER_B.toString()]);
      expect(doc.save).toHaveBeenCalled();
    });

    it('updates existing override on same composite key', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({
        estimateWorkerOverrides: [
          {
            orderItemIndex: 0,
            moduleId: MODULE,
            workTypeId: WORK_TYPE,
            workerIds: [WORKER_A],
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateWorker(doc._id.toString(), {
        orderItemIndex: 0,
        moduleId: MODULE.toString(),
        workTypeId: WORK_TYPE.toString(),
        workerIds: [WORKER_B.toString()],
      });

      expect(doc.estimateWorkerOverrides).toHaveLength(1);
      expect(
        doc.estimateWorkerOverrides[0].workerIds.map((w: Types.ObjectId) => w.toString()),
      ).toEqual([WORKER_B.toString()]);
    });

    it('clears override when workerIds is empty (falls back to «Не назначен», not skills)', async () => {
      const { service, model } = createService();
      const doc = orderWithItem({
        estimateWorkerOverrides: [
          {
            orderItemIndex: 0,
            moduleId: MODULE,
            workTypeId: WORK_TYPE,
            workerIds: [WORKER_A],
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateWorker(doc._id.toString(), {
        orderItemIndex: 0,
        moduleId: MODULE.toString(),
        workTypeId: WORK_TYPE.toString(),
        workerIds: [],
      });

      expect(doc.estimateWorkerOverrides).toHaveLength(0);
    });

    it('rejects unknown order line index', async () => {
      const { service, model } = createService();
      const doc = orderWithItem();
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchEstimateWorker(doc._id.toString(), {
          orderItemIndex: 9,
          moduleId: MODULE.toString(),
          workTypeId: WORK_TYPE.toString(),
          workerIds: [WORKER_A.toString()],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /** TZ-NX-GANTT-L0-PEER-REVIEW — same org-leak class as patchEstimateDays above. */
    it('rejects a cross-org caller before saving (org leak)', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderWithItem({ organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchEstimateWorker(
          doc._id.toString(),
          {
            orderItemIndex: 0,
            moduleId: MODULE.toString(),
            workTypeId: WORK_TYPE.toString(),
            workerIds: [WORKER_A.toString()],
          },
          new Types.ObjectId().toString(), // different org
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(doc.estimateWorkerOverrides).toHaveLength(0);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('allows the matching-org caller', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderWithItem({ organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchEstimateWorker(
        doc._id.toString(),
        {
          orderItemIndex: 0,
          moduleId: MODULE.toString(),
          workTypeId: WORK_TYPE.toString(),
          workerIds: [WORKER_A.toString()],
        },
        ownerOrgId.toString(),
      );

      expect(doc.estimateWorkerOverrides).toHaveLength(1);
      expect(doc.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('SOFT-DELETES an order (sets deletedAt)', async () => {
      const { service, model } = createService();
      const doc = orderDoc({});
      model.findById.mockReturnValue(mockQuery(doc));
      // remove() calls `.updateOne(...).exec()`.
      model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.remove(doc._id.toString());
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        { $set: { deletedAt: expect.any(Date), isActive: false } },
      );
    });

    it('findAll excludes soft-deleted orders (TZ-ORDERS-308)', async () => {
      const { service, model } = createService();
      const active = orderDoc({});
      model.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([active]),
      });

      const result = await service.findAll();
      expect(model.find).toHaveBeenCalledWith({ deletedAt: null });
      expect(result).toEqual([active]);
    });
  });

  describe('TZ-COMBINE-403 patchLineBoardLane + rollupOrderStatus', () => {
    function line(
      lane: MockOrderItem['boardLane'],
      lineId = 'line-a',
    ): MockOrderItem {
      return {
        lineId,
        boardLane: lane,
        productId: new Types.ObjectId(PRODUCT),
        quantity: 1,
        unitPrice: 0,
        total: 0,
        status: 'pending',
      };
    }

    it('rejects lane=shipped via PATCH with RU message', async () => {
      const { service, model } = createService();
      const doc = orderDoc({
        status: 'confirmed',
        items: [line('prep')],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchLineBoardLane(doc._id.toString(), 'line-a', 'shipped'),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Отгружены') as never,
      });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('rejects unknown lineId with 404 NotFound (HTTP-contract)', async () => {
      const { service, model } = createService();
      const doc = orderDoc({
        status: 'draft',
        items: [line('prep', 'line-a')],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchLineBoardLane(doc._id.toString(), 'nope', 'shop'),
      ).rejects.toMatchObject({
        message: expect.stringContaining('not found') as never,
      });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('writes boardLane + derived status and rollups Order.status', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({
        status: 'draft',
        items: [line('prep')],
      });
      model.findById.mockReturnValue(mockQuery(doc));
      stubShopReady({ productModel, productModuleModel, workTypeModel });

      await service.patchLineBoardLane(doc._id.toString(), 'line-a', 'shop');
      expect(doc.items[0]).toMatchObject({
        boardLane: 'shop',
        status: 'in_production',
      });
      expect(doc.status).toBe('in_production');
      expect(doc.markModified).toHaveBeenCalledWith('items');
      expect(doc.save).toHaveBeenCalled();
    });

    it('rollup: all prep keeps draft', () => {
      const { service } = createService();
      const doc = orderDoc({
        status: 'draft',
        items: [line('prep', 'a'), line('prep', 'b')],
      });
      service.rollupOrderStatus(doc as never);
      expect(doc.status).toBe('draft');
    });

    it('rollup: first leave prep → confirmed', () => {
      const { service } = createService();
      const doc = orderDoc({
        status: 'draft',
        items: [line('design', 'a'), line('prep', 'b')],
      });
      service.rollupOrderStatus(doc as never);
      expect(doc.status).toBe('confirmed');
    });

    it('rollup: any shop → in_production', () => {
      const { service } = createService();
      const doc = orderDoc({
        status: 'confirmed',
        items: [line('shop', 'a'), line('to_ship', 'b')],
      });
      service.rollupOrderStatus(doc as never);
      expect(doc.status).toBe('in_production');
    });

    it('rollup: all to_ship → ready', () => {
      const { service } = createService();
      const doc = orderDoc({
        status: 'in_production',
        items: [line('to_ship', 'a'), line('to_ship', 'b')],
      });
      service.rollupOrderStatus(doc as never);
      expect(doc.status).toBe('ready');
    });

    it('rollup: all prep after leave stays confirmed (monotonic, no draft)', () => {
      const { service } = createService();
      const doc = orderDoc({
        status: 'ready',
        items: [line('prep', 'a'), line('prep', 'b')],
      });
      service.rollupOrderStatus(doc as never);
      expect(doc.status).toBe('confirmed');
    });

    it('rollup: never sets shipped; hard-frozen unchanged', () => {
      const { service } = createService();
      const shipped = orderDoc({
        status: 'shipped',
        items: [line('to_ship', 'a')],
      });
      service.rollupOrderStatus(shipped as never);
      expect(shipped.status).toBe('shipped');

      const cancelled = orderDoc({
        status: 'cancelled',
        items: [line('shop', 'a')],
      });
      service.rollupOrderStatus(cancelled as never);
      expect(cancelled.status).toBe('cancelled');
    });

    it('blocks deleting a non-prep line via update items shrink', async () => {
      const { service, model } = createService();
      const doc = orderDoc({
        status: 'confirmed',
        items: [
          line('prep', 'keep'),
          {
            ...line('shop', 'drop'),
            status: 'in_production',
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.update(doc._id.toString(), {
          items: [
            {
              productId: PRODUCT,
              quantity: 1,
              unitPrice: 0,
            },
          ],
        } as never),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Комплектация') as never,
      });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('allows deleting a prep line via update items shrink', async () => {
      const { service, model } = createService();
      const doc = orderDoc({
        status: 'draft',
        items: [line('prep', 'keep'), line('prep', 'drop')],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), {
        items: [
          {
            productId: PRODUCT,
            quantity: 1,
            unitPrice: 0,
          },
        ],
      } as never);
      expect(doc.items).toHaveLength(1);
      expect(doc.items[0].lineId).toBe('keep');
      expect(doc.save).toHaveBeenCalled();
    });
  });

  describe('TZ-COMBINE-406 patchModuleLane + module lane rollup', () => {
    const MODULE_A = new Types.ObjectId();
    const MODULE_B = new Types.ObjectId();

    function line(
      lane: MockOrderItem['boardLane'],
      lineId = 'line-a',
    ): MockOrderItem {
      return {
        lineId,
        boardLane: lane,
        productId: new Types.ObjectId(PRODUCT),
        quantity: 1,
        unitPrice: 0,
        total: 0,
        status: 'pending',
      };
    }

    it('rejects lane=shipped via module PATCH with RU message', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'confirmed', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchModuleLane(
          doc._id.toString(),
          'line-a',
          MODULE_A.toString(),
          'shipped',
        ),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Отгружены') as never,
      });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('rejects unknown lineId with 404', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'draft', items: [line('prep', 'line-a')] });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchModuleLane(doc._id.toString(), 'nope', MODULE_A.toString(), 'shop'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('rejects invalid moduleId with 400', async () => {
      const { service, model } = createService();
      const doc = orderDoc({ status: 'draft', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchModuleLane(doc._id.toString(), 'line-a', 'not-an-id', 'shop'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('upserts a sparse moduleLane entry keyed by (lineId, moduleId)', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({ status: 'draft', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));
      stubShopReady(
        { productModel, productModuleModel, workTypeModel },
        MODULE_A,
      );

      await service.patchModuleLane(
        doc._id.toString(),
        'line-a',
        MODULE_A.toString(),
        'shop',
      );
      expect(doc.moduleLanes).toHaveLength(1);
      expect(doc.moduleLanes[0]).toEqual(
        expect.objectContaining({ lineId: 'line-a', lane: 'shop' }),
      );
      expect(doc.moduleLanes[0].moduleId.equals(MODULE_A)).toBe(true);

      await service.patchModuleLane(
        doc._id.toString(),
        'line-a',
        MODULE_A.toString(),
        'to_ship',
      );
      expect(doc.moduleLanes).toHaveLength(1);
      expect(doc.moduleLanes[0].lane).toBe('to_ship');
    });

    it('rollup follows min: parent band = earliest module lane, last module leave → ready', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({
        status: 'confirmed',
        items: [line('to_ship', 'line-a')],
      });
      model.findById.mockReturnValue(mockQuery(doc));
      stubShopReady(
        { productModel, productModuleModel, workTypeModel },
        MODULE_A,
      );

      await service.patchModuleLane(
        doc._id.toString(),
        'line-a',
        MODULE_A.toString(),
        'shop',
      );
      expect(doc.status).toBe('in_production');

      await service.patchModuleLane(
        doc._id.toString(),
        'line-a',
        MODULE_A.toString(),
        'to_ship',
      );
      expect(doc.status).toBe('ready');
    });

    it('effectiveLineLane: no moduleLanes → boardLane; with lanes → min', () => {
      const { service } = createService();
      const doc = orderDoc({
        items: [line('to_ship', 'line-a')],
        moduleLanes: [
          { lineId: 'line-a', moduleId: MODULE_A, lane: 'design' },
          { lineId: 'line-a', moduleId: MODULE_B, lane: 'shop' },
        ],
      });

      expect(service.effectiveLineLane(doc as never, doc.items[0] as never)).toBe(
        'design',
      );

      const bare = orderDoc({ items: [line('design', 'line-b')] });
      expect(service.effectiveLineLane(bare as never, bare.items[0] as never)).toBe(
        'design',
      );
    });
  });

  describe('TZ-COMBINE-408 shop workType/days gate', () => {
    const MODULE_A = new Types.ObjectId();

    function line(
      lane: MockOrderItem['boardLane'],
      lineId = 'line-a',
    ): MockOrderItem {
      return {
        lineId,
        boardLane: lane,
        productId: new Types.ObjectId(PRODUCT),
        quantity: 1,
        unitPrice: 0,
        total: 0,
        status: 'pending',
      };
    }

    it('line → shop: 400 RU когда у изделия нет модулей', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({ status: 'confirmed', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));
      productModel.findById.mockReturnValue(
        leanQuery({ composition: [], productModuleIds: [] }),
      );

      await expect(
        service.patchLineBoardLane(doc._id.toString(), 'line-a', 'shop'),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Цех') as never,
      });
      expect(doc.save).not.toHaveBeenCalled();
      expect(productModuleModel.find).not.toHaveBeenCalled();
      expect(workTypeModel.find).not.toHaveBeenCalled();
    });

    it('line → shop: 400 RU когда у модулей нет видов работ', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({ status: 'confirmed', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));
      productModel.findById.mockReturnValue(
        leanQuery({ composition: [], productModuleIds: [MODULE_A] }),
      );
      productModuleModel.find.mockReturnValue(leanQuery([{ workTypes: [] }]));

      await expect(
        service.patchLineBoardLane(doc._id.toString(), 'line-a', 'shop'),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Цех') as never,
      });
      expect(workTypeModel.find).not.toHaveBeenCalled();
    });

    it('line → shop: 400 RU когда в каталоге нет дней и нет overrides', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({ status: 'confirmed', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));
      productModel.findById.mockReturnValue(
        leanQuery({ composition: [], productModuleIds: [MODULE_A] }),
      );
      productModuleModel.find.mockReturnValue(
        leanQuery([
          { workTypes: [{ workTypeId: WORKTYPE, estimatedHours: 1, sortOrder: 0 }] },
        ]),
      );
      workTypeModel.find.mockReturnValue(
        leanQuery([{ _id: WORKTYPE, days: null }]),
      );

      await expect(
        service.patchLineBoardLane(doc._id.toString(), 'line-a', 'shop'),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Цех') as never,
      });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('line → shop: PASS при каталоге с days (override не нужен)', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({ status: 'confirmed', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));
      stubShopReady({ productModel, productModuleModel, workTypeModel }, MODULE_A);

      await service.patchLineBoardLane(doc._id.toString(), 'line-a', 'shop');
      expect(doc.items[0]).toMatchObject({ boardLane: 'shop', status: 'in_production' });
      expect(doc.status).toBe('in_production');
    });

    it('line → shop: PASS через estimateDayOverrides, даже если каталог days = null', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({
        status: 'confirmed',
        items: [line('prep')],
        estimateDayOverrides: [
          { orderItemIndex: 0, moduleId: MODULE_A, workTypeId: WORKTYPE, days: 3 },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));
      productModel.findById.mockReturnValue(
        leanQuery({ composition: [], productModuleIds: [MODULE_A] }),
      );
      productModuleModel.find.mockReturnValue(
        leanQuery([
          { workTypes: [{ workTypeId: WORKTYPE, estimatedHours: 1, sortOrder: 0 }] },
        ]),
      );

      await service.patchLineBoardLane(doc._id.toString(), 'line-a', 'shop');
      expect(doc.status).toBe('in_production');
      // override покрывает дни → каталог не запрашивается.
      expect(workTypeModel.find).not.toHaveBeenCalled();
    });

    it('line → не-shop lane пропускает gate (design без модулей ок)', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({ status: 'confirmed', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchLineBoardLane(doc._id.toString(), 'line-a', 'design');
      expect(doc.items[0]).toMatchObject({ boardLane: 'design' });
      expect(productModel.findById).not.toHaveBeenCalled();
      expect(productModuleModel.find).not.toHaveBeenCalled();
      expect(workTypeModel.find).not.toHaveBeenCalled();
    });

    it('module → shop: 400 RU когда у модуля нет workType', async () => {
      const { service, model, productModuleModel } = createService();
      const doc = orderDoc({ status: 'confirmed', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));
      productModuleModel.find.mockReturnValue(leanQuery([{ workTypes: [] }]));

      await expect(
        service.patchModuleLane(
          doc._id.toString(),
          'line-a',
          MODULE_A.toString(),
          'shop',
        ),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Цех') as never,
      });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('module → shop: PASS при workType + catalog days', async () => {
      const { service, model, productModel, productModuleModel, workTypeModel } =
        createService();
      const doc = orderDoc({ status: 'confirmed', items: [line('prep')] });
      model.findById.mockReturnValue(mockQuery(doc));
      stubShopReady(
        { productModel, productModuleModel, workTypeModel },
        MODULE_A,
      );

      await service.patchModuleLane(
        doc._id.toString(),
        'line-a',
        MODULE_A.toString(),
        'shop',
      );
      expect(doc.moduleLanes).toHaveLength(1);
      expect(doc.moduleLanes[0]).toEqual(
        expect.objectContaining({ lineId: 'line-a', lane: 'shop' }),
      );
    });
  });

  /**
   * TZ-BACKEND-ORDER-ORG-SCOPE-HARDEN — same defect class as the estimate-days/
   * estimate-start fix in ff5cbad3: findByIdRaw is an unscoped Model.findById,
   * and OrgScopeGuardInterceptor only filters the RESPONSE after the handler
   * runs, which is too late for a write. Each of these five methods now calls
   * the existing assertOrgAccess() right after findByIdRaw, before any
   * mutation — these tests prove a cross-org caller is rejected before
   * doc.save() and a same-org (or legacy no-org) caller still works.
   */
  describe('org-scope hardening (TZ-BACKEND-ORDER-ORG-SCOPE-HARDEN)', () => {
    function lineFor(lineId = 'line-a'): MockOrderItem {
      return {
        lineId,
        boardLane: 'prep',
        productId: new Types.ObjectId(PRODUCT),
        quantity: 1,
        unitPrice: 0,
        total: 0,
        status: 'pending',
      };
    }

    it('update: rejects a cross-org caller before saving', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.update(doc._id.toString(), { notes: 'x' } as never, new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('update: allows the matching-org caller', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), { notes: 'x' } as never, ownerOrgId.toString());
      expect(doc.notes).toBe('x');
      expect(doc.save).toHaveBeenCalled();
    });

    it('setItemStatus: rejects a cross-org caller before saving', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'in_production', items: [lineFor()], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.setItemStatus(doc._id.toString(), '0', 'ready', new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(doc.items[0].status).not.toBe('ready');
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('setItemStatus: allows the matching-org caller', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'in_production', items: [lineFor()], organizationId: ownerOrgId });
      model.findById.mockReturnValueOnce(mockQuery(doc)).mockReturnValueOnce(mockQuery(doc));

      await service.setItemStatus(doc._id.toString(), '0', 'ready', ownerOrgId.toString());
      expect(doc.items[0].status).toBe('ready');
    });

    it('patchLineBoardLane: rejects a cross-org caller before saving', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', items: [lineFor()], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchLineBoardLane(doc._id.toString(), 'line-a', 'design', new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(doc.items[0].boardLane).toBe('prep');
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('patchLineBoardLane: allows the matching-org caller', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', items: [lineFor()], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchLineBoardLane(doc._id.toString(), 'line-a', 'design', ownerOrgId.toString());
      expect(doc.items[0].boardLane).toBe('design');
      expect(doc.save).toHaveBeenCalled();
    });

    it('patchModuleLane: rejects a cross-org caller before saving', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const moduleId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', items: [lineFor()], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.patchModuleLane(
          doc._id.toString(),
          'line-a',
          moduleId.toString(),
          'design',
          new Types.ObjectId().toString(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(doc.moduleLanes).toHaveLength(0);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('patchModuleLane: allows the matching-org caller', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const moduleId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', items: [lineFor()], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.patchModuleLane(doc._id.toString(), 'line-a', moduleId.toString(), 'design', ownerOrgId.toString());
      expect(doc.moduleLanes).toHaveLength(1);
      expect(doc.save).toHaveBeenCalled();
    });

    it('setLineReady: rejects a cross-org caller before saving', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', items: [lineFor()], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));
      const userId = new Types.ObjectId().toString();

      await expect(
        service.setLineReady(doc._id.toString(), '0', true, userId, new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(doc.items[0].readyForWork).not.toBe(true);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('setLineReady: allows the matching-org caller', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', items: [lineFor()], organizationId: ownerOrgId });
      model.findById.mockReturnValueOnce(mockQuery(doc)).mockReturnValueOnce(mockQuery(doc));
      const userId = new Types.ObjectId().toString();

      await service.setLineReady(doc._id.toString(), '0', true, userId, ownerOrgId.toString());
      expect(doc.items[0].readyForWork).toBe(true);
    });
  });

  /**
   * TZ-BACKEND-ORDER-ORG-SCOPE-TX — same defect class as HARDEN (`448af9d9`),
   * on the four transaction/session-wrapped methods that still fetched via a
   * raw `this.model.findById(id)` (reserveStock/ship/cancel inside
   * `sessionRunner.run`, remove via the public `findById`). `assertOrgAccess`
   * is called immediately after the order loads, before any side-effect
   * (reservation create, shipment create, reservation release, soft-delete).
   * ship() already took an `organizationId` parameter before this TZ but
   * never used it — looked guarded, wasn't.
   */
  describe('org-scope hardening — transactional writes (TZ-BACKEND-ORDER-ORG-SCOPE-TX)', () => {
    it('reserveStock: rejects a cross-org caller before creating reservations', async () => {
      const reservationService = { create: jest.fn(), release: jest.fn() };
      const { service, model, sessionRunner } = createService({ reservationService });
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', items: [], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));
      sessionRunner.run.mockImplementation(async (fn: (s: unknown) => Promise<unknown>) => fn({}));

      await expect(
        service.reserveStock(doc._id.toString(), 'wh-1', undefined, new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reservationService.create).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('reserveStock: allows the matching-org caller', async () => {
      const { service, model, sessionRunner } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', items: [], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));
      sessionRunner.run.mockImplementation(async (fn: (s: unknown) => Promise<unknown>) => fn({}));

      const { order } = await service.reserveStock(
        doc._id.toString(),
        'wh-1',
        undefined,
        ownerOrgId.toString(),
      );
      expect(order.status).toBe('confirmed');
      expect(doc.save).toHaveBeenCalled();
    });

    it('ship: rejects a cross-org caller before creating a shipment', async () => {
      const { service, model, sessionRunner, shipmentModel } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({
        status: 'ready',
        items: [{ productId: new Types.ObjectId(PRODUCT), quantity: 1, unitPrice: 0, total: 0 }],
        organizationId: ownerOrgId,
      });
      model.findById.mockReturnValue(mockQuery(doc));
      sessionRunner.run.mockImplementation(async (fn: (s: unknown) => Promise<unknown>) => fn({}));

      await expect(
        service.ship(
          doc._id.toString(),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          new Types.ObjectId().toString(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(shipmentModel.create).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('ship: allows the matching-org caller', async () => {
      const { service, model, sessionRunner, shipmentModel } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({
        status: 'ready',
        items: [{ productId: new Types.ObjectId(PRODUCT), quantity: 1, unitPrice: 0, total: 0 }],
        organizationId: ownerOrgId,
      });
      model.findById.mockReturnValue(mockQuery(doc));
      sessionRunner.run.mockImplementation(async (fn: (s: unknown) => Promise<unknown>) => fn({}));
      shipmentModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      const { order } = await service.ship(
        doc._id.toString(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ownerOrgId.toString(),
      );
      expect(order.status).toBe('shipped');
      expect(doc.save).toHaveBeenCalled();
    });

    it('cancel: rejects a cross-org caller before releasing reservations', async () => {
      const reservationService = { create: jest.fn(), release: jest.fn() };
      const { service, model, sessionRunner } = createService({ reservationService });
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', reservationIds: [], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));
      sessionRunner.run.mockImplementation(async (fn: (s: unknown) => Promise<unknown>) => fn({}));

      await expect(
        service.cancel(doc._id.toString(), new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reservationService.release).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('cancel: allows the matching-org caller', async () => {
      const { service, model, sessionRunner } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ status: 'confirmed', reservationIds: [], organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));
      sessionRunner.run.mockImplementation(async (fn: (s: unknown) => Promise<unknown>) => fn({}));

      const order = await service.cancel(doc._id.toString(), ownerOrgId.toString());
      expect(order.status).toBe('cancelled');
      expect(doc.save).toHaveBeenCalled();
    });

    it('remove: rejects a cross-org caller before soft-deleting', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.remove(doc._id.toString(), new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('remove: allows the matching-org caller', async () => {
      const { service, model } = createService();
      const ownerOrgId = new Types.ObjectId();
      const doc = orderDoc({ organizationId: ownerOrgId });
      model.findById.mockReturnValue(mockQuery(doc));
      model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.remove(doc._id.toString(), ownerOrgId.toString());
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        { $set: { deletedAt: expect.any(Date), isActive: false } },
      );
    });
  });
});
